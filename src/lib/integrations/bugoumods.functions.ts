/* eslint-disable @typescript-eslint/no-explicit-any */
import { enrichContent } from "@/lib/tmdb/tmdb.functions";
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { linkCategories } from "./categories";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { assertStaff, uniqueSlug } from "@/lib/tmdb/tmdb.functions";
import { fetchProviderJson, RateLimitedError, MAX_RATE_LIMITED, MAX_ERRORS, backoffMs, minIntervalMs, adaptFactor, PROVIDER_429_BASE_MS, PROVIDER_429_CAP_MS } from "./ratelimit";
import { nextSafeRpm, SAFE_RPM_MAX } from "./ratelimit";
import { parseBugouName, parseBugouDetails, parseBugouMovieDetails, bugouVipEmbedUrl, mapBugouGenreSlugs, normTitle, compactTitle, type BugouSeries, type BugouDetails, type BugouMovieDetails } from "./bugoumods";

/**
 * BugouMods VIP series. The full list (one request, ~3k rows, no pagination offered by the provider)
 * is mirrored into the staff-only `bugou_catalog` index; searches read the index, never the provider.
 * Imports run as resumable jobs (`bugou_import_jobs/items`) driven in short server calls.
 * The vtoken stays server-side; the provider list "link" is never stored.
 */
type Ctx = { supabase: any; userId: string };
const SOURCE = "bugoumods";
const PAGE = 40;

const admin = async () => (await import("@/integrations/supabase/client.server")).supabaseAdmin as any;
type SeriesInteg = { id: string; is_active: boolean; request_count: number; timeout_seconds: number; rate_limit_per_minute: number } | null;

