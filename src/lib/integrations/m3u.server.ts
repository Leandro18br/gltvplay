/* eslint-disable @typescript-eslint/no-explicit-any */
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { createParser, entityKey, seriesKey, categoryName, norm, slugify, assertSafeListUrl, type M3uEntry } from "./m3u";
import { tmdbGet, movieMeta, seriesMeta, linkGenres, uniqueSlug } from "@/lib/tmdb/tmdb.functions";

const db = supabaseAdmin as any;
const MAX_ENTRIES = 200_000;
const TEST_BYTES = 8 * 1024 * 1024;
const CHUNK = 50;

async function listUrl(listId: string) {
  const { data } = await db.from("m3u_list_secrets").select("url").eq("list_id", listId).maybeSingle();
  if (!data?.url) throw new Error("URL da lista não configurada");
  return data.url as string;
}

/** Streams the list line by line; never buffers the whole file. Stops after maxBytes when given. */
async function streamList(url: string, onEntry: (e: M3uEntry) => Promise<void> | void, maxBytes?: number) {
  assertSafeListUrl(url);
  let res: Response;
  try { res = await fetch(url, { headers: { "User-Agent": "StreamingCatalog/1.0", Accept: "*/*" }, signal: AbortSignal.timeout(maxBytes ? 25000 : 180000), redirect: "follow" }); }
  catch { throw new Error("O servidor da lista não respondeu."); }
  if (!res.ok || !res.body) throw new Error(res.status === 401 || res.status === 403 ? "Acesso negado pelo servidor da lista (verifique usuário/senha)." : `O servidor da lista respondeu com erro (HTTP ${res.status}).`);
  const parser = createParser();
  const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
  let buf = "", bytes = 0, count = 0, truncated = false, first = true;
  outer: for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    bytes += value.length; buf += value;
    if (first) { first = false; if (!/^\uFEFF?\s*#EXTM3U/.test(buf) && !/#EXTINF/.test(buf.slice(0, 4096))) { await reader.cancel(); throw new Error("O conteúdo não é uma lista M3U válida."); } }
    let i: number;
    while ((i = buf.indexOf("\n")) >= 0) {
      const e = parser.line(buf.slice(0, i)); buf = buf.slice(i + 1);
      if (e && e !== "skip") { await onEntry(e); if (++count >= MAX_ENTRIES) { truncated = true; await reader.cancel(); break outer; } }
    }
    if (maxBytes && bytes >= maxBytes) { truncated = true; await reader.cancel(); break; }
  }
  if (buf) { const e = parser.line(buf); if (e && e !== "skip") { await onEntry(e); count++; } }
  if (!parser.isM3u && count === 0) throw new Error("O conteúdo não é uma lista M3U válida.");
  return { count, truncated, plus: parser.isPlus };
}

function summarize() {
  const c = { movies: 0, episodes: 0, channels: 0, series: new Set<string>() };
  return { c, add(e: M3uEntry) { if (e.kind === "movie") c.movies++; else if (e.kind === "channel") c.channels++; else { c.episodes++; c.series.add(seriesKey(e)); } } };
}

export async function testList(opts: { listId?: string; url?: string }) {
  const url = opts.url?.trim() || await listUrl(opts.listId!);
  const s = summarize();
  const r = await streamList(url, e => s.add(e), TEST_BYTES);
  const out = { ok: true, type: r.plus ? "M3U Plus" : "M3U", total: r.count, approximate: r.truncated, movies: s.c.movies, series: s.c.series.size, episodes: s.c.episodes, channels: s.c.channels };
  if (opts.listId) await db.from("m3u_lists").update({ detected_type: r.plus ? "m3u_plus" : "m3u", last_error: null }).eq("id", opts.listId);
  return out;
}

/** Step 1: download + parse into the staging queue. */
export async function startSync(listId: string) {
  const { data: list } = await db.from("m3u_lists").select("*").eq("id", listId).maybeSingle();
  if (!list) throw new Error("Lista não encontrada");
  if (!list.is_active) throw new Error("Ative a lista antes de sincronizar");
  const url = await listUrl(listId);
  await db.from("m3u_staging").delete().eq("list_id", listId);
  await db.from("m3u_lists").update({ sync_state: "reading", sync_started_at: new Date().toISOString(), last_error: null, processed_items: 0, total_items: 0, last_report: {} }).eq("id", listId);
  const s = summarize();
  let batch: any[] = [];
  const flush = async () => { if (!batch.length) return; const r = await db.from("m3u_staging").insert(batch); batch = []; if (r.error) throw new Error("Falha ao preparar a importação"); };
  try {
    const r = await streamList(url, async e => {
      s.add(e);
      const sk = e.kind === "episode" ? `${seriesKey(e)}|${String(e.season).padStart(3, "0")}|${String(e.episode).padStart(4, "0")}` : "";
      batch.push({ list_id: listId, kind: e.kind, sort_key: sk, data: e });
      if (batch.length >= 1000) await flush();
    });
    await flush();
    await db.from("m3u_lists").update({ sync_state: "processing", detected_type: r.plus ? "m3u_plus" : "m3u", total_items: r.count, movies_count: s.c.movies, series_count: s.c.series.size, episodes_count: s.c.episodes, channels_count: s.c.channels }).eq("id", listId);
    return { total: r.count, truncated: r.truncated };
  } catch (e) {
    await db.from("m3u_lists").update({ sync_state: "error", last_error: e instanceof Error ? e.message : "Erro" }).eq("id", listId);
    throw e;
  }
}

type Report = Record<"movies_new" | "movies_updated" | "series_new" | "episodes_new" | "episodes_updated" | "channels_new" | "channels_updated" | "ignored" | "errors", number>;
const emptyReport = (): Report => ({ movies_new: 0, movies_updated: 0, series_new: 0, episodes_new: 0, episodes_updated: 0, channels_new: 0, channels_updated: 0, ignored: 0, errors: 0 });

/** Step 2: apply one chunk of the queue. Called repeatedly by the admin UI until done. */
export async function processChunk(listId: string) {
  const { data: list } = await db.from("m3u_lists").select("*").eq("id", listId).maybeSingle();
  if (!list) throw new Error("Lista não encontrada");
  if (list.sync_state !== "processing") return { done: list.sync_state === "done", processed: list.processed_items, total: list.total_items, report: list.last_report };
  const { data: rows } = await db.from("m3u_staging").select("id,kind,data").eq("list_id", listId).eq("done", false).order("kind").order("sort_key").order("id").limit(CHUNK);
  const report: Report = { ...emptyReport(), ...(list.last_report ?? {}) };
  const ctx = { supabase: db, userId: "" };
  const now = new Date().toISOString();
  const cats = new Map<string, string | null>();
  const seriesIds = new Map<string, string>(), seasonIds = new Map<string, string>();
  let tmdbBudget = list.enrich_tmdb ? 15 : 0;

  const category = async (group: string | null) => {
    const name = categoryName(group); if (!name) return null;
    const slug = slugify(name); if (!slug) return null;
    if (cats.has(slug)) return cats.get(slug)!;
    let { data } = await db.from("categories").select("id").eq("slug", slug).maybeSingle();
    if (!data) { const r = await db.from("categories").insert({ name, slug, status: "published" }).select("id").single(); data = r.data ?? (await db.from("categories").select("id").eq("slug", slug).maybeSingle()).data; }
    cats.set(slug, data?.id ?? null); return data?.id ?? null;
  };
  const entity = async (kind: string, key: string, table: string) => {
    const { data } = await db.from("m3u_entities").select("content_id").eq("list_id", listId).eq("kind", kind).eq("ext_key", key).maybeSingle();
    if (!data) return null;
    const { data: row } = await db.from(table).select("id").eq("id", data.content_id).maybeSingle();
    return row?.id ?? null;
  };
  const remember = (kind: string, key: string, id: string) => db.from("m3u_entities").upsert({ list_id: listId, kind, ext_key: key, content_id: id, last_seen_at: now });
  const byTitle = async (table: string, col: string, title: string, year?: number | null) => {
    let q = db.from(table).select(`id,${col}`).ilike(col, title.replace(/[%_]/g, "\\$&")).limit(3);
    if (year) q = q.eq("release_year", year);
    const { data } = await q;
    const m = (data ?? []).filter((r: any) => norm(r[col]) === norm(title));
    return m.length === 1 ? m[0].id as string : null;
  };
  const tmdbFind = async (kind: "movie" | "tv", title: string, year: number | null) => {
    if (tmdbBudget <= 0) return null;
    if (kind === "movie" && !year) return null; // only confident matches
    tmdbBudget--;
    try {
      const r: any = await tmdbGet(`/search/${kind}`, { query: title, language: "pt-BR", ...(kind === "movie" ? { year: year! } : {}) }, { ttl: 86400 });
      const hits = (r.results ?? []).filter((x: any) => [x.title, x.original_title, x.name, x.original_name].some(t => t && norm(t) === norm(title)) && (kind === "tv" || String(x.release_date ?? "").startsWith(String(year))));
      return hits.length === 1 ? hits[0].id as number : null;
    } catch { tmdbBudget = 0; return null; }
  };
  const source = async (kind: "movie" | "episode" | "channel", contentId: string, key: string, e: M3uEntry) => {
    const { data: ex } = await db.from("playback_sources").select("id").eq("m3u_list_id", listId).eq("content_kind", kind).eq("content_id", contentId).eq("external_ref", key).maybeSingle();
    const fields = { url: e.url, source_type: e.streamType, last_seen_at: now, unavailable_since: null };
    if (ex) { await db.from("playback_sources").update(fields).eq("id", ex.id); return; }
    const { count } = await db.from("playback_sources").select("id", { count: "exact", head: true }).eq("content_kind", kind).eq("content_id", contentId).eq("is_active", true);
    const r = await db.from("playback_sources").insert({ ...fields, content_kind: kind, content_id: contentId, external_ref: key, m3u_list_id: listId, label: list.name.slice(0, 60), provider: "m3u", is_active: true, is_primary: !count, sort_order: count ?? 0, drm: {} });
    if (r.error) throw r.error;
  };

  for (const row of rows ?? []) {
    const e = row.data as M3uEntry;
    try {
      const key = entityKey(e);
      if (e.kind === "movie") {
        let id = await entity("movie", key, "movies");
        if (!id && e.tmdbId) id = (await db.from("movies").select("id").eq("tmdb_id", e.tmdbId).maybeSingle()).data?.id ?? null;
        if (!id) id = await byTitle("movies", "title", e.title, e.year);
        if (id) {
          const { data: cur } = await db.from("movies").select("poster_url,category_id").eq("id", id).single();
          const upd: any = {}; if (!cur?.poster_url && e.logo) upd.poster_url = e.logo; if (!cur?.category_id) upd.category_id = await category(e.group);
          if (Object.keys(upd).length) await db.from("movies").update(upd).eq("id", id);
          report.movies_updated++;
        } else {
          const tmdbId = e.tmdbId ?? await tmdbFind("movie", e.title, e.year);
          const category_id = await category(e.group);
          let meta: Awaited<ReturnType<typeof movieMeta>> | null = null;
          if (tmdbId && list.enrich_tmdb) { try { meta = await movieMeta(tmdbId, false); } catch { meta = null; } }
          const exTmdb = meta ? (await db.from("movies").select("id").eq("tmdb_id", meta.fields.tmdb_id).maybeSingle()).data?.id : null;
          if (exTmdb) { id = exTmdb; report.movies_updated++; }
          else {
            const base = meta ? meta.fields : { title: e.title.slice(0, 200), poster_url: e.logo, release_year: e.year, external_source: `m3u:${listId}`, external_id: key.slice(0, 200) };
            const slug = await uniqueSlug(ctx, "movies", base.title, base.release_year ?? null);
            const ins = await db.from("movies").insert({ ...base, poster_url: base.poster_url ?? e.logo, category_id, slug, status: "published" }).select("id").single();
            if (ins.error) throw ins.error;
            id = ins.data.id as string; report.movies_new++;
            if (meta) await linkGenres(ctx, "movie", id, meta.genres);
          }
        }
        await remember("movie", key, id!); await source("movie", id!, key, e);
      } else if (e.kind === "channel") {
        let id = await entity("channel", key, "channels");
        if (!id) id = await byTitle("channels", "name", e.title);
        if (id) {
          const { data: cur } = await db.from("channels").select("logo_url,category_id").eq("id", id).single();
          const upd: any = {}; if (!cur?.logo_url && e.logo) upd.logo_url = e.logo; if (!cur?.category_id) upd.category_id = await category(e.group);
          if (Object.keys(upd).length) await db.from("channels").update(upd).eq("id", id);
          report.channels_updated++;
        } else {
          const slug = await uniqueSlug(ctx, "channels", e.title, null);
          const ins = await db.from("channels").insert({ name: e.title.slice(0, 200), slug, logo_url: e.logo, category_id: await category(e.group), status: "published" }).select("id").single();
          if (ins.error) throw ins.error;
          id = ins.data.id as string; report.channels_new++;
        }
        await remember("channel", key, id!); await source("channel", id!, key, e);
      } else {
        const sk = seriesKey(e);
        let sid = seriesIds.get(sk) ?? await entity("series", sk, "series");
        if (!sid) sid = await byTitle("series", "title", e.series!);
        if (!sid) {
          const tmdbId = await tmdbFind("tv", e.series!, null);
          let meta: Awaited<ReturnType<typeof seriesMeta>> | null = null;
          if (tmdbId) { try { meta = await seriesMeta(tmdbId, false); } catch { meta = null; } }
          const exT = meta ? (await db.from("series").select("id").eq("tmdb_id", meta.fields.tmdb_id).maybeSingle()).data?.id : null;
          if (exT) sid = exT;
          else {
            const base = meta ? meta.fields : { title: e.series!.slice(0, 200), poster_url: e.logo, external_source: `m3u:${listId}`, external_id: sk.slice(0, 200) };
            const slug = await uniqueSlug(ctx, "series", base.title, (base as any).release_year ?? null);
            const ins = await db.from("series").insert({ ...base, category_id: await category(e.group), slug, status: "published" }).select("id").single();
            if (ins.error) throw ins.error;
            sid = ins.data.id as string; report.series_new++;
            if (meta) await linkGenres(ctx, "series", sid, meta.genres);
          }
        }
        seriesIds.set(sk, sid!); await remember("series", sk, sid!);
        const seasonKey = `${sid}|${e.season}`;
        let seasonId = seasonIds.get(seasonKey);
        if (!seasonId) {
          seasonId = (await db.from("seasons").select("id").eq("series_id", sid).eq("season_number", e.season).maybeSingle()).data?.id;
          if (!seasonId) { const s = await db.from("seasons").insert({ series_id: sid, season_number: e.season, title: `Temporada ${e.season}`, status: "published", sort_order: e.season }).select("id").single(); if (s.error) throw s.error; seasonId = s.data.id; }
          seasonIds.set(seasonKey, seasonId!);
        }
        let eid = (await db.from("episodes").select("id,thumbnail_url").eq("season_id", seasonId).eq("episode_number", e.episode).maybeSingle()).data as any;
        if (eid) { if (!eid.thumbnail_url && e.logo) await db.from("episodes").update({ thumbnail_url: e.logo }).eq("id", eid.id); report.episodes_updated++; eid = eid.id; }
        else { const ins = await db.from("episodes").insert({ season_id: seasonId, episode_number: e.episode, title: e.title.slice(0, 200), thumbnail_url: e.logo, status: "published" }).select("id").single(); if (ins.error) throw ins.error; eid = ins.data.id; report.episodes_new++; }
        await remember("episode", key, eid); await source("episode", eid, key, e);
      }
    } catch { report.errors++; }
  }
  const ids = (rows ?? []).map((r: any) => r.id);
  if (ids.length) await db.from("m3u_staging").update({ done: true }).in("id", ids);
  const processed = list.processed_items + ids.length;
  const finished = ids.length < CHUNK;
  if (finished) {
    await db.from("playback_sources").update({ unavailable_since: now }).eq("m3u_list_id", listId).is("unavailable_since", null).or(`last_seen_at.is.null,last_seen_at.lt.${list.sync_started_at}`);
    await db.from("m3u_staging").delete().eq("list_id", listId);
  }
  await db.from("m3u_lists").update({ processed_items: processed, last_report: report, ...(finished ? { sync_state: "done", last_synced_at: now } : {}) }).eq("id", listId);
  return { done: finished, processed, total: list.total_items, report };
}
