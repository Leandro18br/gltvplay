/* eslint-disable @typescript-eslint/no-explicit-any */
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { buildUrl, fillTemplate, httpErrorLabel, type Vars, type Mapping } from "./engine";

const db = supabaseAdmin as any;
const MAX_BYTES = 2 * 1024 * 1024;
const TIMEOUT_MS = 15000;

export type RunResult = {
  ok: boolean; status: number | null; ms: number; body: unknown; raw: string; cached: boolean; error: string | null;
  integrationId: string; integrationName: string; endpointId: string | null;
};
export type Integration = any;
export type Endpoint = any;

async function sha(s: string) {
  const d = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return [...new Uint8Array(d)].map(b => b.toString(16).padStart(2, "0")).join("");
}

export async function loadIntegration(id: string) {
  const { data, error } = await db.from("api_integrations").select("*").eq("id", id).maybeSingle();
  if (error || !data) throw new Error("API não encontrada");
  return data as Integration;
}

/** Active integrations of a kind, ordered by priority (fallback order), each with its endpoints. */
export async function integrationsFor(kind: string) {
  const { data } = await db.from("api_integrations").select("*, api_endpoints(*)").eq("kind", kind).eq("is_active", true).order("priority").order("created_at");
  return (data ?? []) as Integration[];
}

export function pickEndpoint(integ: Integration, kind: string): Endpoint | null {
  return (integ.api_endpoints ?? []).filter((e: Endpoint) => e.is_active && e.kind === kind).sort((a: Endpoint, b: Endpoint) => a.sort_order - b.sort_order)[0] ?? null;
}

/** Executes one endpoint server-side: auth, variables, same-host guard, rate limit, cache and logging. Secrets never leave this function. */
export async function runEndpoint(integ: Integration, ep: Endpoint | null, vars: Vars, opts: { actorId: string; label: string; useCache?: boolean }): Promise<RunResult> {
  const t0 = Date.now();
  const base = { integrationId: integ.id, integrationName: integ.name, endpointId: ep?.id ?? null };
  const log = async (r: Partial<RunResult>) => {
    await db.from("api_request_logs").insert({ integration_id: integ.id, endpoint_id: ep?.id ?? null, actor_id: opts.actorId, content_label: opts.label.slice(0, 200), http_status: r.status ?? null, duration_ms: r.ms ?? 0, success: !!r.ok, cached: !!r.cached, error: r.error?.slice(0, 500) ?? null });
    if (!r.cached) await db.from("api_integrations").update({ request_count: (integ.request_count ?? 0) + 1, last_tested_at: new Date().toISOString(), last_status: r.ok ? "ok" : "error", last_error: r.ok ? null : r.error?.slice(0, 500) ?? null }).eq("id", integ.id);
  };
  const fail = async (error: string, status: number | null = null): Promise<RunResult> => {
    const r = { ...base, ok: false, status, ms: Date.now() - t0, body: null, raw: "", cached: false, error };
    await log(r); return r;
  };
  try {
    const { count } = await db.from("api_request_logs").select("id", { count: "exact", head: true }).eq("integration_id", integ.id).eq("cached", false).gte("created_at", new Date(Date.now() - 60000).toISOString());
    if ((count ?? 0) >= integ.rate_limit_per_minute) return await fail("Limite de requisições por minuto atingido", 429);

    const { data: cred } = await db.from("api_credentials").select("api_key,token").eq("integration_id", integ.id).maybeSingle();
    const secret: string | null = integ.auth_method === "bearer" ? cred?.token ?? cred?.api_key ?? null : cred?.api_key ?? cred?.token ?? null;
    if (integ.auth_method !== "none" && !secret) return await fail("Credencial não configurada");

    const query: Record<string, string> = { ...(integ.params ?? {}), ...(ep?.query ?? {}) };
    const url = buildUrl(integ.base_url, ep?.path ?? "", vars, query);
    const headers = new Headers({ Accept: "application/json, text/plain;q=0.9, */*;q=0.5", "User-Agent": "StreamingCatalog/1.0" });
    for (const [k, v] of Object.entries({ ...(integ.headers ?? {}), ...(ep?.headers ?? {}) })) headers.set(k, fillTemplate(String(v), vars));
    const param = integ.auth_param || (integ.auth_method === "query_key" ? "api_key" : "X-API-Key");
    if (integ.auth_method === "query_key") url.searchParams.set(param, secret!);
    if (integ.auth_method === "header_key" || integ.auth_method === "custom_header") headers.set(param, secret!);
    if (integ.auth_method === "bearer") headers.set("Authorization", `Bearer ${secret}`);

    const method = ep?.method ?? integ.default_method ?? "GET";
    const body = method === "POST" && ep?.body ? fillTemplate(ep.body, vars, v => JSON.stringify(v).slice(1, -1)) : undefined;
    if (body && !headers.has("Content-Type")) headers.set("Content-Type", "application/json");

    // Cache key excludes secrets (auth is applied after hashing the public parts).
    const publicUrl = new URL(url.href); if (integ.auth_method === "query_key") publicUrl.searchParams.delete(param);
    const key = await sha(`${integ.id}|${ep?.id ?? "base"}|${method}|${publicUrl.href}|${body ?? ""}`);
    if (opts.useCache !== false && integ.cache_ttl_seconds > 0) {
      const { data: hit } = await db.from("api_response_cache").select("http_status,body,expires_at").eq("cache_key", key).maybeSingle();
      if (hit && new Date(hit.expires_at).getTime() > Date.now()) {
        let parsed: unknown = hit.body; try { parsed = JSON.parse(hit.body); } catch { /* text */ }
        const r = { ...base, ok: true, status: hit.http_status, ms: Date.now() - t0, body: parsed, raw: hit.body, cached: true, error: null };
        await log(r); return r;
      }
    }

    let res: Response;
    try {
      res = await fetch(url.href, { method, headers, body, redirect: "manual", signal: AbortSignal.timeout(TIMEOUT_MS) });
    } catch (e) {
      const name = e instanceof Error ? e.name : "";
      return await fail(name === "TimeoutError" || name === "AbortError" ? "Tempo esgotado (timeout)" : "Falha de conexão com a API");
    }
    if (res.status >= 300 && res.status < 400) return await fail(`HTTP ${res.status} · Redirecionamento bloqueado por segurança`, res.status);
    const buf = await res.arrayBuffer();
    if (buf.byteLength > MAX_BYTES) return await fail("Resposta muito grande", res.status);
    const raw = new TextDecoder().decode(buf);
    if (!res.ok) { const r = { ...base, ok: false, status: res.status, ms: Date.now() - t0, body: safeJson(raw), raw: raw.slice(0, 20000), cached: false, error: httpErrorLabel(res.status) }; await log(r); return r; }
    const parsed = safeJson(raw);
    if (parsed === undefined && !/^\s*(<iframe|https:\/\/)/i.test(raw)) return await fail("Resposta inválida (não é JSON)", res.status);
    if (integ.cache_ttl_seconds > 0) await db.from("api_response_cache").upsert({ cache_key: key, integration_id: integ.id, http_status: res.status, body: raw, expires_at: new Date(Date.now() + integ.cache_ttl_seconds * 1000).toISOString() });
    const r = { ...base, ok: true, status: res.status, ms: Date.now() - t0, body: parsed ?? raw.trim(), raw: raw.slice(0, 200000), cached: false, error: null };
    await log(r); return r;
  } catch (e) {
    return await fail(e instanceof Error ? e.message : "Erro inesperado");
  }
}