/** Token comes from the "BugouMods VIP — Séries" integration (service-role api_credentials); env secret is the legacy fallback. */
export async function seriesIntegration(): Promise<{ integ: SeriesInteg; tok: string }> {
  const db = await admin();
  const { data: integ } = await db.from("api_integrations").select("id, is_active, request_count, timeout_seconds, rate_limit_per_minute").eq("kind", "series").eq("provider", "bugoumods_series").order("priority").limit(1).maybeSingle();
  let raw = "";
  if (integ) {
    if (!integ.is_active) throw new Error("A integração BugouMods VIP — Séries está desativada.");
    const { data: cred } = await db.from("api_credentials").select("api_key, token").eq("integration_id", integ.id).maybeSingle();
    raw = String(cred?.token || cred?.api_key || "");
  }
  if (!raw) raw = process.env["BUGOUMODS_VTOKEN"] ?? "";
  raw = raw.trim().replace(/^"|"$/g, "");
  const m = raw.match(/vtoken=([^&"\s]+)/);
  const t = m?.[1] ? decodeURIComponent(m[1]) : raw;
  if (!t) throw new Error("Token do BugouMods não configurado. Atualize a credencial da integração de séries.");
  return { integ, tok: t };
}
async function token() { return (await seriesIntegration()).tok; }

/** Records a provider call in api_request_logs + integration status (token never logged). */
export async function logCall(integ: SeriesInteg, label: string, t0: number, err: string | null, status: number | null = null) {
  if (!integ) return;
  const db = await admin(); const now = new Date().toISOString();
  await db.from("api_request_logs").insert({ integration_id: integ.id, content_label: label, http_status: err ? status : 200, duration_ms: Date.now() - t0, success: !err, cached: false, error: err });
  await db.from("api_integrations").update({ last_tested_at: now, last_status: err ? "error" : "ok", last_error: err, request_count: Number(integ.request_count) + 1 }).eq("id", integ.id);
  integ.request_count = Number(integ.request_count) + 1;
}

const scrub = (s: string) => s.replace(/vtoken=[^&\s"]+/g, "vtoken=***");
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

/** Provider GET via the shared rate-limit helper (timeout from the integration, 429 never retried inline). */
async function getJson(url: URL, what: string, timeoutSeconds = 25): Promise<any> {
  return (await fetchProviderJson(url, what, { timeoutMs: Math.max(5, timeoutSeconds) * 1000 })).json;
}

async function loadAll(label = "Lista de séries"): Promise<BugouSeries[]> {
  const { integ, tok } = await seriesIntegration();
  const url = new URL("https://cinema.bugoumods.com/");
  url.search = new URLSearchParams({ api: "1", t: "series", c: "all", vtoken: tok }).toString();
  const t0 = Date.now(); let json: any;
  try {
    json = await getJson(url, "lista de séries");
    if (!json || typeof json !== "object" || Array.isArray(json)) throw new Error("Formato inesperado: a API não devolveu categorias.");
    if (json.Aviso) throw new Error(`BugouMods: ${scrub(String(json.Aviso?.[0]?.nome ?? "aviso do provedor"))} (token inválido ou vencido — atualize a credencial).`);
  } catch (e) { const msg = scrub((e as Error).message).slice(0, 400); await logCall(integ, label, t0, msg); throw new Error(msg); }
  await logCall(integ, label, t0, null);
  const seen = new Set<number>(); const items: BugouSeries[] = [];
  for (const [cat, list] of Object.entries(json)) {
    if (!Array.isArray(list)) continue;
    for (const it of list as any[]) {
      const id = Number(it?.id);
      if (!Number.isFinite(id) || id <= 0 || seen.has(id)) continue;
      seen.add(id);
      const { title, year } = parseBugouName(String(it.nome ?? ""));
      if (!title) continue;
      const capa = typeof it.capa === "string" && /^https?:\/\//.test(it.capa) ? it.capa.replace(/^http:\/\//, "https://") : null;
      items.push({ id: String(id), title, year, poster_url: capa, category: String(it.categoria ?? cat) });
    }
  }
  return items;
}

async function refreshIndex(ctx: Ctx, label?: string) {
  const all = await loadAll(label);
  const now = new Date().toISOString();
  for (let i = 0; i < all.length; i += 500) {
    const rows = all.slice(i, i + 500).map(s => ({ kind: "series", ext_id: s.id, title: s.title, title_norm: normTitle(s.title), title_compact: compactTitle(s.title), year: s.year, poster_url: s.poster_url, category: s.category, seen_at: now }));
    const r = await ctx.supabase.from("bugou_catalog").upsert(rows, { onConflict: "kind,ext_id" });
    if (r.error) throw new Error(r.error.message);
  }
  // The c=all list caps categories at 50, so it never deletes: removals happen only in the full paginated sync (catalog-sync.functions.ts).
  for (let i = 0; i < all.length; i += 500) {
    const m = await ctx.supabase.from("bugou_catalog_categories").upsert(all.slice(i, i + 500).map(s => ({ kind: "series", ext_id: s.id, category: s.category, seen_at: now })), { onConflict: "kind,ext_id,category" });
    if (m.error) throw new Error(m.error.message);
  }
  const r = await ctx.supabase.from("bugou_sync").upsert({ kind: "series", synced_at: now, total: all.length });
  if (r.error) throw new Error(r.error.message);
  return { total: all.length, synced_at: now };
}

async function ensureIndex(ctx: Ctx, force: boolean) {
  const { data } = await ctx.supabase.from("bugou_sync").select("synced_at, total").eq("kind", "series").maybeSingle();
  if (!force && data) return data as { synced_at: string; total: number };
  return refreshIndex(ctx);
}

/** One series_info call (the provider's only per-series endpoint: seasons + episodes in a single response). */
async function loadDetails(id: string, label?: string): Promise<BugouDetails> {
  const { integ, tok } = await seriesIntegration();
  const url = new URL("https://cinema.bugoumods.com/index.php");
  url.search = new URLSearchParams({ ajax: "1", type: "series_info", series_id: id, vtoken: tok }).toString();
  const t0 = Date.now();
  try {
    const json = await getJson(url, "episódios", integ?.timeout_seconds ?? 25);
    if (label) await logCall(integ, label, t0, null);
    return parseBugouDetails(id, json);
  } catch (e) {
    if (label) await logCall(integ, label, t0, scrub((e as Error).message).slice(0, 400), e instanceof RateLimitedError ? 429 : null);
    throw e;
  }
}

async function findLocalSeries(ctx: Ctx, id: string, title: string, year: number | null): Promise<string | null> {
  const { data: ext } = await ctx.supabase.from("series").select("id").eq("external_source", SOURCE).eq("external_id", id).maybeSingle();
  if (ext) return ext.id;
  if (!title) return null;
  let qb = ctx.supabase.from("series").select("id").ilike("title", title.replace(/[%_\\]/g, "\\$&")).limit(1);
  if (year) qb = qb.eq("release_year", year);
  const { data: same } = await qb;
  return same?.[0]?.id ?? null;
}

type ImportResult = { seriesId: string | null; seriesCreated: boolean; seasonsFound: number; episodesTotal: number; seasonsCreated: number; episodesCreated: number; episodesExisting: number; sourcesCreated: number; sourcesExisting: number; episodesSaved: number; withPlayer: number; withoutPlayer: number; complete: boolean; skipped?: string };
/** Not retryable: the provider does not know this series id. */
class PermanentError extends Error {}

/**
 * Full idempotent import of one series: metadata, every season, every episode and its VIP player.
 * Existing rows are reused; only empty metadata fields are filled; nothing is deleted.
 */
async function importSeriesFull(ctx: Ctx, id: string, onlySeasons?: number[], pre?: BugouDetails): Promise<ImportResult> {
  const db = ctx.supabase;
  const d = pre ?? await loadDetails(id);
  const want = onlySeasons ? d.seasons.filter(s => onlySeasons.includes(s.season)) : d.seasons;
  const apiEpisodes = want.reduce((n, s) => n + s.episodes.length, 0);
  if (!apiEpisodes && !d.title) throw new PermanentError(`A API não reconhece a série ID ${id} (resposta vazia). O índice pode estar desatualizado ou o token foi trocado — clique em "Atualizar índice".`);
  let seriesId = await findLocalSeries(ctx, id, d.title, d.year); let seriesCreated = false;
  let listed: any = null;
  if (!d.title || !d.cover || !d.year) { const { data } = await db.from("bugou_catalog").select("title, year, poster_url").eq("kind", "series").eq("ext_id", id).maybeSingle(); listed = data; }
  const title = d.title || listed?.title; const year = d.year ?? listed?.year ?? null; const cover = d.cover ?? listed?.poster_url ?? null;
  if (!seriesId && !apiEpisodes) {
    return { seriesId: null, seriesCreated: false, seasonsFound: 0, episodesTotal: 0, seasonsCreated: 0, episodesCreated: 0, episodesExisting: 0, sourcesCreated: 0, sourcesExisting: 0, episodesSaved: 0, withPlayer: 0, withoutPlayer: 0, complete: false, skipped: "A API não disponibiliza episódios para esta série; ela não foi adicionada ao catálogo." };
  }
  if (!seriesId) {
    if (!title) throw new Error("Série sem nome na resposta da API.");
    const slug = await uniqueSlug(ctx, "series", title, year);
    const r = await db.from("series").insert({ title, release_year: year, poster_url: cover, description: d.plot, backdrop_url: d.backdrop ?? null, first_air_date: d.releaseDate ?? null, vote_average: d.rating ?? null, trailer_url: d.trailer ?? null, slug, status: "published", external_source: SOURCE, external_id: id }).select("id").single();
    if (r.error) throw new Error(r.error.message);
    seriesId = r.data.id as string; seriesCreated = true;
  } else {
    const { data: cur } = await db.from("series").select("description, poster_url, release_year, backdrop_url, first_air_date, vote_average, trailer_url, external_source, external_id").eq("id", seriesId).single();
    const patch: any = {};
    if (cur && !cur.backdrop_url && d.backdrop) patch.backdrop_url = d.backdrop;
    if (cur && !cur.first_air_date && d.releaseDate) patch.first_air_date = d.releaseDate;
    if (cur && !cur.vote_average && d.rating) patch.vote_average = d.rating;
    if (cur && !cur.trailer_url && d.trailer) patch.trailer_url = d.trailer;
    if (cur && !cur.description && d.plot) patch.description = d.plot;
    if (cur && !cur.poster_url && cover) patch.poster_url = cover;
    if (cur && !cur.release_year && year) patch.release_year = year;
    if (cur && !cur.external_id) { patch.external_source = SOURCE; patch.external_id = id; }
    if (Object.keys(patch).length) { const u = await db.from("series").update(patch).eq("id", seriesId); if (u.error) throw new Error(u.error.message); }
  }
  // Original provider categories (all memberships from the paginated index + the list's own category).
  {
    const [{ data: mem }, { data: row }] = await Promise.all([
      db.from("bugou_catalog_categories").select("category").eq("kind", "series").eq("ext_id", id),
      db.from("bugou_catalog").select("category").eq("kind", "series").eq("ext_id", id).maybeSingle(),
    ]);
    await linkCategories(await admin(), "series", seriesId!, [row?.category, ...((mem ?? []) as any[]).map(m => m.category)]);
  }
  if (d.genres?.length) await linkProviderGenres(await admin(), "series", seriesId!, d.genres);
  const out: ImportResult = { seriesId: seriesId!, seriesCreated, seasonsFound: want.length, episodesTotal: apiEpisodes, seasonsCreated: 0, episodesCreated: 0, episodesExisting: 0, sourcesCreated: 0, sourcesExisting: 0, episodesSaved: 0, withPlayer: 0, withoutPlayer: 0, complete: false };
  if (!apiEpisodes) return out;
  // One set-based RPC per series: seasons, episodes and VIP sources upserted + verified by re-read, one summary audit row.
  const vtok = await token();
  const sm = new Map((d.seasonMeta ?? []).map(x => [x.season, x]));
  const items = want.flatMap(s => s.episodes.map(e => {
    const m = sm.get(s.season);
    return { s: s.season, e: e.episode, ref: `bugoumods:${e.id}`, t: e.title, img: e.image, dur: e.duration_minutes, url: bugouVipEmbedUrl(e.id, e.ext, vtok),
      d: e.plot ?? null, dt: e.release_date ?? null, v: e.rating ?? null, tm: e.tmdb_id ?? null,
      sd: m?.overview ?? null, sa: m?.air_date ?? null, sp: m?.cover ?? null, st: m?.tmdb_id ?? null };
  }));
  const r = await (await admin()).rpc("bugou_apply_series", { _series_id: seriesId, _items: items, _actor: ctx.userId || null });
  if (r.error) throw new Error(r.error.message);
  await enrichContent({ supabase: await admin(), userId: "" }, "series", seriesId);
  const x = r.data as { items: number; seasons: number; episodes: number; sources_new: number; sources_updated: number; saved: number; with_player: number };
  out.seasonsCreated = x.seasons; out.episodesCreated = x.episodes; out.episodesExisting = Math.max(0, x.items - x.episodes);
  out.sourcesCreated = x.sources_new; out.sourcesExisting = Math.max(0, x.items - x.sources_new);
  out.episodesSaved = x.saved; out.withPlayer = x.with_player; out.withoutPlayer = apiEpisodes - x.with_player;
  out.complete = x.saved === apiEpisodes && x.with_player === apiEpisodes;
  return out;
}

const auth = [requireSupabaseAuth] as const;

export const bugouSearchSeries = createServerFn({ method: "POST" })
  .middleware([...auth])
  .inputValidator((d) => z.object({ query: z.string().trim().max(200).default(""), category: z.string().max(200).default(""), page: z.number().int().min(0).max(1000).default(0), refresh: z.boolean().default(false), withCategories: z.boolean().default(false) }).parse(d))
  .handler(async ({ data, context }) => {
    const ctx = context as Ctx; const db = ctx.supabase;
    await assertStaff(ctx);
    const sync = await ensureIndex(ctx, data.refresh);
    const q = normTitle(data.query);
    const run = async (compact: boolean) => {
      let qb = db.from("bugou_catalog").select(data.category ? "ext_id, title, year, poster_url, category, title_norm, bugou_catalog_categories!inner(category)" : "ext_id, title, year, poster_url, category, title_norm", { count: "exact" }).eq("kind", "series");
      if (q) {
        if (compact) qb = qb.ilike("title_compact", `%${q.replace(/ /g, "")}%`);
        else for (const t of q.split(" ")) qb = qb.ilike("title_norm", `%${t}%`);
      }
      if (data.category) qb = qb.eq("bugou_catalog_categories.category", data.category);
      return qb.order("title_norm").order("ext_id").range(data.page * PAGE, data.page * PAGE + PAGE - 1);
    };
    let r = await run(false);
    if (!r.error && q && !r.count) r = await run(true);
    if (r.error) throw new Error(r.error.message);
    const rows = (r.data ?? []) as any[];
    if (q) rows.sort((a, b) => { const k = (s: string) => (s === q ? 0 : s.startsWith(q) ? 1 : 2); return k(a.title_norm) - k(b.title_norm); });
    const results: BugouSeries[] = rows.map(x => ({ id: x.ext_id, title: x.title, year: x.year, poster_url: x.poster_url, category: x.category ?? "" }));
    const existing: Record<string, string> = {};
    if (results.length) {
      const { data: byExt } = await db.from("series").select("id, external_id").eq("external_source", SOURCE).in("external_id", results.map(x => x.id));
      (byExt ?? []).forEach((x: any) => { existing[x.external_id] = x.id; });
      const rest = results.filter(x => !existing[x.id]);
      if (rest.length) {
        const { data: byTitle } = await db.from("series").select("id, title, release_year").in("title", [...new Set(rest.map(x => x.title))]);
        for (const x of rest) {
          const m = (byTitle ?? []).find((s: any) => normTitle(s.title) === normTitle(x.title) && (!x.year || !s.release_year || s.release_year === x.year));
          if (m) existing[x.id] = m.id;
        }
      }
    }
    let categories: string[] = [];
    if (data.withCategories) {
      const set = new Set<string>();
      for (let from = 0; from < 200000; from += 1000) {
        const { data: c } = await db.from("bugou_catalog_categories").select("category").eq("kind", "series").order("category").range(from, from + 999);
        (c ?? []).forEach((x: any) => x.category && set.add(x.category));
        if (!c || c.length < 1000) break;
      }
      categories = [...set].sort();
    }
    return { total: sync.total, synced_at: sync.synced_at, matches: r.count ?? 0, page: data.page, pageSize: PAGE, categories, results, existing };
  });

/** Seasons/episodes preview + what already exists locally for this series. */
export const bugouSeriesDetails = createServerFn({ method: "POST" })
  .middleware([...auth])
  .inputValidator((d) => z.object({ id: z.string().regex(/^\d+$/) }).parse(d))
  .handler(async ({ data, context }) => {
    const ctx = context as Ctx;
    await assertStaff(ctx);
    const details = await loadDetails(data.id, "Prévia de episódios");
    const local = await findLocalSeries(ctx, data.id, details.title, details.year);
    const existingEpisodes: string[] = [];
    if (local) {
      const { data: rows } = await ctx.supabase.from("episodes").select("episode_number, seasons!inner(season_number, series_id)").eq("seasons.series_id", local);
      (rows ?? []).forEach((r: any) => existingEpisodes.push(`${r.seasons.season_number}x${r.episode_number}`));
    }
    return { details, localSeriesId: local, existingEpisodes };
  });

/** Import chosen seasons of one series (used by the preview dialog). */
export const bugouImportEpisodes = createServerFn({ method: "POST" })
  .middleware([...auth])
  .inputValidator((d) => z.object({ id: z.string().regex(/^\d+$/), seasons: z.array(z.number().int().min(0).max(500)).min(1).max(100) }).parse(d))
  .handler(async ({ data, context }) => {
    const ctx = context as Ctx;
    await assertStaff(ctx);
    return importSeriesFull(ctx, data.id, data.seasons);
  });

// ---------- Resumable import jobs ----------

type JobStats = { safe_rpm?: number | null; skipped_imported?: number; db_throttled?: number; requests?: number; http429?: number; rate_factor?: number; seasons?: number; episodes_total?: number; with_player?: number; no_episodes?: number; concurrency?: number };
export const MAX_CONCURRENCY = 6;

async function jobView(ctx: Ctx, jobId: string) {
  const db = ctx.supabase;
  const { data: job, error } = await db.from("bugou_import_jobs").select("*").eq("id", jobId).single();
  if (error) throw new Error(error.message);
  const since = new Date(Date.now() - 5 * 60_000).toISOString();
  const [{ data: failures }, c, { data: nxt }, recent, { data: cur }] = await Promise.all([
    db.from("bugou_import_items").select("ext_id, title, error, attempts, rate_limited, step").eq("job_id", jobId).eq("state", "failed").order("updated_at", { ascending: false }).limit(20),
    recount(ctx, jobId),
    db.from("bugou_import_items").select("next_attempt_at").eq("job_id", jobId).eq("state", "pending").gt("next_attempt_at", new Date().toISOString()).order("next_attempt_at").limit(1),
    db.from("bugou_import_items").select("ext_id", { count: "exact", head: true }).eq("job_id", jobId).eq("state", "done").gte("updated_at", since),
    db.from("bugou_import_items").select("ext_id, title").eq("job_id", jobId).eq("state", "processing").limit(1),
  ]);
  const st = (job.stats ?? {}) as JobStats;
  const throttle = job.throttle_until && Date.parse(job.throttle_until) > Date.now() ? job.throttle_until : null;
  const perMin = Math.round(((recent.count ?? 0) / 5) * 10) / 10; // series completed per minute over the last 5 min
  const left = c.pending + c.processing;
  return { ...job, pending: left, queued: c.pending - c.waiting, processing: c.processing, waiting: c.waiting, next_retry_at: throttle ?? nxt?.[0]?.next_attempt_at ?? null, throttled: !!throttle, requests: st.requests ?? 0, http429: st.http429 ?? 0, seasons: st.seasons ?? 0, with_player: st.with_player ?? 0, no_episodes: st.no_episodes ?? 0, concurrency: 1, current: cur?.[0] ? (cur[0].title ?? cur[0].ext_id) : null, last_error: (failures ?? [])[0]?.error ?? null, avg_ms: (st as any).items_timed ? Math.round((st as any).items_ms / (st as any).items_timed) : null, per_min: perMin, eta_min: perMin > 0 && left ? Math.ceil(left / perMin) : null, failures: failures ?? [] };
}

async function recount(ctx: Ctx, jobId: string) {
  const db = ctx.supabase;
  const c = async (state: string, waiting = false) => { let q = db.from("bugou_import_items").select("ext_id", { count: "exact", head: true }).eq("job_id", jobId).eq("state", state); if (waiting) q = q.gt("next_attempt_at", new Date().toISOString()); return (await q).count ?? 0; };
  const [done, failed, pending, processing, waiting] = await Promise.all([c("done"), c("failed"), c("pending"), c("processing"), c("pending", true)]);
  return { done, failed, pending, processing, waiting };
}

/** Most recent safe pace learned by any series job in the last 6h (null = never throttled, run unpaced). */
async function learnedRpm(ctx: Ctx): Promise<number | null> {
  const { data } = await ctx.supabase.from("bugou_import_jobs").select("stats").neq("kind", "live").gt("updated_at", new Date(Date.now() - 6 * 3600_000).toISOString()).order("updated_at", { ascending: false }).limit(10);
  for (const j of data ?? []) { const v = Number((j as any).stats?.safe_rpm); if (v > 0) return v; }
  return null;
}

/** Latest provider throttle across all series jobs: one 429 pauses every series queue. */
async function globalThrottle(ctx: Ctx): Promise<number> {
  const { data } = await ctx.supabase.from("bugou_import_jobs").select("throttle_until").neq("kind", "live").not("throttle_until", "is", null).order("throttle_until", { ascending: false }).limit(1);
  return data?.[0]?.throttle_until ? Date.parse(data[0].throttle_until) : 0;
}

export const bugouCreateJob = createServerFn({ method: "POST" })
  .middleware([...auth])
  .inputValidator((d) => z.object({ ids: z.array(z.string().regex(/^\d+$/)).default([]), allMissing: z.boolean().default(false), category: z.string().max(200).optional(), repairEmpty: z.boolean().default(false), repairMetadata: z.boolean().default(false) }).parse(d))
  .handler(async ({ data, context }) => {
    const ctx = context as Ctx; const db = ctx.supabase;
    await assertStaff(ctx);
    let items: { ext_id: string; title: string | null }[] = [];
    let unmatched: string[] = [];
    if (data.repairMetadata) {
      // Re-read every imported BugouMods series; the import is fill-only, so manual data and links are kept.
      for (let from = 0; ; from += 1000) {
        const { data: s, error } = await db.from("series").select("external_id, title").eq("external_source", SOURCE).order("id").range(from, from + 999);
        if (error) throw new Error(error.message);
        items.push(...((s ?? []) as any[]).filter(x => /^\d+$/.test(String(x.external_id))).map(x => ({ ext_id: String(x.external_id), title: x.title })));
        if (!s || s.length < 1000) break;
      }
    } else if (data.repairEmpty) {
      // Existing BugouMods series without seasons: locate the current provider id (same id, else unique exact title+year) and queue them.
      await ensureIndex(ctx, true);
      const empty: any[] = [];
      for (let from = 0; ; from += 1000) {
        const { data: s, error } = await db.from("series").select("id, title, release_year, external_id, seasons(id)").eq("external_source", SOURCE).range(from, from + 999);
        if (error) throw new Error(error.message);
        empty.push(...(s ?? []).filter((x: any) => !x.seasons?.length));
        if (!s || s.length < 1000) break;
      }
      for (const s of empty) {
        const { data: same } = await db.from("bugou_catalog").select("ext_id, title").eq("kind", "series").eq("ext_id", s.external_id).maybeSingle();
        if (same) { items.push(same); continue; }
        const { data: cands } = await db.from("bugou_catalog").select("ext_id, title, year").eq("kind", "series").eq("title_norm", normTitle(s.title));
        const ok = (cands ?? []).filter((c: any) => !c.year || !s.release_year || c.year === s.release_year);
        const ids = [...new Set(ok.map((c: any) => c.ext_id))];
        if (ids.length !== 1) { unmatched.push(s.title); continue; }
        const u = await db.from("series").update({ external_id: ids[0] }).eq("id", s.id);
        if (u.error) { unmatched.push(s.title); continue; }
        items.push({ ext_id: ids[0] as string, title: s.title });
      }
      if (!items.length) throw new Error(empty.length ? `${empty.length} série(s) sem episódios, mas nenhuma existe na lista atual da API VIP (ex.: ${unmatched.slice(0, 3).join(", ")}).` : "Nenhuma série importada está sem episódios.");
    } else if (data.allMissing) {
      await ensureIndex(ctx, false);
      const imported = new Set<string>();
      for (let from = 0; ; from += 1000) {
        const { data: s } = await db.from("series").select("external_id").eq("external_source", SOURCE).range(from, from + 999);
        (s ?? []).forEach((x: any) => imported.add(x.external_id));
        if (!s || s.length < 1000) break;
      }
      for (let from = 0; ; from += 1000) {
        const { data: c, error } = await db.from("bugou_catalog").select("ext_id, title").eq("kind", "series").order("title_norm").range(from, from + 999);
        if (error) throw new Error(error.message);
        (c ?? []).forEach((x: any) => { if (!imported.has(x.ext_id)) items.push(x); });
        if (!c || c.length < 1000) break;
      }
    } else if (data.category && !data.ids.length) {
      await ensureIndex(ctx, false);
      for (let from = 0; ; from += 1000) {
        const { data: c, error } = await db.from("bugou_catalog").select("ext_id, title, bugou_catalog_categories!inner(category)").eq("kind", "series").eq("bugou_catalog_categories.category", data.category).order("title_norm").order("ext_id").range(from, from + 999);
        if (error) throw new Error(error.message);
        items.push(...((c ?? []) as any[]).map((x: any) => ({ ext_id: x.ext_id, title: x.title })));
        if (!c || c.length < 1000) break;
      }
    } else {
      // Large manual selections are looked up in bounded DB queries, but are not capped by the application.
      const selectedIds = [...new Set(data.ids)];
      const t = new Map<string, string>();
      for (let i = 0; i < selectedIds.length; i += 500) {
        const { data: c, error } = await db.from("bugou_catalog").select("ext_id, title").eq("kind", "series").in("ext_id", selectedIds.slice(i, i + 500));
        if (error) throw new Error(error.message);
        (c ?? []).forEach((x: any) => t.set(x.ext_id, x.title));
      }
      items = selectedIds.map(id => ({ ext_id: id, title: t.get(id) ?? null }));
    }
    if (!items.length) throw new Error("Nada para importar.");
    let skipped = 0;
    const label = data.repairMetadata ? `Completar metadados das séries importadas (${items.length})` : data.repairEmpty ? `Completar séries sem episódios (${items.length})` : data.allMissing ? "Todas as séries não importadas" : data.category && !data.ids.length ? `Categoria ${data.category} (todas)`.slice(0, 200) : `${items.length} série(s) selecionada(s)`;
    // Same queue already open (running/paused): reuse it instead of a second job spending the same provider quota.
    const { data: open } = await db.from("bugou_import_jobs").select("id").eq("kind", "series").eq("label", label).in("status", ["running", "paused"]).limit(1);
    if (open?.length) { await db.from("bugou_import_jobs").update({ status: "running" }).eq("id", open[0].id); const workerArmed = await armWorker(); return { ...(await jobView(ctx, open[0].id)), unmatched, workerArmed, reused: true, skipped }; }
    if (!data.repairMetadata && !data.repairEmpty) {
      // Already imported with episodes: no series_info call needed (repairs are the explicit way to re-read them).
      const have = new Set<string>();
      const ids = [...new Set(items.map(x => x.ext_id))];
      for (let i = 0; i < ids.length; i += 300) {
        const { data: s, error } = await db.from("series").select("external_id, seasons!inner(id)").eq("external_source", SOURCE).in("external_id", ids.slice(i, i + 300));
        if (error) throw new Error(error.message);
        (s ?? []).forEach((x: any) => have.add(String(x.external_id)));
      }
      const before = items.length; items = items.filter(x => !have.has(x.ext_id)); skipped = before - items.length;
      if (!items.length) throw new Error(`Todas as ${before} série(s) já estão importadas com episódios. Use "Completar metadados" para relê-las.`);
    }
    const j = await db.from("bugou_import_jobs").insert({ label: skipped ? `${label} — ${skipped} já importada(s) ignorada(s)`.slice(0, 200) : label, total: items.length, created_by: ctx.userId }).select("id").single();
    if (j.error) throw new Error(j.error.message);
    for (let i = 0; i < items.length; i += 500) {
      const r = await db.from("bugou_import_items").insert(items.slice(i, i + 500).map(x => ({ job_id: j.data.id, ext_id: x.ext_id, title: x.title })));
      if (r.error) throw new Error(r.error.message);
    }
    const workerArmed = await armWorker();
    return { ...(await jobView(ctx, j.data.id)), unmatched, workerArmed, reused: false, skipped };
  });

/**
 * Core queue runner shared by the admin screen and the background worker.
 * Under a job lease it claims waves of up to `concurrency` due series and processes them in parallel:
 * series_info calls start on a shared schedule paced by the integration's requests-per-minute, while
 * DB writes (one set-based RPC per series) overlap with the next provider calls. Concurrency grows by 1
 * after each clean wave (max MAX_CONCURRENCY) and halves on 429/DB throttle. A 429 defers the item
 * (Retry-After or jittered backoff), pauses every series queue and stops calling the provider.
 */
export async function runSeriesJob(ctx: Ctx, jobId: string, budgetMs: number, resume = false) {
  const db = ctx.supabase;
  if (resume) await db.from("bugou_import_jobs").update({ status: "running" }).eq("id", jobId).eq("status", "paused");
  const now = new Date();
  const lease = await db.from("bugou_import_jobs").update({ lease_until: new Date(now.getTime() + budgetMs + 30_000).toISOString(), status: "running" })
    .eq("id", jobId).not("status", "in", "(cancelled,paused,done)").or(`lease_until.is.null,lease_until.lt.${now.toISOString()}`).select("id, episodes_created, stats");
  if (lease.error) throw new Error(lease.error.message);
  if (!lease.data?.length) return { busy: true };
  await db.from("bugou_import_items").update({ state: "pending" }).eq("job_id", jobId).eq("state", "processing");
  let episodes = lease.data[0].episodes_created as number;
  const st: JobStats = { requests: 0, http429: 0, rate_factor: 1, seasons: 0, episodes_total: 0, concurrency: 4, ...(lease.data[0].stats ?? {}) };
  st.rate_factor = Math.max(0.25, st.rate_factor ?? 1); // older runs could persist a 1/8 pace
  // Provider pace learned from real 429s, shared by every series job (same token = same quota).
  if (!st.safe_rpm) st.safe_rpm = await learnedRpm(ctx);
  let okStreak = 0; const starts: number[] = [];
  let throttleUntil: string | null = null; let stop = false;
  const started = Date.now(); let nextSlot = 0;
  const stamp = () => new Date().toISOString();
  /** Fresh status read: a pause/cancel from the admin stops new provider calls and new writes for this job. */
  const halted = async () => {
    if (stop) return true;
    const { data } = await db.from("bugou_import_jobs").select("status").eq("id", jobId).single();
    if (data?.status === "paused" || data?.status === "cancelled") stop = true;
    return stop;
  };
  /** Reserves the next provider call slot; false when it would fall outside the budget. */
  const slot = async () => {
    // After a 429 in this wave, no new provider call starts before the provider's wait has passed.
    const tu = throttleUntil ? Date.parse(throttleUntil) : 0;
    const t = Math.max(Date.now(), nextSlot, tu);
    if (t - started > budgetMs) return false;
    // Unpaced until the provider answers 429; afterwards calls are spaced at the learned safe pace (no fixed waits otherwise).
    nextSlot = st.safe_rpm ? t + Math.ceil(60_000 / st.safe_rpm) : t;
    if (t > Date.now()) await sleep(t - Date.now());
    starts.push(Date.now());
    return !stop;
  };

  type It = { ext_id: string; title: string | null; attempts: number; rate_limited: number; details: any };
  const processOne = async (it: It): Promise<"ok" | "throttle" | "err" | "skip"> => {
    const upd = (patch: any) => db.from("bugou_import_items").update({ ...patch, updated_at: stamp() }).eq("job_id", jobId).eq("ext_id", it.ext_id);
    try {
      let details = it.details as BugouDetails | null;
      if (await halted()) { await upd({ state: "pending" }); return "skip"; }
      if (!details) {
        if (!(await slot())) { await upd({ state: "pending" }); return "skip"; }
        st.requests = (st.requests ?? 0) + 1;
        details = await loadDetails(it.ext_id, `Importação: ${it.title ?? it.ext_id}`);
        st.rate_factor = adaptFactor(st.rate_factor ?? 1, "ok");
        if (st.safe_rpm && ++okStreak >= 10) { okStreak = 0; st.safe_rpm = Math.min(SAFE_RPM_MAX, st.safe_rpm + 1); }
        await upd({ details, step: "episodes", seasons_found: details.seasons.length, error: null });
        // Cancelled while the provider call was in flight: keep the cached details, write nothing to the catalog.
        if (await halted()) { await upd({ state: "pending" }); return "skip"; }
      }
      const res = await importSeriesFull(ctx, it.ext_id, undefined, details);
      episodes += res.episodesCreated; st.seasons = (st.seasons ?? 0) + res.seasonsCreated;
      st.with_player = (st.with_player ?? 0) + res.withPlayer; st.no_episodes = (st.no_episodes ?? 0) + (res.episodesTotal ? 0 : 1);
      const base = { result: res, series_id: res.seriesId, seasons_found: res.seasonsFound, episodes_imported: res.episodesSaved, episodes_pending: Math.max(0, res.episodesTotal - res.episodesSaved) };
      if (res.complete || !res.episodesTotal) {
        await upd({ ...base, state: "done", step: "done", attempts: it.attempts + 1, error: res.episodesTotal ? null : (res.skipped ?? "A API não disponibiliza episódios para esta série."), details: null, next_attempt_at: null });
        return "ok";
      }
      await upd(base);
      throw new Error(`Verificação incompleta: ${res.episodesSaved}/${res.episodesTotal} episódios salvos, ${res.withPlayer} com player VIP.`);
    } catch (e) {
      const msg = scrub(e instanceof Error ? e.message : String(e)).slice(0, 500);
      if (e instanceof RateLimitedError) {
        // Real provider 429: wait the provider's hint (Retry-After / RateLimit reset) or a short backoff, then the queue resumes by itself.
        st.http429 = (st.http429 ?? 0) + 1; st.rate_factor = adaptFactor(st.rate_factor ?? 1, "429");
        st.safe_rpm = nextSafeRpm(st.safe_rpm ?? null, starts.filter(t => t > Date.now() - 60_000).length); okStreak = 0;
        const rl = it.rate_limited + 1;
        const until = new Date(Date.now() + (e.retryAfterMs ?? backoffMs(Math.min(rl, 6), PROVIDER_429_BASE_MS, PROVIDER_429_CAP_MS))).toISOString();
        if (!throttleUntil || until > throttleUntil) throttleUntil = until;
        console.warn("bugou 429", it.ext_id, e.retryAfterMs ?? "no-hint", until);
        await upd({ state: "pending", rate_limited: rl, error: `${msg} Retomada automática programada.`, next_attempt_at: until });
        return "throttle";
      }
      if (/rate limit|too many requests|try again in a minute|statement timeout|canceling statement/i.test(msg)) {
        st.db_throttled = (st.db_throttled ?? 0) + 1;
        const rl = it.rate_limited + 1;
        await upd(rl >= MAX_RATE_LIMITED
          ? { state: "failed", rate_limited: rl, error: "Limite temporário do banco ao salvar episódios. Tentativas automáticas esgotadas — use \"Tentar de novo só as falhas\".", next_attempt_at: null }
          : { state: "pending", rate_limited: rl, error: "Limite temporário do banco ao salvar episódios. Nova tentativa programada.", next_attempt_at: new Date(Date.now() + backoffMs(rl, 20_000)).toISOString() });
        return "throttle";
      }
      const attempts = e instanceof PermanentError ? MAX_ERRORS : it.attempts + 1;
      await upd(attempts >= MAX_ERRORS ? { state: "failed", attempts, error: msg, next_attempt_at: null } : { state: "pending", attempts, error: msg, next_attempt_at: new Date(Date.now() + backoffMs(attempts, 10_000)).toISOString() });
      return "err";
    }
  };

  while (!stop && Date.now() - started < budgetMs - 3000) {
    // Provider wait inside this run's budget: sleep it out here instead of ending the run (the next run would start up to a minute later).
    const gt = await globalThrottle(ctx);
    if (gt > Date.now()) { if (gt - started > budgetMs - 8000) break; await sleep(gt - Date.now() + 200); continue; }
    const { data: cur } = await db.from("bugou_import_jobs").select("status").eq("id", jobId).single();
    if (cur?.status === "paused" || cur?.status === "cancelled") { stop = true; break; }
    // One series at a time per queue: the next one starts as soon as the previous finishes (no fixed gap).
    const n = 1; const tItem = Date.now();
    const { data: due } = await db.from("bugou_import_items").select("ext_id, title, attempts, rate_limited, details").eq("job_id", jobId).eq("state", "pending").or(`next_attempt_at.is.null,next_attempt_at.lte.${stamp()}`).order("attempts").order("ext_id").limit(n);
    if (!due?.length) break;
    // Never process the same series in two jobs at once (one query for the whole wave).
    const { data: busy } = await db.from("bugou_import_items").select("ext_id").in("ext_id", due.map((x: any) => x.ext_id)).eq("state", "processing").neq("job_id", jobId).gt("updated_at", new Date(Date.now() - 120_000).toISOString());
    const busySet = new Set((busy ?? []).map((x: any) => x.ext_id));
    if (busySet.size) await db.from("bugou_import_items").update({ next_attempt_at: new Date(Date.now() + 30_000).toISOString() }).eq("job_id", jobId).in("ext_id", [...busySet]);
    const wave = (due as It[]).filter(x => !busySet.has(x.ext_id));
    if (!wave.length) continue;
    await db.from("bugou_import_items").update({ state: "processing", updated_at: stamp() }).eq("job_id", jobId).in("ext_id", wave.map(x => x.ext_id));
    const out = await Promise.all(wave.map(processOne));
    st.concurrency = 1; (st as any).last_ms = Date.now() - tItem;
    if (out[0] === "ok") { (st as any).items_ms = ((st as any).items_ms ?? 0) + (st as any).last_ms; (st as any).items_timed = ((st as any).items_timed ?? 0) + 1; }
    const c = await recount(ctx, jobId);
    await db.from("bugou_import_jobs").update({ done: c.done, failed: c.failed, episodes_created: episodes, stats: st, updated_at: stamp(), ...(throttleUntil ? { throttle_until: throttleUntil } : {}) }).eq("id", jobId);
    if (out.includes("skip")) break;
  }
  const c = await recount(ctx, jobId);
  const left = c.pending + c.processing;
  const patch: any = { done: c.done, failed: c.failed, episodes_created: episodes, stats: st, lease_until: null, updated_at: stamp() };
  const { data: cur } = await db.from("bugou_import_jobs").select("status").eq("id", jobId).single();
  if (cur?.status === "running") patch.status = left ? "running" : "done";
  if (throttleUntil) patch.throttle_until = throttleUntil;
  await db.from("bugou_import_jobs").update(patch).eq("id", jobId);
  return { busy: false, left };
}

const PROJECT_ID = "a60e024f-d8d7-4202-815f-86d1103dd07c";
/** Arms the background worker schedule (removed by the worker when the queue drains). Preview runs target the preview build. */
async function armWorker(): Promise<boolean> {
  try {
    const { getRequest } = await import("@tanstack/react-start/server");
    const host = new URL(getRequest().url).host;
    const dev = /localhost|preview|-dev\.|127\.0\.0\.1|sandbox/.test(host);
    const url = `https://project--${PROJECT_ID}${dev ? "-dev" : ""}.lovable.app/api/public/hooks/bugou-import`;
    const key = process.env["SUPABASE_PUBLISHABLE_KEY"] ?? "";
    if (!key) throw new Error("SUPABASE_PUBLISHABLE_KEY não configurada");
    const { error } = await (await admin()).rpc("bugou_worker_arm", { _url: url, _key: key });
    if (error) throw new Error(error.message);
    return true;
  } catch (e) {
    console.error("bugou worker arm failed", (e as Error).message);
    return false;
  }
}

export const bugouRunJob = createServerFn({ method: "POST" })
  .middleware([...auth])
  .inputValidator((d) => z.object({ jobId: z.string().uuid(), resume: z.boolean().default(false) }).parse(d))
  .handler(async ({ data, context }) => {
    const ctx = context as Ctx;
    await assertStaff(ctx);
    if (data.resume) await armWorker();
    const { data: k } = await ctx.supabase.from("bugou_import_jobs").select("kind").eq("id", data.jobId).single();
    let r: { busy: boolean };
    if (k?.kind === "movie") {
      if (data.resume) await ctx.supabase.from("bugou_import_jobs").update({ status: "running" }).eq("id", data.jobId).eq("status", "paused");
      const { runMovieJob } = await import("./background-import.server");
      r = await runMovieJob(ctx, data.jobId, 20_000);
    } else r = await runSeriesJob(ctx, data.jobId, 20_000, data.resume);
    return { ...(await jobView(ctx, data.jobId)), busy: r.busy };
  });

/** Pause (keeps progress, resumable) or cancel (stops for good; imported data is kept). */
export const bugouStopJob = createServerFn({ method: "POST" })
  .middleware([...auth])
  .inputValidator((d) => z.object({ jobId: z.string().uuid(), cancel: z.boolean().default(false) }).parse(d))
  .handler(async ({ data, context }) => {
    const ctx = context as Ctx;
    await assertStaff(ctx);
    await ctx.supabase.from("bugou_import_jobs").update({ status: data.cancel ? "cancelled" : "paused" }).eq("id", data.jobId);
    return jobView(ctx, data.jobId);
  });

/** Re-queues only failed items; keeps cached details/progress and respects any active provider wait. */
export const bugouRetryFailed = createServerFn({ method: "POST" })
  .middleware([...auth])
  .inputValidator((d) => z.object({ jobId: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const ctx = context as Ctx; const db = ctx.supabase;
    await assertStaff(ctx);
    const until = await globalThrottle(ctx);
    const r = await db.from("bugou_import_items").update({ state: "pending", attempts: 0, rate_limited: 0, next_attempt_at: until > Date.now() ? new Date(until).toISOString() : null }).eq("job_id", data.jobId).eq("state", "failed");
    if (r.error) throw new Error(r.error.message);
    const c = await recount(ctx, data.jobId);
    await db.from("bugou_import_jobs").update({ failed: c.failed, status: "running" }).eq("id", data.jobId);
    await armWorker();
    return jobView(ctx, data.jobId);
  });

export const bugouCancelJob = createServerFn({ method: "POST" })
  .middleware([...auth])
  .inputValidator((d) => z.object({ jobId: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const ctx = context as Ctx;
    await assertStaff(ctx);
    await ctx.supabase.from("bugou_import_jobs").update({ status: "paused" }).eq("id", data.jobId);
    return jobView(ctx, data.jobId);
  });

/** Latest jobs (for resuming interrupted ones) + count of index series not yet imported. */
export const bugouJobsOverview = createServerFn({ method: "POST" })
  .middleware([...auth])
  .handler(async ({ context }) => {
    const ctx = context as Ctx; const db = ctx.supabase;
    await assertStaff(ctx);
    const { data: jobs } = await db.from("bugou_import_jobs").select("id").in("kind", ["series", "movie"]).order("created_at", { ascending: false }).limit(6);
    const views = await Promise.all((jobs ?? []).map((j: any) => jobView(ctx, j.id)));
    const sync = await db.from("bugou_sync").select("total, synced_at").eq("kind", "series").maybeSingle();
    const imported = (await db.from("series").select("id", { count: "exact", head: true }).eq("external_source", SOURCE)).count ?? 0;
    return { jobs: views, indexTotal: sync.data?.total ?? 0, synced_at: sync.data?.synced_at ?? null, imported };
  });

/** Connection test for the series integration: real list request + one real series_info sample. */
export const bugouSeriesTest = createServerFn({ method: "POST" })
  .middleware([...auth])
  .handler(async ({ context }) => {
    const ctx = context as Ctx; await assertStaff(ctx);
    const t0 = Date.now();
    const all = await loadAll("Teste de conexão (séries)");
    const ms = Date.now() - t0;
    const cats = [...new Set(all.map(s => s.category))];
    let sample: { title: string; seasons: number; episodes: number; hasPlot: boolean } | null = null;
    if (all[0]) { const d = await loadDetails(all[0].id, "Teste de conexão (episódios)"); sample = { title: d.title || all[0].title, seasons: d.seasons.length, episodes: d.seasons.reduce((n, s) => n + s.episodes.length, 0), hasPlot: !!d.plot }; }
    return { ms, series: all.length, categories: cats.length, sampleCategories: cats.slice(0, 10), sample };
  });

/** Manual sync of the series index (never deletes rows). */
export const bugouSeriesSync = createServerFn({ method: "POST" })
  .middleware([...auth])
  .handler(async ({ context }) => {
    const ctx = context as Ctx; await assertStaff(ctx);
    const r = await refreshIndex(ctx, "Sincronização (séries)");
    const { integ } = await seriesIntegration();
    if (integ) await (await admin()).from("api_integrations").update({ last_synced_at: r.synced_at }).eq("id", integ.id);
    return r;
  });

async function pageAll(q: (from: number) => any): Promise<any[]> {
  const out: any[] = [];
  for (let from = 0; ; from += 1000) { const { data, error } = await q(from).range(from, from + 999); if (error) throw new Error(error.message); out.push(...(data ?? [])); if (!data || data.length < 1000) break; }
  return out;
}
/** Local series matching the importer: provider id first, then normalized title (+year when both have one). Returns ext_id → local series id. */
async function matchLocal(db: any, rows: { ext_id: string; title: string; year: number | null }[]): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  const byExt = await pageAll(() => db.from("series").select("id, external_id").eq("external_source", SOURCE).order("id"));
  const ext = new Map(byExt.map((x: any) => [x.external_id, x.id]));
  const all = await pageAll(() => db.from("series").select("id, title, release_year").order("id"));
  const byTitle = new Map<string, { id: string; y: number | null }[]>();
  for (const x of all) { const k = normTitle(x.title); byTitle.set(k, [...(byTitle.get(k) ?? []), { id: x.id, y: x.release_year }]); }
  for (const r of rows) {
    const e = ext.get(r.ext_id); if (e) { out.set(r.ext_id, e as string); continue; }
    const m = (byTitle.get(normTitle(r.title)) ?? []).find(s => !r.year || !s.y || s.y === r.year);
    if (m) out.set(r.ext_id, m.id);
  }
  return out;
}

/** Every provider category (full paginated index) with available / imported / pending counts. */
export const bugouCategoryList = createServerFn({ method: "POST" })
  .middleware([...auth])
  .handler(async ({ context }) => {
    const ctx = context as Ctx; const db = ctx.supabase; await assertStaff(ctx);
    const [mem, cat, sync] = await Promise.all([
      pageAll(() => db.from("bugou_catalog_categories").select("ext_id, category").eq("kind", "series").order("category").order("ext_id")),
      pageAll(() => db.from("bugou_catalog").select("ext_id, title, year").eq("kind", "series").order("ext_id")),
      db.from("bugou_sync").select("synced_at, total").eq("kind", "series").maybeSingle(),
    ]);
    const local = await matchLocal(db, cat);
    const m = new Map<string, { total: number; imported: number }>();
    for (const r of mem) { const c = m.get(r.category) ?? { total: 0, imported: 0 }; c.total++; if (local.has(r.ext_id)) c.imported++; m.set(r.category, c); }
    const categories = [...m.entries()].map(([name, c]) => ({ name, ...c, missing: c.total - c.imported })).sort((a, b) => a.name.localeCompare(b.name, "pt-BR"));
    return { categories, distinct: cat.length, imported: local.size, synced_at: sync.data?.synced_at ?? null };
  });

/** Counts for one provider category before a bulk import: series available vs in the catalog, plus imported seasons/episodes/players. */
export const bugouCategoryStats = createServerFn({ method: "POST" })
  .middleware([...auth])
  .inputValidator((d) => z.object({ category: z.string().min(1).max(200) }).parse(d))
  .handler(async ({ data, context }) => {
    const ctx = context as Ctx; const db = ctx.supabase;
    await assertStaff(ctx);
    const rows = (await pageAll(() => db.from("bugou_catalog").select("ext_id, title, year, bugou_catalog_categories!inner(category)").eq("kind", "series").eq("bugou_catalog_categories.category", data.category).order("ext_id"))).map((x: any) => ({ ext_id: x.ext_id, title: x.title, year: x.year }));
    const local = await matchLocal(db, rows);
    const ids = [...new Set(local.values())];
    let seasons = 0, episodes = 0, empty = 0, withPlayer = 0;
    for (let i = 0; i < ids.length; i += 100) {
      const chunk = ids.slice(i, i + 100);
      const ss = await pageAll(() => db.from("seasons").select("id, series_id").in("series_id", chunk).order("id"));
      seasons += ss.length;
      const withSeason = new Set(ss.map((x: any) => x.series_id)); empty += chunk.filter(x => !withSeason.has(x)).length;
      const sids = ss.map((x: any) => x.id);
      for (let j = 0; j < sids.length; j += 150) {
        const eps = await pageAll(() => db.from("episodes").select("id").in("season_id", sids.slice(j, j + 150)).order("id"));
        episodes += eps.length;
        const eids = eps.map((e: any) => e.id);
        for (let k = 0; k < eids.length; k += 150) {
          const { data: src } = await db.from("playback_sources").select("content_id").eq("content_kind", "episode").eq("is_active", true).in("content_id", eids.slice(k, k + 150));
          withPlayer += new Set((src ?? []).map((x: any) => x.content_id)).size;
        }
      }
    }
    return { total: rows.length, imported: local.size, missing: Math.max(0, rows.length - local.size), seasons, episodes, withPlayer, noPlayer: episodes - withPlayer, emptySeries: empty };
  });

// ---------- BugouMods movie catalog (metadata only; no player URLs are imported) ----------
type BugouMovie = { id: string; title: string; year: number | null; poster_url: string | null; category: string; categories?: string[] };

async function loadAllMovies(): Promise<BugouMovie[]> {
  const { integ, tok } = await seriesIntegration();
  const url = new URL("https://cinema.bugoumods.com/");
  url.search = new URLSearchParams({ api: "1", t: "vod", c: "all", vtoken: tok }).toString();
  const t0 = Date.now();
  try {
    const json = await getJson(url, "lista de filmes", integ?.timeout_seconds ?? 25);
    if (!json || typeof json !== "object" || Array.isArray(json)) throw new Error("Formato inesperado: a API de filmes não devolveu categorias.");
    if (json.Aviso) throw new Error("BugouMods informou um aviso; verifique se o token está válido.");
    const byId = new Map<string, BugouMovie>();
    for (const [categoryName, list] of Object.entries(json)) {
      if (!Array.isArray(list)) continue;
      for (const raw of list as any[]) {
        const id = String(raw?.id ?? "").trim();
        if (!/^\d+$/.test(id)) continue;
        const parsed = parseBugouName(String(raw?.nome ?? raw?.name ?? raw?.title ?? ""));
        if (!parsed.title) continue;
        const category = String(raw?.categoria ?? categoryName).trim().slice(0, 120);
        const existing = byId.get(id);
        if (existing) {
          if (category && !existing.categories?.some(x => normTitle(x) === normTitle(category))) existing.categories = [...(existing.categories ?? []), category];
          continue;
        }
        const image = String(raw?.capa ?? raw?.cover ?? raw?.poster ?? "").trim();
        const poster_url = /^https?:\/\//i.test(image) ? image.replace(/^http:\/\//i, "https://") : null;
        byId.set(id, { id, title: parsed.title.slice(0, 200), year: parsed.year, poster_url, category, categories: category ? [category] : [] });
      }
    }
    const items = [...byId.values()];
    if (!items.length) throw new Error("A resposta não contém filmes reconhecíveis. Nenhum dado foi alterado.");
    await logCall(integ, "Catálogo de filmes", t0, null);
    return items;
  } catch (e) {
    const message = scrub((e as Error).message).slice(0, 400);
    await logCall(integ, "Catálogo de filmes", t0, message, e instanceof RateLimitedError ? 429 : null);
    throw new Error(message);
  }
}

/** Links provider genre labels to the system's existing (fixed) genres only; never creates genres, never removes links. */
async function linkProviderGenres(db: any, kind: "movie" | "series", contentId: string, names: string[]): Promise<number> {
  const slugs = mapBugouGenreSlugs(names);
  if (!slugs.length) return 0;
  const { data: genres, error } = await db.from("genres").select("id").in("slug", slugs);
  if (error) throw new Error(error.message);
  const ids = (genres ?? []).map((g: any) => String(g.id));
  if (!ids.length) return 0;
  const table = kind === "movie" ? "movie_genres" : "series_genres";
  const col = kind === "movie" ? "movie_id" : "series_id";
  const { data: linked, error: le } = await db.from(table).select("genre_id").eq(col, contentId).in("genre_id", ids);
  if (le) throw new Error(le.message);
  const have = new Set((linked ?? []).map((x: any) => String(x.genre_id)));
  const add = ids.filter((id: string) => !have.has(id));
  if (!add.length) return 0;
  const up = await db.from(table).upsert(add.map((genre_id: string) => ({ [col]: contentId, genre_id })), { onConflict: `${col},genre_id`, ignoreDuplicates: true });
  if (up.error) throw new Error(up.error.message);
  return add.length;
}

/** tmdb_id is unique per table: only set it when no other row already owns it. */
async function freeTmdbId(db: any, table: "movies" | "series", tmdbId: number | null | undefined, selfId: string | null): Promise<number | null> {
  if (!tmdbId) return null;
  const { data } = await db.from(table).select("id").eq("tmdb_id", tmdbId).limit(1);
  const owner = data?.[0]?.id ?? null;
  return !owner || owner === selfId ? tmdbId : null;
}

/** Fetches one movie's full metadata from BugouMods VIP. A missing detail endpoint must not block importing the catalog row. */
/** movie_info responses (including empty ones) are cached 7 days so a re-run never asks the provider twice. */
const MOVIE_INFO_TTL_MS = 7 * 24 * 3600_000;
async function loadMovieDetails(id: string, tok: string, integ: SeriesInteg, counter?: { calls: number }): Promise<BugouMovieDetails | null> {
  const key = `bugou:movie_info:${id}`; const a = await admin();
  if (integ?.id) {
    const { data: hit } = await a.from("api_response_cache").select("body").eq("cache_key", key).gt("expires_at", new Date().toISOString()).maybeSingle();
    if (hit) { const j = JSON.parse(hit.body); return j && (j.info || j.movie_data) ? parseBugouMovieDetails(id, j) : null; }
  }
  if (counter) counter.calls++;
  const url = new URL("https://cinema.bugoumods.com/index.php");
  url.search = new URLSearchParams({ ajax: "1", type: "movie_info", vod_id: id, vtoken: tok }).toString();
  const t0 = Date.now();
  try {
    const json = await getJson(url, "detalhes do filme", integ?.timeout_seconds ?? 25);
    if (!json || typeof json !== "object" || json.Aviso) throw new Error("A API não devolveu detalhes válidos para este filme.");
    const details = parseBugouMovieDetails(id, json);
    await logCall(integ, `Detalhes do filme ${id}`, t0, null);
    if (integ?.id) await a.from("api_response_cache").upsert({ cache_key: key, integration_id: integ.id, http_status: 200, body: JSON.stringify(json), expires_at: new Date(Date.now() + MOVIE_INFO_TTL_MS).toISOString() });
    return json.info || json.movie_data ? details : null;
  } catch (e) {
    const message = scrub((e as Error).message).slice(0, 400);
    await logCall(integ, `Detalhes do filme ${id}`, t0, message, e instanceof RateLimitedError ? 429 : null);
    // A 429 must stop this batch so the caller can back off and retry the same id;
    // silently treating it as missing metadata would keep calling the provider too quickly.
    if (e instanceof RateLimitedError) throw e;
    return null;
  }
}

async function refreshMovieIndex(ctx: Ctx, force: boolean) {
  const { data } = await ctx.supabase.from("bugou_sync").select("synced_at,total").eq("kind", "movie").maybeSingle();
  if (!force && data) return data as { synced_at: string; total: number };
  const all = await loadAllMovies();
  const now = new Date().toISOString();
  for (let i = 0; i < all.length; i += 500) {
    const chunk = all.slice(i, i + 500);
    const rows = chunk.map(m => ({ kind: "movie", ext_id: m.id, title: m.title, title_norm: normTitle(m.title), title_compact: compactTitle(m.title), year: m.year, poster_url: m.poster_url, category: m.category, seen_at: now }));
    const up = await ctx.supabase.from("bugou_catalog").upsert(rows, { onConflict: "kind,ext_id" });
    if (up.error) throw new Error(up.error.message);
    const cats = await ctx.supabase.from("bugou_catalog_categories").upsert(chunk.flatMap(m => (m.categories?.length ? m.categories : [m.category]).filter(Boolean).map(category => ({ kind: "movie", ext_id: m.id, category, seen_at: now }))), { onConflict: "kind,ext_id,category" });
    if (cats.error) throw new Error(cats.error.message);
  }
  const sync = await ctx.supabase.from("bugou_sync").upsert({ kind: "movie", synced_at: now, total: all.length });
  if (sync.error) throw new Error(sync.error.message);
  return { synced_at: now, total: all.length };
}

export const bugouMoviesTest = createServerFn({ method: "POST" }).middleware([...auth])
  .handler(async ({ context }) => {
    const ctx = context as Ctx; await assertStaff(ctx);
    const all = await loadAllMovies();
    const { integ, tok } = await seriesIntegration();
    const sample = all[0] ?? null;
    const detail = sample ? await loadMovieDetails(sample.id, tok, integ) : null;
    return {
      total: all.length,
      categories: [...new Set(all.map(m => m.category).filter(Boolean))].sort(),
      sample: sample ? { title: sample.title, year: sample.year, hasPoster: !!sample.poster_url } : null,
      metadataProbe: sample ? {
        providerId: sample.id,
        title: sample.title,
        descriptionAvailable: !!detail?.plot?.trim(),
        genreNames: detail?.genres ?? [],
        providerFieldPaths: detail?.providerMetadataPaths ?? [],
      } : null,
    };
  });

export const bugouSearchMovies = createServerFn({ method: "POST" }).middleware([...auth])
  .inputValidator((d) => z.object({ query: z.string().trim().max(200).default(""), category: z.string().max(120).default(""), page: z.number().int().min(0).max(10000).default(0), refresh: z.boolean().default(false), withCategories: z.boolean().default(false) }).parse(d))
  .handler(async ({ data, context }) => {
    const ctx = context as Ctx; const db = ctx.supabase; await assertStaff(ctx);
    const sync = await refreshMovieIndex(ctx, data.refresh);
    const q = normTitle(data.query);
    const queryRows = async (compact: boolean) => {
      let qb = db.from("bugou_catalog").select(data.category ? "ext_id,title,year,poster_url,category,title_norm,bugou_catalog_categories!inner(category)" : "ext_id,title,year,poster_url,category,title_norm", { count: "exact" }).eq("kind", "movie");
      if (q) {
        if (compact) qb = qb.ilike("title_compact", "%" + q.replace(/ /g, "") + "%");
        else for (const part of q.split(" ")) qb = qb.ilike("title_norm", "%" + part + "%");
      }
      if (data.category) qb = qb.eq("bugou_catalog_categories.category", data.category);
      return qb.order("title_norm").order("ext_id").range(data.page * PAGE, data.page * PAGE + PAGE - 1);
    };
    let result = await queryRows(false);
    if (!result.error && q && !result.count) result = await queryRows(true);
    if (result.error) throw new Error(result.error.message);
    const rows = (result.data ?? []) as any[];
    if (q) rows.sort((a,b) => (a.title_norm === q ? 0 : a.title_norm.startsWith(q) ? 1 : 2) - (b.title_norm === q ? 0 : b.title_norm.startsWith(q) ? 1 : 2));
    const results: BugouMovie[] = rows.map(x => ({ id: x.ext_id, title: x.title, year: x.year, poster_url: x.poster_url, category: x.category ?? "" }));
    const existing: Record<string,string> = {};
    if (results.length) {
      const { data: byExt, error } = await db.from("movies").select("id,external_id").eq("external_source", SOURCE).in("external_id", results.map(m => m.id));
      if (error) throw new Error(error.message);
      (byExt ?? []).forEach((x: any) => { existing[x.external_id] = x.id; });
    }
    let categories: string[] = [];
    const categoryStats: Record<string, { total: number; imported: number }> = {};
    if (data.withCategories) {
      const catRows = await pageAll(() => db.from("bugou_catalog_categories").select("ext_id,category").eq("kind", "movie").order("category").order("ext_id"));
      const importedRows = await pageAll(() => db.from("movies").select("external_id").eq("external_source", SOURCE).order("external_id"));
      const importedIds = new Set((importedRows as any[]).map(x => String(x.external_id)));
      for (const row of catRows as any[]) {
        const name = String(row.category ?? "").trim();
        if (!name) continue;
        categories.push(name);
        const stat = categoryStats[name] ?? { total: 0, imported: 0 };
        stat.total++;
        if (importedIds.has(String(row.ext_id))) stat.imported++;
        categoryStats[name] = stat;
      }
      categories = [...new Set(categories)].sort((a, b) => a.localeCompare(b, "pt-BR"));
    }
    return { total: sync.total, synced_at: sync.synced_at, matches: result.count ?? 0, page: data.page, pageSize: PAGE, categories, categoryStats, results, existing };
  });

/**
 * Repairs already-imported BugouMods movies: re-reads movie_info for each one (keyset pages by id)
 * and runs the same fill-only import routine, so valid/manual data is never overwritten and nothing is duplicated.
 * Resumable via the returned cursor; per-item failures are counted and don't stop the batch.
 */
export const bugouRepairMovieMetadataBatch = createServerFn({ method: "POST" }).middleware([...auth])
  .inputValidator((d) => z.object({ after: z.string().uuid().nullable().optional(), limit: z.number().int().min(1).max(10).default(5) }).parse(d))
  .handler(async ({ data, context }) => {
    const ctx = context as Ctx; await assertStaff(ctx);
    let q = ctx.supabase.from("movies").select("id,external_id").eq("external_source", SOURCE).order("id").limit(data.limit);
    if (data.after) q = q.gt("id", data.after);
    const { data: rows, error } = await q;
    if (error) throw new Error(error.message);
    const list = (rows ?? []) as { id: string; external_id: string }[];
    const empty = { scanned: 0, corrected: 0, descriptionsAdded: 0, genresAdded: 0, unavailable: 0, failed: 0 };
    if (!list.length) return { ...empty, nextCursor: data.after ?? null, done: true };
    const r = await importMovieIds(ctx, list.map(x => x.external_id).filter(x => /^\d+$/.test(x)));
    return { scanned: list.length, corrected: r.fieldsFilled, descriptionsAdded: r.descriptionsAdded, genresAdded: r.genresAdded, unavailable: r.metadataUnavailable + r.detailFailures, failed: r.failed, nextCursor: list[list.length - 1]!.id, done: list.length < data.limit };
  });

export const bugouImportMovies = createServerFn({ method: "POST" }).middleware([...auth])
  .inputValidator((d) => z.object({ ids: z.array(z.string().regex(/^\d+$/)).min(1).max(10) }).parse(d))
  .handler(async ({ data, context }) => {
    const ctx = context as Ctx; await assertStaff(ctx);
    return importMovieIds(ctx, data.ids);
  });

export async function importMovieIds(ctx: Ctx, ids: string[]) {
    const db = ctx.supabase; const data = { ids };
    await refreshMovieIndex(ctx, false);
    const { data: items, error } = await db.from("bugou_catalog").select("ext_id,title,year,poster_url,category").eq("kind", "movie").in("ext_id", data.ids);
    if (error) throw new Error(error.message);
    const byId = new Map((items ?? []).map((x: any) => [x.ext_id, x]));
    const { integ, tok } = await seriesIntegration();
    const report = { providerCalls: 0, alreadyComplete: 0, created: 0, updated: 0, skipped: 0, descriptionsAdded: 0, genresAdded: 0, metadataUnavailable: 0, playersAdded: 0, detailFailures: 0, failed: 0, fieldsFilled: 0 };

    for (const id of data.ids) {
      const m = byId.get(id) as any;
      if (!m) { report.skipped++; continue; }
      try {
        // Already imported with its VIP player and no fillable gap: no provider call at all.
        const { data: known } = await db.from("movies").select("id").eq("external_source", SOURCE).eq("external_id", id).maybeSingle();
        if (known) {
          const { count: hasRef } = await db.from("playback_sources").select("id", { count: "exact", head: true }).eq("content_kind", "movie").eq("content_id", known.id).eq("external_ref", `bugoumods:${id}`);
          if (hasRef) {
            const en = await enrichContent(ctx, "movie", known.id); (report as any).tmdb = en.status;
            if (en.status === "complete" || en.status === "incomplete" || en.status === "unmatched" || en.status === "filled") { report.alreadyComplete++; report.updated++; continue; }
          }
        }
        const counter = { calls: 0 };
        const detail = await loadMovieDetails(id, tok, integ, counter); report.providerCalls += counter.calls;
        if (!detail) report.detailFailures++;
        const title = detail?.title || m.title;
        const year = detail?.year ?? m.year;
        const poster = detail?.cover || m.poster_url;
        const playerUrl = bugouVipEmbedUrl(id, detail?.ext ?? "mp4", tok);

        const { data: byExternal, error: findErr } = await db.from("movies").select("id,title,original_title,description,poster_url,backdrop_url,release_year,release_date,duration_minutes,age_rating,quality,language,country,tmdb_id,vote_average,trailer_url,external_source,external_id").eq("external_source", SOURCE).eq("external_id", id).maybeSingle();
        if (findErr) throw new Error(findErr.message);
        let existing: any = byExternal;
        if (!existing) {
          const selectFields = "id,title,original_title,description,poster_url,backdrop_url,release_year,release_date,duration_minutes,age_rating,quality,language,country,tmdb_id,vote_average,trailer_url,external_source,external_id";
          const same = existing ? null : year
            ? db.from("movies").select(selectFields).or(`release_year.eq.${year},release_year.is.null`).limit(1000)
            : db.from("movies").select(selectFields).ilike("title", title.replace(/[%_\\]/g, "\\$&")).limit(20);
          const { data: matches, error: sameErr } = same ? await same : { data: [], error: null };
          if (sameErr) throw new Error(sameErr.message);
          const normalized = existing ? [] : (matches ?? []).filter((movie: any) =>
            normTitle(String(movie.title ?? "")) === normTitle(title) &&
            (!year || !movie.release_year || Number(movie.release_year) === Number(year))
          );
          if (normalized.length === 1) existing = normalized[0];
          else if (!existing && normalized.length > 1) throw new Error("Correspondência de título ambígua; filme não importado para evitar duplicidade.");
        }

        let movieId: string;
        if (existing) {
          movieId = existing.id;
          const patch: Record<string, unknown> = {};
          if (!String(existing.title ?? "").trim() && title) patch["title"] = title;
          if (!String(existing.original_title ?? "").trim() && detail?.originalTitle) patch["original_title"] = detail.originalTitle;
          if (!String(existing.description ?? "").trim() && detail?.plot) { patch["description"] = detail.plot; report.descriptionsAdded++; }
          if (!existing.poster_url && poster) patch["poster_url"] = poster;
          if (!existing.backdrop_url && detail?.backdrop) patch["backdrop_url"] = detail.backdrop;
          if (!existing.release_year && year) patch["release_year"] = year;
          if (!existing.duration_minutes && detail?.durationMinutes) patch["duration_minutes"] = detail.durationMinutes;
          if (!String(existing.age_rating ?? "").trim() && detail?.ageRating) patch["age_rating"] = detail.ageRating;
          if (!String(existing.quality ?? "").trim() && detail?.quality) patch["quality"] = detail.quality;
          if (!String(existing.language ?? "").trim() && detail?.language) patch["language"] = detail.language;
          if (!String(existing.country ?? "").trim() && detail?.country) patch["country"] = detail.country;
          if (!existing.release_date && detail?.releaseDate) patch["release_date"] = detail.releaseDate;
          if (!existing.vote_average && detail?.rating) patch["vote_average"] = detail.rating;
          if (!existing.trailer_url && detail?.trailer) patch["trailer_url"] = detail.trailer;
          if (!existing.tmdb_id) { const t = await freeTmdbId(db, "movies", detail?.tmdbId, movieId); if (t) patch["tmdb_id"] = t; }
          if (!existing.external_id) { patch["external_source"] = SOURCE; patch["external_id"] = id; }
          if (Object.keys(patch).length) {
            const up = await db.from("movies").update(patch).eq("id", movieId);
            if (up.error) throw new Error(up.error.message);
            report.fieldsFilled++;
          }
          report.updated++;
        } else {
          const base = normTitle(title).replace(/ /g, "-").replace(/^-|-$/g, "").slice(0, 160) || "filme";
          const slug = (base + "-" + id).slice(0, 200);
          const ins = await db.from("movies").insert({ title, original_title: detail?.originalTitle ?? null, description: detail?.plot ?? null, release_year: year, poster_url: poster, backdrop_url: detail?.backdrop ?? null, duration_minutes: detail?.durationMinutes ?? null, age_rating: detail?.ageRating ?? null, quality: detail?.quality ?? null, language: detail?.language ?? null, country: detail?.country ?? null, release_date: detail?.releaseDate ?? null, vote_average: detail?.rating ?? null, trailer_url: detail?.trailer ?? null, tmdb_id: await freeTmdbId(db, "movies", detail?.tmdbId, null), slug, status: "published", external_source: SOURCE, external_id: id }).select("id").single();
          if (ins.error) throw new Error(ins.error.message);
          movieId = ins.data.id;
          if (detail?.plot) report.descriptionsAdded++;
          report.created++;
        }

        if (detail?.genres.length) report.genresAdded += await linkProviderGenres(db, "movie", movieId, detail.genres);
        if (!detail?.plot?.trim() || !detail.genres.length) report.metadataUnavailable++;
        const { data: categoryRows, error: categoryError } = await db.from("bugou_catalog_categories").select("category").eq("kind", "movie").eq("ext_id", id);
        if (categoryError) throw new Error(categoryError.message);
        await linkCategories(db, "movie", movieId, [m.category, ...((categoryRows ?? []) as any[]).map(x => x.category)]);
        // Provider gives no synopsis/genres for many titles: complete missing fields from TMDB (fill-only, reliable match only).
        const en = await enrichContent(ctx, "movie", movieId); (report as any).tmdb = en.status;

        // Never replace an existing working player. Add the Bugou VIP source only once per provider ID.
        const { data: sources, error: sourcesErr } = await db.from("playback_sources").select("id,external_ref").eq("content_kind", "movie").eq("content_id", movieId);
        if (sourcesErr) throw new Error(sourcesErr.message);
        const ref = `bugoumods:${id}`;
        if (!(sources ?? []).some((s: any) => s.external_ref === ref)) {
          const sourceInsert = await db.from("playback_sources").insert({
            content_kind: "movie", content_id: movieId, url: playerUrl, source_type: "embed",
            provider: "BugouMods", label: "BugouMods VIP", external_ref: ref,
            is_active: true, is_primary: (sources ?? []).length === 0, sort_order: (sources ?? []).length, drm: {},
          });
          if (sourceInsert.error) throw new Error(sourceInsert.error.message);
          report.playersAdded++;
        }
      } catch (error) {
        if (error instanceof RateLimitedError) throw error;
        report.failed++;
        console.warn("[BugouMods movie import] Falha ao importar filme", id, scrub(error instanceof Error ? error.message : String(error)).slice(0, 250));
      }
    }
    return report;
}

