/* eslint-disable @typescript-eslint/no-explicit-any */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { assertStaff } from "@/lib/tmdb/tmdb.functions";
import { isBlockedHost } from "./engine";
import { parseLiveList, liveRef, isPermanent, type LiveChannel, type LiveParse } from "./live";

/**
 * Live-channel integrations (api_integrations.kind = 'live'). The provider list (single response, no
 * pagination/search) is mirrored into staff-only `live_catalog` WITHOUT play links; imports run as leased
 * `bugou_import_jobs` (kind 'live') that refetch the list once per step and write channels + embed sources in batches.
 * Token lives only in service-role `api_credentials` and is scrubbed from every message.
 */
type Ctx = { supabase: any; userId: string };
const auth = [requireSupabaseAuth] as const;
const scrub = (s: string) => s.replace(/vtoken=[^&\s"]+/gi, "vtoken=***").replace(/[A-Za-z0-9_.-]{60,}/g, "***");
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));
const slugify = (s: string) => s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "").slice(0, 80) || "canal";
const admin = async () => (await import("@/integrations/supabase/client.server")).supabaseAdmin as any;

async function loadIntegration(id: string) {
  const db = await admin();
  const { data: integ } = await db.from("api_integrations").select("*").eq("id", id).maybeSingle();
  if (!integ || integ.kind !== "live") throw new Error("Integração de canais não encontrada.");
  if (integ.provider !== "bugoumods_live") throw new Error("Formato desta API ainda não suportado para canais (somente o formato BugouMods foi verificado).");
  const u = new URL(integ.base_url);
  if (u.protocol !== "https:" || isBlockedHost(u.hostname)) throw new Error("Endereço da API não permitido.");
  const { data: cred } = await db.from("api_credentials").select("api_key, token").eq("integration_id", id).maybeSingle();
  const raw = String(cred?.token || cred?.api_key || "").trim();
  const tok = raw.match(/vtoken=([^&"\s]+)/)?.[1] ?? raw;
  if (integ.auth_method !== "none" && !tok) throw new Error("Token da API não configurado.");
  return { integ, tok: decodeURIComponent(tok), db };
}

type Fetched = LiveParse & { ms: number; status: number };

/** One provider request: timeout, up to 3 attempts with progressive wait on network/5xx/429, no retry on 4xx. */
async function fetchList(id: string, label: string): Promise<Fetched> {
  const { integ, tok, db } = await loadIntegration(id);
  const url = new URL(integ.base_url.replace(/\/$/, "") + "/");
  for (const [k, v] of Object.entries(integ.params ?? {})) url.searchParams.set(k, String(v));
  if (integ.auth_method === "query_key") url.searchParams.set(integ.auth_param || "vtoken", tok);
  const headers: Record<string, string> = { "User-Agent": "Mozilla/5.0", Accept: "application/json", ...(integ.headers ?? {}) };
  if (integ.auth_method === "bearer") headers["Authorization"] = `Bearer ${tok}`;
  if (integ.auth_method === "header_key" || integ.auth_method === "custom_header") headers[integ.auth_param || "X-API-Key"] = tok;
  const t0 = Date.now(); let last = ""; let status = 0;
  try {
    for (let i = 0; i < 3; i++) {
      if (i) await sleep(800 * 2 ** (i - 1));
      let res: Response;
      try { res = await fetch(url, { headers, redirect: "manual", signal: AbortSignal.timeout(integ.timeout_seconds * 1000) }); }
      catch (e) { last = (e as Error)?.name === "TimeoutError" ? "Tempo esgotado (timeout) ao consultar a API." : "Falha de rede ao consultar a API."; continue; }
      status = res.status;
      if (res.status >= 500 || res.status === 429) { last = `HTTP ${res.status} — ${res.status === 429 ? "limite do provedor" : "erro temporário do provedor"}.`; continue; }
      if (res.status >= 300 && res.status < 400) throw new Error(`HTTP ${res.status} — a API redirecionou; redirecionamentos não são seguidos por segurança.`);
      if (!res.ok) throw new Error(`HTTP ${res.status} — ${res.status === 401 || res.status === 403 ? "credenciais recusadas" : "requisição recusada"}.`);
      let json: unknown; try { json = await res.json(); } catch { throw new Error("Formato inesperado: a resposta não é JSON."); }
      const parsed = parseLiveList(json, url.hostname);
      const ms = Date.now() - t0;
      await db.from("api_request_logs").insert({ integration_id: id, actor_id: null, content_label: label, http_status: status, duration_ms: ms, success: true, cached: false });
      await db.from("api_integrations").update({ last_tested_at: new Date().toISOString(), last_status: "ok", last_error: null, request_count: Number(integ.request_count) + 1 }).eq("id", id);
      return { ...parsed, ms, status };
    }
    throw new Error(last);
  } catch (e) {
    const msg = scrub(e instanceof Error ? e.message : String(e)).slice(0, 400);
    await db.from("api_request_logs").insert({ integration_id: id, content_label: label, http_status: status || null, duration_ms: Date.now() - t0, success: false, cached: false, error: msg });
    await db.from("api_integrations").update({ last_tested_at: new Date().toISOString(), last_status: "error", last_error: msg, request_count: Number(integ.request_count) + 1 }).eq("id", id);
    throw new Error(msg);
  }
}

const idIn = z.object({ integrationId: z.string().uuid() });

/** Connection test: real request, returns format summary only (no links, no token). */
export const liveTest = createServerFn({ method: "POST" }).middleware([...auth]).inputValidator(d => idIn.parse(d))
  .handler(async ({ data, context }) => {
    await assertStaff(context as Ctx);
    const r = await fetchList(data.integrationId, "Teste de conexão (canais)");
    return { ms: r.ms, status: r.status, categories: r.categories.length, received: r.received, valid: r.channels.length, withLink: r.channels.length - r.missingLink, missingLink: r.missingLink, duplicates: r.duplicates, invalid: r.invalid, sampleCategories: r.categories.slice(0, 12) };
  });

/** Manual sync of the index. Never deletes rows; on any error the index is left untouched. */
export const liveSync = createServerFn({ method: "POST" }).middleware([...auth]).inputValidator(d => idIn.parse(d))
  .handler(async ({ data, context }) => {
    const ctx = context as Ctx; await assertStaff(ctx);
    const r = await fetchList(data.integrationId, "Sincronização de categorias (canais)");
    const now = new Date().toISOString();
    for (let i = 0; i < r.channels.length; i += 500) {
      const rows = r.channels.slice(i, i + 500).map(c => ({ integration_id: data.integrationId, ext_id: c.id, name: c.name, logo_url: c.logo, category: c.category, has_play: !!c.playUrl, seen_at: now }));
      const u = await ctx.supabase.from("live_catalog").upsert(rows, { onConflict: "integration_id,ext_id" });
      if (u.error) throw new Error(u.error.message);
    }
    await (await admin()).from("api_integrations").update({ last_synced_at: now }).eq("id", data.integrationId);
    return { synced_at: now, categories: r.categories.length, channels: r.channels.length, missingLink: r.missingLink, ms: r.ms };
  });

async function importedSet(ctx: Ctx, integrationId: string) {
  const s = new Set<string>();
  for (let from = 0; ; from += 1000) {
    const { data, error } = await ctx.supabase.from("channels").select("external_id").eq("api_integration_id", integrationId).range(from, from + 999);
    if (error) throw new Error(error.message);
    (data ?? []).forEach((x: any) => s.add(x.external_id));
    if (!data || data.length < 1000) break;
  }
  return s;
}
async function indexRows(ctx: Ctx, integrationId: string, category?: string) {
  const out: any[] = [];
  for (let from = 0; ; from += 1000) {
    let q = ctx.supabase.from("live_catalog").select("ext_id, name, logo_url, category, has_play, seen_at").eq("integration_id", integrationId).order("name").range(from, from + 999);
    if (category) q = q.eq("category", category);
    const { data, error } = await q; if (error) throw new Error(error.message);
    out.push(...(data ?? [])); if (!data || data.length < 1000) break;
  }
  return out;
}

/** Categories exactly as returned by the provider (from the last sync) with totals and import status. */
export const liveCategories = createServerFn({ method: "POST" }).middleware([...auth]).inputValidator(d => idIn.parse(d))
  .handler(async ({ data, context }) => {
    const ctx = context as Ctx; await assertStaff(ctx);
    const [rows, imp] = await Promise.all([indexRows(ctx, data.integrationId), importedSet(ctx, data.integrationId)]);
    const m = new Map<string, { total: number; imported: number; noLink: number }>();
    for (const r of rows) { const c = m.get(r.category) ?? { total: 0, imported: 0, noLink: 0 }; c.total++; if (imp.has(r.ext_id)) c.imported++; if (!r.has_play) c.noLink++; m.set(r.category, c); }
    return [...m.entries()].map(([name, c]) => ({ name, ...c }));
  });

export const liveChannels = createServerFn({ method: "POST" }).middleware([...auth])
  .inputValidator(d => z.object({ integrationId: z.string().uuid(), category: z.string().min(1).max(200), page: z.number().int().min(0).default(0) }).parse(d))
  .handler(async ({ data, context }) => {
    const ctx = context as Ctx; await assertStaff(ctx);
    const PAGE = 60;
    const { data: rows, count, error } = await ctx.supabase.from("live_catalog").select("ext_id, name, logo_url, category, has_play", { count: "exact" }).eq("integration_id", data.integrationId).eq("category", data.category).order("name").range(data.page * PAGE, data.page * PAGE + PAGE - 1);
    if (error) throw new Error(error.message);
    const ids = (rows ?? []).map((r: any) => r.ext_id);
    const { data: ch } = ids.length ? await ctx.supabase.from("channels").select("external_id").eq("api_integration_id", data.integrationId).in("external_id", ids) : { data: [] };
    const imp = new Set((ch ?? []).map((c: any) => c.external_id));
    return { total: count ?? 0, pageSize: PAGE, items: (rows ?? []).map((r: any) => ({ ...r, imported: imp.has(r.ext_id) })) };
  });

// ---------- jobs ----------

async function jobView(ctx: Ctx, jobId: string) {
  const { data: job, error } = await ctx.supabase.from("bugou_import_jobs").select("*").eq("id", jobId).single();
  if (error) throw new Error(error.message);
  const { data: failures } = await ctx.supabase.from("bugou_import_items").select("ext_id, title, error, attempts").eq("job_id", jobId).eq("state", "failed").order("updated_at", { ascending: false }).limit(50);
  return { id: job.id as string, label: job.label as string, status: job.status as string, total: job.total as number, done: job.done as number, failed: job.failed as number, created_at: job.created_at as string, updated_at: job.updated_at as string, stats: (job.stats ?? {}) as Record<string, number>, pending: Math.max(0, job.total - job.done - job.failed), failures: (failures ?? []) as { ext_id: string; title: string | null; error: string | null; attempts: number }[] };
}

export const liveCreateJob = createServerFn({ method: "POST" }).middleware([...auth])
  .inputValidator(d => z.object({ integrationId: z.string().uuid(), ids: z.array(z.string().regex(/^\d{1,20}$/)).max(5000).default([]), category: z.string().max(200).optional() }).parse(d))
  .handler(async ({ data, context }) => {
    const ctx = context as Ctx; const db = ctx.supabase; await assertStaff(ctx);
    // Concurrency guard: one active import per integration.
    const { data: active } = await db.from("bugou_import_jobs").select("id").eq("kind", "live").eq("integration_id", data.integrationId).in("status", ["queued", "running"]).gt("updated_at", new Date(Date.now() - 10 * 60_000).toISOString()).limit(1);
    if (active?.length) throw new Error("Já existe uma importação de canais em andamento para esta API. Aguarde ou pause-a.");
    const rows = data.category && !data.ids.length ? await indexRows(ctx, data.integrationId, data.category) : (await db.from("live_catalog").select("ext_id, name").eq("integration_id", data.integrationId).in("ext_id", data.ids)).data ?? [];
    if (!rows.length) throw new Error("Nenhum canal para importar.");
    const label = data.category && !data.ids.length ? `Categoria ${data.category} (todos)` : `${rows.length} canal(is) selecionado(s)${data.category ? ` — ${data.category}` : ""}`;
    const j = await db.from("bugou_import_jobs").insert({ kind: "live", integration_id: data.integrationId, label: label.slice(0, 200), total: rows.length, created_by: ctx.userId, status: "queued", stats: { created: 0, updated: 0, skipped: 0 } }).select("id").single();
    if (j.error) throw new Error(j.error.message);
    for (let i = 0; i < rows.length; i += 500) {
      const r = await db.from("bugou_import_items").insert(rows.slice(i, i + 500).map((x: any) => ({ job_id: j.data.id, ext_id: x.ext_id, title: x.name })));
      if (r.error) throw new Error(r.error.message);
    }
    return jobView(ctx, j.data.id);
  });

type BatchOut = { created: number; updated: number; skipped: number; failed: { id: string; error: string; permanent: boolean }[] };

/** Writes one batch with set-based reads; per-item failures never abort the batch. */
async function importBatch(ctx: Ctx, integrationId: string, items: { ext_id: string }[], byId: Map<string, LiveChannel>): Promise<BatchOut> {
  const db = ctx.supabase; const out: BatchOut = { created: 0, updated: 0, skipped: 0, failed: [] };
  const ids = items.map(i => i.ext_id);
  const { data: existing } = await db.from("channels").select("id, external_id, name, logo_url").eq("api_integration_id", integrationId).in("external_id", ids);
  const ex = new Map<string, any>((existing ?? []).map((c: any) => [c.external_id, c]));
  const chIds = (existing ?? []).map((c: any) => c.id);
  const { data: srcs } = chIds.length ? await db.from("playback_sources").select("id, content_id, url, external_ref, is_primary").eq("content_kind", "channel").in("content_id", chIds) : { data: [] };
  const srcBy = new Map<string, any[]>(); (srcs ?? []).forEach((s: any) => srcBy.set(s.content_id, [...(srcBy.get(s.content_id) ?? []), s]));
  for (const it of items) {
    const c = byId.get(it.ext_id);
    try {
      if (!c) throw Object.assign(new Error("Canal não está mais na resposta da API (removido pelo provedor)."), { permanent: true });
      if (!c.playUrl) throw Object.assign(new Error("A API não forneceu link de reprodução válido; canal não importado."), { permanent: true });
      let row = ex.get(c.id); let changed = false;
      if (!row) {
        let slug = slugify(c.name);
        const { data: taken } = await db.from("channels").select("id").eq("slug", slug).maybeSingle();
        if (taken) slug = `${slug}-${c.id}`.slice(0, 100);
        const r = await db.from("channels").insert({ name: c.name, slug, logo_url: c.logo, status: "published", external_source: "bugoumods", external_id: c.id, api_integration_id: integrationId }).select("id, external_id, name, logo_url").single();
        if (r.error) throw new Error(r.error.message);
        row = r.data; out.created++;
      } else {
        const patch: any = {};
        if (row.name !== c.name) patch.name = c.name;
        if (c.logo && row.logo_url !== c.logo) patch.logo_url = c.logo;
        if (Object.keys(patch).length) { const u = await db.from("channels").update(patch).eq("id", row.id); if (u.error) throw new Error(u.error.message); changed = true; }
      }
      const list = srcBy.get(row.id) ?? [];
      const mine = list.find(s => s.external_ref === liveRef(c.id));
      if (!mine) {
        const r = await db.from("playback_sources").insert({ content_kind: "channel", content_id: row.id, url: c.playUrl, source_type: "embed", provider: "BugouMods VIP", label: "VIP", is_active: true, is_primary: !list.some(s => s.is_primary), sort_order: list.length, external_ref: liveRef(c.id), api_integration_id: integrationId, last_seen_at: new Date().toISOString(), unavailable_since: null });
        if (r.error) throw new Error(r.error.message);
        changed = true;
      } else if (mine.url !== c.playUrl) {
        const r = await db.from("playback_sources").update({ url: c.playUrl, last_seen_at: new Date().toISOString(), unavailable_since: null }).eq("id", mine.id);
        if (r.error) throw new Error(r.error.message);
        changed = true;
      }
      if (ex.has(c.id)) { if (changed) out.updated++; else out.skipped++; }
    } catch (e) {
      const msg = scrub(e instanceof Error ? e.message : String(e)).slice(0, 400);
      out.failed.push({ id: it.ext_id, error: msg, permanent: !!(e as any)?.permanent || isPermanent(msg) });
    }
  }
  return out;
}

/** Processes pending items for ~20s under a lease, in batches of `batch_size`. Call again until done. */
export const liveRunJob = createServerFn({ method: "POST" }).middleware([...auth])
  .inputValidator(d => z.object({ jobId: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const ctx = context as Ctx; const db = ctx.supabase; await assertStaff(ctx);
    const now = new Date();
    const lease = await db.from("bugou_import_jobs").update({ lease_until: new Date(now.getTime() + 45_000).toISOString(), status: "running" })
      .eq("id", data.jobId).eq("kind", "live").not("status", "in", "(cancelled,paused)").or(`lease_until.is.null,lease_until.lt.${now.toISOString()}`).select("id, integration_id, stats");
    if (lease.error) throw new Error(lease.error.message);
    if (!lease.data?.length) return { ...(await jobView(ctx, data.jobId)), busy: true };
    const job = lease.data[0]; const stats: any = { created: 0, updated: 0, skipped: 0, ...(job.stats ?? {}) };
    const { integ } = await loadIntegration(job.integration_id);
    const started = Date.now();
    let list: Fetched | null = null;
    try {
      while (Date.now() - started < 20_000) {
        const { data: next } = await db.from("bugou_import_items").select("ext_id, attempts").eq("job_id", data.jobId).eq("state", "pending").order("attempts").order("ext_id").limit(integ.batch_size);
        if (!next?.length) break;
        if (!list) { list = await fetchList(job.integration_id, "Importação de canais"); stats.fetch_ms = (stats.fetch_ms ?? 0) + list.ms; }
        const byId = new Map(list.channels.map(c => [c.id, c]));
        const t0 = Date.now();
        const r = await importBatch(ctx, job.integration_id, next, byId);
        stats.created += r.created; stats.updated += r.updated; stats.skipped += r.skipped; stats.write_ms = (stats.write_ms ?? 0) + (Date.now() - t0);
        const failed = new Map(r.failed.map(f => [f.id, f]));
        const ok = next.filter((n: any) => !failed.has(n.ext_id)).map((n: any) => n.ext_id);
        const ts = new Date().toISOString();
        if (ok.length) await db.from("bugou_import_items").update({ state: "done", error: null, updated_at: ts }).eq("job_id", data.jobId).in("ext_id", ok);
        for (const n of next as any[]) {
          const f = failed.get(n.ext_id); if (!f) continue;
          const attempts = n.attempts + 1;
          await db.from("bugou_import_items").update({ state: f.permanent || attempts >= 3 ? "failed" : "pending", attempts, error: f.error, updated_at: ts }).eq("job_id", data.jobId).eq("ext_id", n.ext_id);
        }
      }
    } catch (e) {
      // Provider/format failure: leave items pending (resumable), record the reason, never touch stored data.
      const msg = scrub(e instanceof Error ? e.message : String(e)).slice(0, 400);
      stats.provider_errors = (stats.provider_errors ?? 0) + 1;
      await db.from("bugou_import_jobs").update({ stats: { ...stats, last_error: msg }, status: isPermanent(msg) ? "paused" : "running", lease_until: null, updated_at: new Date().toISOString() }).eq("id", data.jobId);
      throw new Error(msg);
    }
    const c = async (state: string) => (await db.from("bugou_import_items").select("ext_id", { count: "exact", head: true }).eq("job_id", data.jobId).eq("state", state)).count ?? 0;
    const [done, failed, pending] = await Promise.all([c("done"), c("failed"), c("pending")]);
    await db.from("bugou_import_jobs").update({ done, failed, stats, status: pending ? "running" : "done", lease_until: null, updated_at: new Date().toISOString() }).eq("id", data.jobId);
    return { ...(await jobView(ctx, data.jobId)), busy: false };
  });

export const liveRetryFailed = createServerFn({ method: "POST" }).middleware([...auth])
  .inputValidator(d => z.object({ jobId: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const ctx = context as Ctx; await assertStaff(ctx);
    const r = await ctx.supabase.from("bugou_import_items").update({ state: "pending", attempts: 0 }).eq("job_id", data.jobId).eq("state", "failed");
    if (r.error) throw new Error(r.error.message);
    await ctx.supabase.from("bugou_import_jobs").update({ failed: 0, status: "running", updated_at: new Date().toISOString() }).eq("id", data.jobId);
    return jobView(ctx, data.jobId);
  });

export const livePauseJob = createServerFn({ method: "POST" }).middleware([...auth])
  .inputValidator(d => z.object({ jobId: z.string().uuid(), resume: z.boolean().default(false) }).parse(d))
  .handler(async ({ data, context }) => {
    const ctx = context as Ctx; await assertStaff(ctx);
    await ctx.supabase.from("bugou_import_jobs").update({ status: data.resume ? "running" : "paused", lease_until: null, updated_at: new Date().toISOString() }).eq("id", data.jobId);
    return jobView(ctx, data.jobId);
  });

/** History + metrics for one integration, measured from real request logs and job items. */
export const liveOverview = createServerFn({ method: "POST" }).middleware([...auth]).inputValidator(d => idIn.parse(d))
  .handler(async ({ data, context }) => {
    const ctx = context as Ctx; await assertStaff(ctx);
    const { data: jobs } = await ctx.supabase.from("bugou_import_jobs").select("id").eq("kind", "live").eq("integration_id", data.integrationId).order("created_at", { ascending: false }).limit(10);
    const views = await Promise.all((jobs ?? []).map((j: any) => jobView(ctx, j.id)));
    const { data: logs } = await ctx.supabase.from("api_request_logs").select("success, duration_ms, http_status, error, created_at").eq("integration_id", data.integrationId).order("created_at", { ascending: false }).limit(200);
    const L = logs ?? [];
    const by = (re: RegExp) => L.filter((l: any) => !l.success && re.test(l.error ?? "")).length;
    const okL = L.filter((l: any) => l.success);
    const indexed = (await ctx.supabase.from("live_catalog").select("ext_id", { count: "exact", head: true }).eq("integration_id", data.integrationId)).count ?? 0;
    const noLink = (await ctx.supabase.from("live_catalog").select("ext_id", { count: "exact", head: true }).eq("integration_id", data.integrationId).eq("has_play", false)).count ?? 0;
    const imported = (await ctx.supabase.from("channels").select("id", { count: "exact", head: true }).eq("api_integration_id", data.integrationId)).count ?? 0;
    const tot = views.reduce((a, j) => ({ done: a.done + j.done, failed: a.failed + j.failed, skipped: a.skipped + (j.stats.skipped ?? 0) }), { done: 0, failed: 0, skipped: 0 });
    return {
      jobs: views, indexed, noLink, imported,
      requests: L.length, requestOk: okL.length,
      avgFetchMs: okL.length ? Math.round(okL.reduce((s: number, l: any) => s + (l.duration_ms ?? 0), 0) / okL.length) : null,
      errors: { timeout: by(/timeout/i), auth: by(/HTTP (401|403)|credenciais|aviso/i), format: by(/Formato inesperado|JSON/i), limit: by(/HTTP 429|limite/i), other: L.filter((l: any) => !l.success).length },
      importOk: tot.done, importFailed: tot.failed, duplicatesAvoided: tot.skipped,
    };
  });