function safeJson(raw: string): unknown { try { return JSON.parse(raw); } catch { return undefined; } }

/** Builds the variables of a movie or episode from the database. */
export async function contentVars(kind: "movie" | "episode", id: string): Promise<{ vars: Vars; label: string }> {
  if (kind === "movie") {
    const { data: m } = await db.from("movies").select("id,title,release_year,external_source,external_id").eq("id", id).maybeSingle();
    if (!m) throw new Error("Filme não encontrado");
    const tmdb = m.external_source === "tmdb" ? String(m.external_id ?? "").replace(/^movie:/, "") : /^tmdb:/.test(m.external_id ?? "") ? m.external_id.slice(5) : "";
    return { label: `Filme: ${m.title}`, vars: clean({ movie_id: m.id, tmdb_id: tmdb, title: m.title, year: m.release_year?.toString(), external_id: m.external_id, imdb_id: /^tt\d+$/.test(m.external_id ?? "") ? m.external_id : "" }) };
  }
  const { data: e } = await db.from("episodes").select("id,title,episode_number,seasons!inner(season_number,series!inner(id,title,release_year,external_source,external_id))").eq("id", id).maybeSingle();
  if (!e) throw new Error("Episódio não encontrado");
  const s = e.seasons.series;
  const tmdb = s.external_source === "tmdb" ? String(s.external_id ?? "").replace(/^tv:/, "") : "";
  return { label: `${s.title} T${e.seasons.season_number}E${e.episode_number}`, vars: clean({ series_id: s.id, episode_id: e.id, tmdb_id: tmdb, series_tmdb_id: tmdb, season: String(e.seasons.season_number), episode: String(e.episode_number), title: s.title, year: s.release_year?.toString(), external_id: s.external_id }) };
}
const clean = (o: Record<string, unknown>): Vars => Object.fromEntries(Object.entries(o).filter(([, v]) => v != null && v !== "").map(([k, v]) => [k, String(v)]));

export type { Mapping };
