/* eslint-disable @typescript-eslint/no-explicit-any */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { assertStaff } from "@/lib/tmdb/tmdb.functions";
import { fetchProviderJson, RateLimitedError, backoffMs } from "./ratelimit";
import { parseHomeCategories, parseCategoryPage, nextCursor, PAGE_LIMIT, type ProviderCategory } from "./catalog-pages";
import { parseBugouName, normTitle, compactTitle } from "./bugoumods";
import { seriesIntegration, logCall } from "./bugoumods.functions";
import { loadIntegration } from "./live.functions";

/**
 * Full-catalog index sync through the provider's paginated category pages (the `c=all` list stops at 50 per category).
 * Client-driven short steps; the cursor travels with the client (and is kept in localStorage to resume).
 * Writes only the staff indexes (bugou_catalog / live_catalog + *_categories memberships); never the public catalog.
 */
type Ctx = { supabase: any; userId: string };
const admin = async () => (await import("@/integrations/supabase/client.server")).supabaseAdmin as any;
const scrub = (s: string) => s.replace(/vtoken=[^&\s"]+/gi, "vtoken=***").replace(/[A-Za-z0-9_.-]{60,}/g, "***");
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));
const STEP_BUDGET_MS = 7000;

const stateSchema = z.object({
  startedAt: z.string(), cats: z.array(z.object({ id: z.string(), name: z.string(), count: z.number().nullable() })).max(500),
  ci: z.number().int().min(0), page: z.number().int().min(1), pages: z.number().int().nullable(), rows: z.number().int().min(0),
  skipped: z.array(z.string()).max(500), totals: z.record(z.string(), z.number()),
});
export type SyncState = z.infer<typeof stateSchema>;

async function provider(target: { kind: "series" } | { kind: "live"; integrationId: string }) {
  if (target.kind === "series") {
    const { integ, tok } = await seriesIntegration();
    return { base: "https://cinema.bugoumods.com", tok, rpm: integ?.rate_limit_per_minute ?? 30, timeout: integ?.timeout_seconds ?? 25, log: (label: string, t0: number, err: string | null, st: number | null) => logCall(integ, label, t0, err, st) };
  }
  const { integ, tok, db } = await loadIntegration(target.integrationId);
  return {
    base: integ.base_url.replace(/\/$/, ""), tok, rpm: integ.rate_limit_per_minute ?? 30, timeout: integ.timeout_seconds ?? 25,
    log: async (label: string, t0: number, err: string | null, st: number | null) => { await db.from("api_request_logs").insert({ integration_id: integ.id, content_label: label, http_status: err ? st : 200, duration_ms: Date.now() - t0, success: !err, cached: false, error: err }); },
  };
}

export const catalogSyncStep = createServerFn({ method: "POST" }).middleware([requireSupabaseAuth])
  .inputValidator(d => z.object({ kind: z.enum(["series", "live"]), integrationId: z.string().uuid().optional(), state: stateSchema.nullable().default(null) }).refine(x => x.kind === "series" || !!x.integrationId, "Informe a API de canais").parse(d))
  .handler(async ({ data, context }) => {
    const ctx = context as Ctx; await assertStaff(ctx);
    const target = data.kind === "series" ? { kind: "series" as const } : { kind: "live" as const, integrationId: data.integrationId! };
    const p = await provider(target);
    const ctype = data.kind === "series" ? "series" : "live_streams";
    const get = async (params: Record<string, string>, what: string) => {
      const url = new URL(p.base + "/index.php");
      url.search = new URLSearchParams({ ajax: "1", ...params, vtoken: p.tok }).toString();
      const t0 = Date.now();
      try { const r = await fetchProviderJson(url, what, { timeoutMs: Math.max(5, p.timeout) * 1000 }); await p.log(`Catálogo paginado: ${what}`.slice(0, 200), t0, null, 200); return r.json; }
      catch (e) { const msg = scrub((e as Error).message).slice(0, 300); await p.log(`Catálogo paginado: ${what}`.slice(0, 200), t0, msg, e instanceof RateLimitedError ? 429 : null); throw e; }
    };
    let st: SyncState;
    try {
      if (!data.state) {
        const cats: ProviderCategory[] = parseHomeCategories(await get({ type: "home_data" }, "categorias"), data.kind);
        if (!cats.length) throw new Error("A API não devolveu categorias.");
        st = { startedAt: new Date().toISOString(), cats, ci: 0, page: 1, pages: null, rows: 0, skipped: [], totals: {} };
        return view(st, false);
      }
      st = { ...data.state, skipped: [...data.state.skipped], totals: { ...data.state.totals } };
    } catch (e) {
      if (e instanceof RateLimitedError) return { ...emptyView(), waitMs: e.retryAfterMs ?? backoffMs(1), error: "Limite de requisições do provedor (HTTP 429). Aguardando para continuar." };
      throw new Error(scrub((e as Error).message));
    }

    const t0 = Date.now(); const gap = 0; // no fixed spacing between pages; a 429 returns waitMs (Retry-After/backoff) to the caller
    let last = 0;
    while (st.ci < st.cats.length && Date.now() - t0 < STEP_BUDGET_MS) {
      const cat = st.cats[st.ci]!;
      const wait = last ? gap - (Date.now() - last) : 0;
      if (wait > 0) { if (Date.now() - t0 + wait > STEP_BUDGET_MS) break; await sleep(wait); }
      last = Date.now();
      let page;
      try { page = parseCategoryPage(await get({ type: "category_page", content_type: ctype, cat: cat.id, page: String(st.page), limit: String(PAGE_LIMIT) }, `${cat.name} p.${st.page}`), data.kind); }
      catch (e) {
        if (e instanceof RateLimitedError) return { ...view(st, false), waitMs: e.retryAfterMs ?? backoffMs(1), error: "Limite de requisições do provedor (HTTP 429). A leitura continua sozinha após a espera." };
        // Category refused (e.g. adult PIN) or malformed: skip it, keep its old memberships, continue.
        st.skipped.push(`${cat.name}: ${scrub((e as Error).message).slice(0, 120)}`);
        st.ci++; st.page = 1; st.pages = null; continue;
      }
      await writePage(ctx, target, cat.name, page.items, st.startedAt);
      st.totals[cat.name] = page.total; st.rows += page.items.length; st.pages = page.pages;
      const n = nextCursor(st.ci, st.page, page.pages);
      if (n.ci !== st.ci) st.pages = null;
      st.ci = n.ci; st.page = n.page;
    }
    if (st.ci >= st.cats.length) { const fin = await finalize(ctx, target, st); return { ...view(st, true), ...fin }; }
    return view(st, false);
  });

