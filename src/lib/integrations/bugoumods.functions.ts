/* eslint-disable @typescript-eslint/no-explicit-any */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { assertStaff, uniqueSlug } from "@/lib/tmdb/tmdb.functions";
import { parseBugouName, parseBugouDetails, bugouVipEmbedUrl, normTitle, compactTitle, type BugouSeries, type BugouDetails } from "./bugoumods";

/**
 * BugouMods VIP series. The full list (one request, ~3k rows, no pagination offered by the provider)
 * is mirrored into the staff-only `bugou_catalog` index; searches read the index, never the provider.
 * Imports run as resumable jobs (`bugou_import_jobs/items`) driven in short server calls.
 * The vtoken stays server-side; the provider list "link" is never stored.
 */
type Ctx = { supabase: any; userId: string };
const SOURCE = "bugoumods";
const INDEX_TTL_MS = 6 * 3600_000;
const PAGE = 40;

const admin = async () => (await import("@/integrations/supabase/client.server")).supabaseAdmin as any;
type SeriesInteg = { id: string; is_active: boolean; request_count: number; timeout_seconds: number } | null;

/** Token comes from the "BugouMods VIP — Séries" integration (service-role api_credentials); env secret is the legacy fallback. */
async function seriesIntegration(): Promise<{ integ: SeriesInteg; tok: string }> {
  const db = await admin();
  const { data: integ } = await db.from("api_integrations").select("id, is_active, request_count, timeout_seconds").eq("kind", "series").eq("provider", "bugoumods_series").order("priority").limit(1).maybeSingle();
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
async function logCall(integ: SeriesInteg, label: string, t0: number, err: string | null) {
  if (!integ) return;
  const db = await admin(); const now = new Date().toISOString();
  await db.from("api_request_logs").insert({ integration_id: integ.id, content_label: label, http_status: err ? null : 200, duration_ms: Date.now() - t0, success: !err, cached: false, error: err });
  await db.from("api_integrations").update({ last_tested_at: now, last_status: err ? "error" : "ok", last_error: err, request_count: Number(integ.request_count) + 1 }).eq("id", integ.id);
}

const scrub = (s: string) => s.replace(/vtoken=[^&\s"]+/g, "vtoken=***");
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

/** GET JSON with up to 3 attempts and progressive wait for network errors / 5xx / 429. */
async function getJson(url: URL, what: string): Promise<any> {
  let last = "";
  for (let i = 0; i < 3; i++) {
    if (i) await sleep(600 * 2 ** (i - 1));
    let res: Response;
    try { res = await fetch(url, { headers: { "User-Agent": "Mozilla/5.0", Accept: "application/json" } }); }
    catch { last = `Não foi possível conectar ao BugouMods (${what}).`; continue; }
    if (res.status >= 500 || res.status === 429) { last = `BugouMods respondeu HTTP ${res.status} (${what}).`; continue; }
    if (!res.ok) throw new Error(`BugouMods respondeu HTTP ${res.status} (${what}).`);
    try { return await res.json(); } catch { throw new Error(`BugouMods não respondeu em JSON (${what}).`); }
  }
  throw new Error(last);
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
  const r = await ctx.supabase.from("bugou_sync").upsert({ kind: "series", synced_at: now, total: all.length });
  if (r.error) throw new Error(r.error.message);
  return { total: all.length, synced_at: now };
}

async function ensureIndex(ctx: Ctx, force: boolean) {
  const { data } = await ctx.supabase.from("bugou_sync").select("synced_at, total").eq("kind", "series").maybeSingle();
  if (!force && data && Date.now() - Date.parse(data.synced_at) < INDEX_TTL_MS) return data as { synced_at: string; total: number };
  return refreshIndex(ctx);
}

async function loadDetails(id: string): Promise<BugouDetails> {
  const url = new URL("https://cinema.bugoumods.com/index.php");
  url.search = new URLSearchParams({ ajax: "1", type: "series_info", series_id: id, vtoken: await token() }).toString();
  return parseBugouDetails(id, await getJson(url, "episódios"));
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

type ImportResult = { seriesId: string; seriesCreated: boolean; seasonsCreated: number; episodesCreated: number; episodesExisting: number; sourcesCreated: number; sourcesExisting: number };

/**
 * Full idempotent import of one series: metadata, every season, every episode and its VIP player.
 * Existing rows are reused; only empty metadata fields are filled; nothing is deleted.
 */
async function importSeriesFull(ctx: Ctx, id: string, onlySeasons?: number[]): Promise<ImportResult> {
  const db = ctx.supabase;
  const d = await loadDetails(id);
  const want = onlySeasons ? d.seasons.filter(s => onlySeasons.includes(s.season)) : d.seasons;
  let seriesId = await findLocalSeries(ctx, id, d.title, d.year); let seriesCreated = false;
  let listed: any = null;
  if (!d.title || !d.cover || !d.year) { const { data } = await db.from("bugou_catalog").select("title, year, poster_url").eq("kind", "series").eq("ext_id", id).maybeSingle(); listed = data; }
  const title = d.title || listed?.title; const year = d.year ?? listed?.year ?? null; const cover = d.cover ?? listed?.poster_url ?? null;
  if (!seriesId) {
    if (!title) throw new Error("Série sem nome na resposta da API.");
    const slug = await uniqueSlug(ctx, "series", title, year);
    const r = await db.from("series").insert({ title, release_year: year, poster_url: cover, description: d.plot, slug, status: "published", external_source: SOURCE, external_id: id }).select("id").single();
    if (r.error) throw new Error(r.error.message);
    seriesId = r.data.id as string; seriesCreated = true;
  } else {
    const { data: cur } = await db.from("series").select("description, poster_url, release_year, external_source, external_id").eq("id", seriesId).single();
    const patch: any = {};
    if (cur && !cur.description && d.plot) patch.description = d.plot;
    if (cur && !cur.poster_url && cover) patch.poster_url = cover;
    if (cur && !cur.release_year && year) patch.release_year = year;
    if (cur && !cur.external_id) { patch.external_source = SOURCE; patch.external_id = id; }
    if (Object.keys(patch).length) { const u = await db.from("series").update(patch).eq("id", seriesId); if (u.error) throw new Error(u.error.message); }
  }
  const out: ImportResult = { seriesId: seriesId!, seriesCreated, seasonsCreated: 0, episodesCreated: 0, episodesExisting: 0, sourcesCreated: 0, sourcesExisting: 0 };
  const vtok = await token();
  for (const s of want) {
    let { data: season } = await db.from("seasons").select("id").eq("series_id", seriesId).eq("season_number", s.season).maybeSingle();
    if (!season) {
      const r = await db.from("seasons").insert({ series_id: seriesId, season_number: s.season, title: `Temporada ${s.season}`, status: "published", sort_order: s.season }).select("id").single();
      if (r.error) throw new Error(r.error.message);
      season = r.data; out.seasonsCreated++;
    }
    const { data: have } = await db.from("episodes").select("id, episode_number").eq("season_id", season!.id);
    const byNum = new Map<number, string>((have ?? []).map((e: any) => [e.episode_number, e.id]));
    const missing = s.episodes.filter(e => !byNum.has(e.episode));
    out.episodesExisting += s.episodes.length - missing.length;
    if (missing.length) {
      const r = await db.from("episodes").insert(missing.map(e => ({ season_id: season!.id, episode_number: e.episode, title: e.title, thumbnail_url: e.image, duration_minutes: e.duration_minutes, status: "published" }))).select("id, episode_number");
      if (r.error) throw new Error(r.error.message);
      (r.data ?? []).forEach((e: any) => byNum.set(e.episode_number, e.id));
      out.episodesCreated += r.data?.length ?? 0;
    }
    const epIds = s.episodes.map(e => byNum.get(e.episode)).filter(Boolean) as string[];
    const srcs: any[] = [];
    for (let i = 0; i < epIds.length; i += 150) {
      const { data, error } = await db.from("playback_sources").select("id, content_id, external_ref, url").eq("content_kind", "episode").in("content_id", epIds.slice(i, i + 150));
      if (error) throw new Error(error.message);
      srcs.push(...(data ?? []));
    }
    const inserts: any[] = [];
    for (const e of s.episodes) {
      const epId = byNum.get(e.episode); if (!epId) continue;
      const ref = `bugoumods:${e.id}`; const vipUrl = bugouVipEmbedUrl(e.id, e.ext, vtok);
      const mine = srcs.filter(x => x.content_id === epId);
      const prev = mine.find(x => x.external_ref === ref);
      if (prev) {
        if (prev.url !== vipUrl) { const u = await db.from("playback_sources").update({ url: vipUrl }).eq("id", prev.id); if (u.error) throw new Error(u.error.message); }
        out.sourcesExisting++; continue;
      }
      inserts.push({ content_kind: "episode", content_id: epId, url: vipUrl, source_type: "embed", provider: "BugouMods", label: "BugouMods", external_ref: ref, is_active: true, is_primary: mine.length === 0, sort_order: mine.length, drm: {} });
    }
    if (inserts.length) { const r = await db.from("playback_sources").insert(inserts); if (r.error) throw new Error(r.error.message); out.sourcesCreated += inserts.length; }
  }
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
      let qb = db.from("bugou_catalog").select("ext_id, title, year, poster_url, category, title_norm", { count: "exact" }).eq("kind", "series");
      if (q) {
        if (compact) qb = qb.ilike("title_compact", `%${q.replace(/ /g, "")}%`);
        else for (const t of q.split(" ")) qb = qb.ilike("title_norm", `%${t}%`);
      }
      if (data.category) qb = qb.eq("category", data.category);
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
      for (let from = 0; from < 20000; from += 1000) {
        const { data: c } = await db.from("bugou_catalog").select("category").eq("kind", "series").range(from, from + 999);
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
    const details = await loadDetails(data.id);
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

async function jobView(ctx: Ctx, jobId: string) {
  const db = ctx.supabase;
  const { data: job, error } = await db.from("bugou_import_jobs").select("*").eq("id", jobId).single();
  if (error) throw new Error(error.message);
  const { data: failures } = await db.from("bugou_import_items").select("ext_id, title, error, attempts").eq("job_id", jobId).eq("state", "failed").order("updated_at", { ascending: false }).limit(20);
  return { ...job, pending: Math.max(0, job.total - job.done - job.failed), failures: failures ?? [] };
}

async function recount(ctx: Ctx, jobId: string) {
  const db = ctx.supabase;
  const c = async (state: string) => (await db.from("bugou_import_items").select("ext_id", { count: "exact", head: true }).eq("job_id", jobId).eq("state", state)).count ?? 0;
  const [done, failed, pending] = await Promise.all([c("done"), c("failed"), c("pending")]);
  return { done, failed, pending };
}

export const bugouCreateJob = createServerFn({ method: "POST" })
  .middleware([...auth])
  .inputValidator((d) => z.object({ ids: z.array(z.string().regex(/^\d+$/)).max(500).default([]), allMissing: z.boolean().default(false), category: z.string().max(200).optional() }).parse(d))
  .handler(async ({ data, context }) => {
    const ctx = context as Ctx; const db = ctx.supabase;
    await assertStaff(ctx);
    let items: { ext_id: string; title: string | null }[] = [];
    if (data.allMissing) {
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
        const { data: c, error } = await db.from("bugou_catalog").select("ext_id, title").eq("kind", "series").eq("category", data.category).order("title_norm").range(from, from + 999);
        if (error) throw new Error(error.message);
        items.push(...((c ?? []) as any[]));
        if (!c || c.length < 1000) break;
      }
    } else {
      const { data: c } = await db.from("bugou_catalog").select("ext_id, title").eq("kind", "series").in("ext_id", data.ids);
      const t = new Map((c ?? []).map((x: any) => [x.ext_id, x.title]));
      items = data.ids.map(id => ({ ext_id: id, title: (t.get(id) as string) ?? null }));
    }
    if (!items.length) throw new Error("Nada para importar.");
    const j = await db.from("bugou_import_jobs").insert({ label: data.allMissing ? "Todas as séries não importadas" : data.category && !data.ids.length ? `Categoria ${data.category} (todas)`.slice(0, 200) : `${items.length} série(s) selecionada(s)`, total: items.length, created_by: ctx.userId }).select("id").single();
    if (j.error) throw new Error(j.error.message);
    for (let i = 0; i < items.length; i += 500) {
      const r = await db.from("bugou_import_items").insert(items.slice(i, i + 500).map(x => ({ job_id: j.data.id, ext_id: x.ext_id, title: x.title })));
      if (r.error) throw new Error(r.error.message);
    }
    return jobView(ctx, j.data.id);
  });

/** Processes pending items for ~20s under a lease, then returns progress. Call again until status is done. */
export const bugouRunJob = createServerFn({ method: "POST" })
  .middleware([...auth])
  .inputValidator((d) => z.object({ jobId: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const ctx = context as Ctx; const db = ctx.supabase;
    await assertStaff(ctx);
    const now = new Date();
    const lease = await db.from("bugou_import_jobs").update({ lease_until: new Date(now.getTime() + 45_000).toISOString(), status: "running" })
      .eq("id", data.jobId).neq("status", "cancelled").or(`lease_until.is.null,lease_until.lt.${now.toISOString()}`).select("id, episodes_created");
    if (lease.error) throw new Error(lease.error.message);
    if (!lease.data?.length) return { ...(await jobView(ctx, data.jobId)), busy: true };
    let episodes = lease.data[0].episodes_created as number;
    const started = Date.now();
    while (Date.now() - started < 20_000) {
      const { data: next } = await db.from("bugou_import_items").select("ext_id, attempts").eq("job_id", data.jobId).eq("state", "pending").order("attempts").order("ext_id").limit(1);
      const it = next?.[0]; if (!it) break;
      try {
        const res = await importSeriesFull(ctx, it.ext_id);
        episodes += res.episodesCreated;
        await db.from("bugou_import_items").update({ state: "done", attempts: it.attempts + 1, error: null, result: res, updated_at: new Date().toISOString() }).eq("job_id", data.jobId).eq("ext_id", it.ext_id);
      } catch (e) {
        const attempts = it.attempts + 1;
        await db.from("bugou_import_items").update({ state: attempts >= 3 ? "failed" : "pending", attempts, error: scrub(e instanceof Error ? e.message : String(e)).slice(0, 500), updated_at: new Date().toISOString() }).eq("job_id", data.jobId).eq("ext_id", it.ext_id);
      }
    }
    const c = await recount(ctx, data.jobId);
    await db.from("bugou_import_jobs").update({ done: c.done, failed: c.failed, episodes_created: episodes, status: c.pending ? "running" : "done", lease_until: null, updated_at: new Date().toISOString() }).eq("id", data.jobId);
    return { ...(await jobView(ctx, data.jobId)), busy: false };
  });

export const bugouRetryFailed = createServerFn({ method: "POST" })
  .middleware([...auth])
  .inputValidator((d) => z.object({ jobId: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const ctx = context as Ctx; const db = ctx.supabase;
    await assertStaff(ctx);
    const r = await db.from("bugou_import_items").update({ state: "pending", attempts: 0 }).eq("job_id", data.jobId).eq("state", "failed");
    if (r.error) throw new Error(r.error.message);
    const c = await recount(ctx, data.jobId);
    await db.from("bugou_import_jobs").update({ failed: c.failed, status: "running" }).eq("id", data.jobId);
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
    const { data: jobs } = await db.from("bugou_import_jobs").select("id").neq("kind", "live").order("created_at", { ascending: false }).limit(5);
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
    if (all[0]) { const d = await loadDetails(all[0].id); sample = { title: d.title || all[0].title, seasons: d.seasons.length, episodes: d.seasons.reduce((n, s) => n + s.episodes.length, 0), hasPlot: !!d.plot }; }
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

/** Counts for a provider category before a bulk import: total in the index vs already in the catalog. */
export const bugouCategoryStats = createServerFn({ method: "POST" })
  .middleware([...auth])
  .inputValidator((d) => z.object({ category: z.string().min(1).max(200) }).parse(d))
  .handler(async ({ data, context }) => {
    const ctx = context as Ctx; const db = ctx.supabase;
    await assertStaff(ctx);
    const ids: string[] = [];
    for (let from = 0; ; from += 1000) {
      const { data: c, error } = await db.from("bugou_catalog").select("ext_id").eq("kind", "series").eq("category", data.category).range(from, from + 999);
      if (error) throw new Error(error.message);
      (c ?? []).forEach((x: any) => ids.push(x.ext_id));
      if (!c || c.length < 1000) break;
    }
    let imported = 0;
    for (let i = 0; i < ids.length; i += 300) {
      const { count } = await db.from("series").select("id", { count: "exact", head: true }).eq("external_source", SOURCE).in("external_id", ids.slice(i, i + 300));
      imported += count ?? 0;
    }
    return { total: ids.length, imported, missing: Math.max(0, ids.length - imported) };
  });
