/* eslint-disable @typescript-eslint/no-explicit-any */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { assertStaff } from "@/lib/tmdb/tmdb.functions";
import { fetchProviderJson, RateLimitedError } from "./ratelimit";
import { parseGlobalSearch } from "./catalog-pages";
import { parseBugouName, normTitle, compactTitle } from "./bugoumods";
import { seriesIntegration, logCall } from "./bugoumods.functions";
import { loadIntegration } from "./live.functions";

/**
 * Title search straight at the provider (`index.php?ajax=1&type=global_search&q=…`, the call its own site uses),
 * one request per search, token server-side. Hits missing from the staff index are added to it (no category)
 * so they can be imported by the existing jobs; the public catalog is never touched here.
 */
type Ctx = { supabase: any; userId: string };
const scrub = (s: string) => s.replace(/vtoken=[^&\s"]+/gi, "vtoken=***").replace(/[A-Za-z0-9_.-]{60,}/g, "***");

export const apiSearch = createServerFn({ method: "POST" }).middleware([requireSupabaseAuth])
  .inputValidator(d => z.object({ kind: z.enum(["series", "live"]), integrationId: z.string().uuid().optional(), query: z.string().trim().min(1, "Digite um nome para pesquisar.").max(100) })
    .refine(x => x.kind === "series" || !!x.integrationId, "Informe a API de canais").parse(d))
  .handler(async ({ data, context }) => {
    const ctx = context as Ctx; const db = ctx.supabase; await assertStaff(ctx);
    let base: string; let tok: string; let timeout: number; let log: (err: string | null, st: number | null, t0: number) => Promise<void>;
    if (data.kind === "series") {
      const s = await seriesIntegration();
      base = "https://cinema.bugoumods.com"; tok = s.tok; timeout = s.integ?.timeout_seconds ?? 25;
      log = (err, st, t0) => logCall(s.integ, `Busca na API: ${data.query}`.slice(0, 200), t0, err, st);
    } else {
      const l = await loadIntegration(data.integrationId!);
      base = l.integ.base_url.replace(/\/$/, ""); tok = l.tok; timeout = l.integ.timeout_seconds ?? 25;
      log = async (err, st, t0) => { await l.db.from("api_request_logs").insert({ integration_id: l.integ.id, content_label: `Busca na API: ${data.query}`.slice(0, 200), http_status: err ? st : 200, duration_ms: Date.now() - t0, success: !err, cached: false, error: err }); };
    }
    const url = new URL(base + "/index.php");
    url.search = new URLSearchParams({ ajax: "1", type: "global_search", q: data.query, vtoken: tok }).toString();
    const t0 = Date.now(); let found;
    try { found = parseGlobalSearch((await fetchProviderJson(url, "busca", { timeoutMs: Math.max(5, timeout) * 1000 })).json, data.kind); await log(null, 200, t0); }
    catch (e) {
      const msg = scrub((e as Error).message).slice(0, 300); await log(msg, e instanceof RateLimitedError ? 429 : null, t0);
      throw new Error(e instanceof RateLimitedError ? "O provedor pediu uma pausa (limite de requisições). Aguarde alguns segundos e pesquise de novo." : `Falha na busca da API: ${msg}`);
    }
    const ms = Date.now() - t0;
    const ids = found.map(f => f.id);

    if (data.kind === "series") {
      const now = new Date().toISOString();
      const rows = found.map(f => { const p = parseBugouName(f.name); return { kind: "series", ext_id: f.id, title: p.title, title_norm: normTitle(p.title), title_compact: compactTitle(p.title), year: p.year, poster_url: f.image, category: null, seen_at: now }; });
      if (rows.length) { const u = await db.from("bugou_catalog").upsert(rows, { onConflict: "kind,ext_id", ignoreDuplicates: true }); if (u.error) throw new Error(u.error.message); }
      const { data: idx } = ids.length ? await db.from("bugou_catalog").select("ext_id, category").eq("kind", "series").in("ext_id", ids) : { data: [] };
      const catBy = new Map((idx ?? []).map((r: any) => [r.ext_id, r.category ?? ""]));
      const { data: have } = ids.length ? await db.from("series").select("id, external_id").eq("external_source", "bugoumods").in("external_id", ids) : { data: [] };
      const existing: Record<string, string> = {}; (have ?? []).forEach((x: any) => { existing[x.external_id] = x.id; });
      return { kind: "series" as const, query: data.query, ms, series: rows.map(r => ({ id: r.ext_id, title: r.title, year: r.year, poster_url: r.poster_url, category: String(catBy.get(r.ext_id) ?? "") })), existing, channels: [] as { ext_id: string; name: string; logo_url: string | null; category: string; has_play: boolean; imported: boolean }[] };
    }

    const integrationId = data.integrationId!;
    const rows = found.map(f => ({ integration_id: integrationId, ext_id: f.id, name: f.name, logo_url: f.image, category: "", has_play: !!f.ext, ext: f.ext }));
    if (rows.length) { const u = await db.from("live_catalog").upsert(rows, { onConflict: "integration_id,ext_id", ignoreDuplicates: true }); if (u.error) throw new Error(u.error.message); }
    const { data: idx } = ids.length ? await db.from("live_catalog").select("ext_id, category, ext").eq("integration_id", integrationId).in("ext_id", ids) : { data: [] };
    const missingExt = (idx ?? []).filter((r: any) => !r.ext).map((r: any) => r.ext_id);
    for (const r of rows) if (r.ext && missingExt.includes(r.ext_id)) await db.from("live_catalog").update({ ext: r.ext, has_play: true }).eq("integration_id", integrationId).eq("ext_id", r.ext_id);
    const catBy = new Map((idx ?? []).map((r: any) => [r.ext_id, r.category ?? ""]));
    const { data: ch } = ids.length ? await db.from("channels").select("external_id").eq("api_integration_id", integrationId).in("external_id", ids) : { data: [] };
    const imp = new Set((ch ?? []).map((c: any) => c.external_id));
    return { kind: "live" as const, query: data.query, ms, series: [] as { id: string; title: string; year: number | null; poster_url: string | null; category: string }[], existing: {} as Record<string, string>,
      channels: rows.map(r => ({ ext_id: r.ext_id, name: r.name, logo_url: r.logo_url, category: String(catBy.get(r.ext_id) || "Resultado da busca"), has_play: r.has_play, imported: imp.has(r.ext_id) })) };
  });