function emptyView() { return { state: null as SyncState | null, done: false, catIndex: 0, catsTotal: 0, catName: "", page: 0, pages: null as number | null, rows: 0, skipped: [] as string[], waitMs: 0, error: null as string | null, distinct: null as number | null }; }
function view(st: SyncState, done: boolean) {
  return { ...emptyView(), state: done ? null : st, done, catIndex: st.ci, catsTotal: st.cats.length, catName: st.cats[Math.min(st.ci, st.cats.length - 1)]?.name ?? "", page: st.page, pages: st.pages, rows: st.rows, skipped: st.skipped };
}

async function writePage(ctx: Ctx, target: { kind: "series" } | { kind: "live"; integrationId: string }, category: string, items: { id: string; name: string; image: string | null; ext: string | null }[], now: string) {
  if (!items.length) return;
  const db = ctx.supabase;
  const uniq = [...new Map(items.map(i => [i.id, i])).values()];
  if (target.kind === "series") {
    const rows = uniq.map(i => { const { title, year } = parseBugouName(i.name); return { kind: "series", ext_id: i.id, title, title_norm: normTitle(title), title_compact: compactTitle(title), year, poster_url: i.image?.replace(/^http:\/\//, "https://") ?? null, category, seen_at: now }; }).filter(r => r.title);
    const a = await db.from("bugou_catalog").upsert(rows, { onConflict: "kind,ext_id" }); if (a.error) throw new Error(a.error.message);
    const b = await db.from("bugou_catalog_categories").upsert(rows.map(r => ({ kind: "series", ext_id: r.ext_id, category, seen_at: now })), { onConflict: "kind,ext_id,category" }); if (b.error) throw new Error(b.error.message);
  } else {
    const rows = uniq.map(i => ({ integration_id: target.integrationId, ext_id: i.id, name: i.name, logo_url: i.image?.replace(/^http:\/\//, "https://") ?? null, category, has_play: true, ext: i.ext, seen_at: now }));
    const a = await db.from("live_catalog").upsert(rows, { onConflict: "integration_id,ext_id" }); if (a.error) throw new Error(a.error.message);
    const b = await db.from("live_catalog_categories").upsert(rows.map(r => ({ integration_id: target.integrationId, ext_id: r.ext_id, category, seen_at: now })), { onConflict: "integration_id,ext_id,category" }); if (b.error) throw new Error(b.error.message);
  }
}

/** After every category was read: drop memberships not seen in this pass (except skipped categories); series index rows absent from the provider are dropped (series_info no longer knows them). Live rows are never deleted. */
async function finalize(ctx: Ctx, target: { kind: "series" } | { kind: "live"; integrationId: string }, st: SyncState) {
  const db = await admin();
  const skippedNames = st.skipped.map(s => s.split(": ")[0]!).filter(Boolean);
  const keep = (q: any) => skippedNames.length ? q.not("category", "in", `(${skippedNames.map(n => `"${n.replace(/"/g, '\\"')}"`).join(",")})`) : q;
  if (target.kind === "series") {
    const d1 = await keep(db.from("bugou_catalog_categories").delete().eq("kind", "series").lt("seen_at", st.startedAt)); if (d1.error) throw new Error(d1.error.message);
    if (!skippedNames.length) { const d2 = await db.from("bugou_catalog").delete().eq("kind", "series").lt("seen_at", st.startedAt); if (d2.error) throw new Error(d2.error.message); }
    const { count } = await db.from("bugou_catalog").select("ext_id", { count: "exact", head: true }).eq("kind", "series");
    await db.from("bugou_sync").upsert({ kind: "series", synced_at: new Date().toISOString(), total: count ?? 0 });
    const { integ } = await seriesIntegration();
    if (integ) await db.from("api_integrations").update({ last_synced_at: new Date().toISOString() }).eq("id", integ.id);
    return { distinct: count ?? 0 };
  }
  const d1 = await keep(db.from("live_catalog_categories").delete().eq("integration_id", target.integrationId).lt("seen_at", st.startedAt)); if (d1.error) throw new Error(d1.error.message);
  await db.from("api_integrations").update({ last_synced_at: new Date().toISOString() }).eq("id", target.integrationId);
  const { count } = await db.from("live_catalog").select("ext_id", { count: "exact", head: true }).eq("integration_id", target.integrationId).gte("seen_at", st.startedAt);
  void ctx;
  return { distinct: count ?? 0 };
}
