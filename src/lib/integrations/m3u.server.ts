/* eslint-disable @typescript-eslint/no-explicit-any */
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { createParser, lines, itemKey, seriesItemKey, seriesKey, categoryName, norm, slugify, assertSafeListUrl, type M3uEntry } from "./m3u";
import { tmdbGet, movieMeta, seriesMeta, linkGenres, uniqueSlug } from "@/lib/tmdb/tmdb.functions";

/**
 * M3U catalog: (1) resumable, chunked INDEXING of the list into m3u_items, (2) paginated EXPLORE,
 * (3) on-demand IMPORT of selected items into the main catalog, a few per request.
 * Every request stays within a small time budget so the worker never exceeds its CPU limit.
 */
const db = supabaseAdmin as any;
const TEST_BYTES = 8 * 1024 * 1024;
const STEP_MS = 15_000;          // budget for parsing NEW data per indexing request
const STEP_WALL_MS = 90_000;     // absolute wall cap (servers without Range support re-send the skipped prefix)
const STEP_MAX_ENTRIES = 20_000; // hard cap of entries per indexing request
const IMPORT_MS = 18_000;        // wall budget per import request
const INVALID = "O conteúdo não é uma lista M3U válida.";
const msg = (e: unknown) => (e instanceof Error ? e.message : typeof e === "object" && e && "message" in e ? String((e as any).message) : "Erro inesperado");

async function listUrl(listId: string) {
  const { data } = await db.from("m3u_list_secrets").select("url").eq("list_id", listId).maybeSingle();
  if (!data?.url) throw new Error("URL da lista não configurada");
  return data.url as string;
}

/** Opens the list, asking the server to resume at `offset` (HTTP Range) when possible. */
async function openList(url: string, offset: number, timeoutMs: number) {
  assertSafeListUrl(url);
  const headers: Record<string, string> = { "User-Agent": "StreamingCatalog/1.0", Accept: "*/*" };
  if (offset > 0) headers["Range"] = `bytes=${offset}-`;
  let res: Response;
  try { res = await fetch(url, { headers, signal: AbortSignal.timeout(timeoutMs), redirect: "follow" }); }
  catch { throw new Error("O servidor da lista não respondeu."); }
  if (!res.ok || !res.body) throw new Error(res.status === 401 || res.status === 403 ? "Acesso negado pelo servidor da lista (verifique usuário/senha)." : `O servidor da lista respondeu com erro (HTTP ${res.status}).`);
  const ranged = offset > 0 && res.status === 206;
  const cr = res.headers.get("content-range")?.match(/\/(\d+)\s*$/);
  const cl = Number(res.headers.get("content-length") || 0);
  const total = cr ? Number(cr[1]) : res.status === 200 && cl > 0 ? cl : null;
  return { res, ranged, total };
}

function summarize() {
  const c = { movies: 0, episodes: 0, channels: 0, series: new Set<string>() };
  return { c, add(e: M3uEntry) { if (e.kind === "movie") c.movies++; else if (e.kind === "channel") c.channels++; else { c.episodes++; c.series.add(seriesKey(e)); } } };
}

/** Connection test: reads only the first 8 MB, imports nothing. */
export async function testList(opts: { listId?: string | undefined; url?: string | undefined }) {
  const url = opts.url?.trim() || await listUrl(opts.listId!);
  const { res } = await openList(url, 0, 25_000);
  const p = createParser(), s = summarize();
  let count = 0, truncated = false, ext = false;
  for await (const l of lines(res, 0, 0)) {
    if (!ext) { if (l.text.trim().startsWith("#EXT")) ext = true; else if (l.end > 4096) throw new Error(INVALID); }
    const e = p.line(l.text);
    if (e && e !== "skip") { s.add(e); count++; }
    if (l.end >= TEST_BYTES) { truncated = true; break; }
  }
  if (!ext || (!p.isM3u && count === 0)) throw new Error(INVALID);
  if (opts.listId) await db.from("m3u_lists").update({ detected_type: p.isPlus ? "m3u_plus" : "m3u", last_error: null }).eq("id", opts.listId);
  return { ok: true as const, type: p.isPlus ? "M3U Plus" : "M3U", total: count, approximate: truncated, movies: s.c.movies, series: s.c.series.size, episodes: s.c.episodes, channels: s.c.channels };
}

const cut = (s: string | null | undefined, n: number) => (s ? s.slice(0, n) : null);
function itemRow(listId: string, gen: number, e: M3uEntry) {
  const ep = e.kind === "episode";
  return {
    list_id: listId, ext_key: itemKey(e).slice(0, 500), kind: e.kind, title: e.title.slice(0, 300),
    title_norm: norm(ep ? `${e.series} ${e.title}` : e.title).slice(0, 300), series_key: ep ? seriesKey(e).slice(0, 400) : null,
    season: e.season, episode: e.episode, year: e.year, group_title: cut(e.group, 200), logo: cut(e.logo, 1000),
    url: e.url, stream_type: e.streamType, tvg_id: cut(e.tvgId, 200), tmdb_id: e.tmdbId, seen_gen: gen, missing: false,
  };
}
function seriesRow(listId: string, gen: number, e: M3uEntry) {
  const name = e.series ?? e.title;
  return {
    list_id: listId, ext_key: seriesItemKey(e).slice(0, 500), kind: "series", title: name.slice(0, 300), title_norm: norm(name).slice(0, 300),
    series_key: seriesKey(e).slice(0, 400), season: null, episode: null, year: null, group_title: cut(e.group, 200), logo: cut(e.logo, 1000),
    url: null, stream_type: null, tvg_id: null, tmdb_id: null, seen_gen: gen, missing: false,
  };
}

/**
 * One indexing step. Reads from the saved checkpoint, upserts entries in batches of
 * `index_batch_size`, saves the checkpoint after every batch, and stops after a short budget.
 * Never touches movies/series/channels. Call repeatedly until `done`.
 */
export async function indexStep(listId: string, restart: boolean) {
  const { data: list } = await db.from("m3u_lists").select("*").eq("id", listId).maybeSingle();
  if (!list) throw new Error("Lista não encontrada");
  if (!list.is_active) throw new Error("Ative a lista antes de sincronizar");
  const url = await listUrl(listId);
  let gen: number = list.index_gen, offset: number = Number(list.index_offset), entries: number = list.index_entries;
  let flags: any = list.index_flags ?? {};
  if (restart || !flags.running) {
    gen += 1; offset = 0; entries = 0; flags = { running: true };
    await db.from("m3u_lists").update({ sync_state: "indexing", sync_started_at: new Date().toISOString(), last_error: null, index_gen: gen, index_offset: 0, index_entries: 0, index_flags: flags }).eq("id", listId);
  } else {
    await db.from("m3u_lists").update({ sync_state: "indexing", last_error: null }).eq("id", listId);
  }
  if (flags.phase === "finalize") {
    try { return await finalizeStep(listId, gen, flags, entries); }
    catch (e) { await db.from("m3u_lists").update({ sync_state: "error", last_error: msg(e).slice(0, 500) }).eq("id", listId); throw e; }
  }
  const started = Date.now();
  const batchSize: number = list.index_batch_size ?? 500;
  try {
    const { res, ranged, total } = await openList(url, offset, 120_000);
    const parser = createParser({ m3u: flags.m3u, plus: flags.plus });
    const batch = new Map<string, any>();
    let safe = offset, stepEntries = 0, ext = offset > 0, finished = true, processStart = 0;
    const flush = async () => {
      if (!batch.size) return;
      const rows = [...batch.values()]; batch.clear();
      let r = await db.from("m3u_items").upsert(rows, { onConflict: "list_id,ext_key" });
      if (r.error) r = await db.from("m3u_items").upsert(rows, { onConflict: "list_id,ext_key" }); // one retry
      if (r.error) throw new Error(`Falha ao gravar um lote do catálogo: ${r.error.message}`);
    };
    const save = (o: number) => db.from("m3u_lists").update({
      index_offset: o, index_entries: entries, index_flags: { running: true, m3u: parser.isM3u, plus: parser.isPlus },
      index_total_bytes: total ?? list.index_total_bytes, ...(offset > 0 ? { index_range: ranged } : {}),
    }).eq("id", listId);

    for await (const l of lines(res, offset, ranged ? 0 : offset)) {
      if (!processStart) processStart = Date.now(); // skipped prefix (if any) costs network time, not parsing
      if (!ext) { if (l.text.trim().startsWith("#EXT")) ext = true; else if (l.end > 4096) throw new Error(INVALID); }
      const e = parser.line(l.text);
      if (e && e !== "skip") {
        entries++; stepEntries++;
        const row = itemRow(listId, gen, e); batch.set(row.ext_key, row);
        if (e.kind === "episode") { const s = seriesRow(listId, gen, e); if (!batch.has(s.ext_key)) batch.set(s.ext_key, s); }
      }
      if (!parser.pending) safe = l.end;
      if (batch.size >= batchSize && !parser.pending) {
        await flush(); await save(safe);
        if (Date.now() - processStart > STEP_MS || Date.now() - started > STEP_WALL_MS || stepEntries >= STEP_MAX_ENTRIES) { finished = false; break; }
      }
    }
    if (!finished) return { done: false as const, phase: "read" as const, entries, offset: safe, total: total ?? list.index_total_bytes ?? null };
    await flush();
    if (!ext || (!parser.isM3u && entries === 0)) throw new Error(INVALID);
    flags = { running: true, phase: "finalize", cursor: 0, checked: 0, counts: { movie: 0, series: 0, episode: 0, channel: 0, missing: 0 }, m3u: parser.isM3u, plus: parser.isPlus };
    await db.from("m3u_lists").update({ index_offset: safe, index_entries: entries, index_flags: flags, detected_type: parser.isPlus ? "m3u_plus" : "m3u" }).eq("id", listId);
    return await finalizeStep(listId, gen, flags, entries);
  } catch (e) {
    // Checkpoint is kept: the next call resumes from the last saved batch.
    await db.from("m3u_lists").update({ sync_state: "error", last_error: msg(e).slice(0, 500) }).eq("id", listId);
    throw e;
  }
}

const FINAL_CHUNK = 20_000;
const FINAL_MS = 20_000;
/** Closing phase, also chunked: flags vanished entries, recounts, refreshes sources of imported content. */
async function finalizeStep(listId: string, gen: number, flags: any, entries: number) {
  const started = Date.now();
  while (Date.now() - started < FINAL_MS) {
    const r = await db.rpc("m3u_finalize_chunk", { _list: listId, _gen: gen, _from: flags.cursor, _limit: FINAL_CHUNK });
    if (r.error) throw new Error(`Falha ao concluir a indexação: ${r.error.message}`);
    const c = r.data as Record<string, number>;
    for (const k of ["movie", "series", "episode", "channel", "missing"]) flags.counts[k] += Number(c[k] ?? 0);
    flags.cursor = Number(c["next"]); flags.checked += Number(c["rows"]);
    await db.from("m3u_lists").update({ index_flags: flags }).eq("id", listId);
    if (Number(c["rows"]) < FINAL_CHUNK) {
      const s = await db.rpc("m3u_finalize_sources", { _list: listId, _gen: gen });
      if (s.error) throw new Error(`Falha ao atualizar as fontes importadas: ${s.error.message}`);
      const k = flags.counts;
      await db.from("m3u_lists").update({
        sync_state: "indexed", last_synced_at: new Date().toISOString(), last_error: null, index_offset: 0, index_entries: entries,
        index_flags: { m3u: flags.m3u, plus: flags.plus }, movies_count: k.movie, series_count: k.series, episodes_count: k.episode,
        channels_count: k.channel, total_items: k.movie + k.episode + k.channel,
      }).eq("id", listId);
      return { done: true as const, phase: "done" as const, entries, counts: k as Record<string, number>, offset: 0, total: null };
    }
  }
  return { done: false as const, phase: "finalize" as const, entries, checked: flags.checked as number, offset: 0, total: null };
}

/* ------------------------------ explore ------------------------------ */
export type ExploreFilter = { listId: string; kind: "all" | "movie" | "series" | "channel"; status: "all" | "imported" | "not_imported" | "error" | "missing"; group?: string | null | undefined; q?: string | undefined };

function filtered(q: any, f: ExploreFilter) {
  q = q.eq("list_id", f.listId);
  q = f.kind === "all" ? q.neq("kind", "episode") : q.eq("kind", f.kind);
  if (f.status === "imported") q = q.not("content_id", "is", null);
  else if (f.status === "not_imported") q = q.is("content_id", null).eq("missing", false);
  else if (f.status === "error") q = q.not("import_error", "is", null);
  else if (f.status === "missing") q = q.eq("missing", true);
  if (f.group) q = q.eq("group_title", f.group);
  const term = norm(f.q ?? "");
  if (term) q = q.ilike("title_norm", `%${term}%`);
  return q;
}

export async function explore(f: ExploreFilter & { page: number; pageSize: number }) {
  const from = (f.page - 1) * f.pageSize;
  const r = await filtered(db.from("m3u_items").select("id,kind,title,year,group_title,logo,tmdb_id,episode_count,missing,content_id,imported_at,import_error,import_attempts", { count: "exact" }), f)
    .order("title_norm").order("id").range(from, from + f.pageSize - 1);
  if (r.error) throw new Error("Não foi possível pesquisar o catálogo");
  return { items: r.data as any[], total: r.count ?? 0 };
}

export async function groups(listId: string, kind: string) {
  const r = await db.rpc("m3u_groups", { _list: listId, _kind: kind });
  if (r.error) throw new Error("Não foi possível carregar os grupos");
  return (r.data ?? []) as { group_title: string; n: number }[];
}

/** Ids of the next not-imported items matching the filters (capped by the caller at 500). */
export async function pickIds(f: ExploreFilter, limit: number) {
  const r = await filtered(db.from("m3u_items").select("id"), { ...f, status: "not_imported" }).order("title_norm").order("id").limit(limit);
  if (r.error) throw new Error("Não foi possível selecionar os itens");
  return (r.data ?? []).map((x: any) => x.id as number);
}

/* ------------------------------ import ------------------------------ */
type Item = { id: number; list_id: string; ext_key: string; kind: string; title: string; series_key: string | null; season: number | null; episode: number | null; year: number | null; group_title: string | null; logo: string | null; url: string | null; stream_type: string | null; tmdb_id: number | null; content_id: string | null; import_attempts: number };
export type ImportResult = { id: number; status: "done" | "skipped" | "partial" | "pending" | "error"; message?: string; remaining?: number; episodeErrors?: number };

/**
 * Imports a few catalog items into the main catalog. Duplicate checks, in order:
 * TMDB ID → stable M3U id (item.content_id) → normalized title + year → (episodes) series+season+episode
 * → stream URL. Existing content is reused and only the M3U source is added/updated. New content is published.
 * Series import their episodes progressively ("partial" until none remain).
 */
export async function importItems(listId: string, ids: number[], jobStart: string, batchId: string) {
  const { data: list } = await db.from("m3u_lists").select("id,name,enrich_tmdb").eq("id", listId).maybeSingle();
  if (!list) throw new Error("Lista não encontrada");
  const started = Date.now();
  const over = () => Date.now() - started > IMPORT_MS;
  const ctx = { supabase: db, userId: "" };
  const now = () => new Date().toISOString();
  const cats = new Map<string, string | null>();
  let tmdbBudget = list.enrich_tmdb ? 8 : 0;

  const category = async (group: string | null) => {
    const name = categoryName(group); if (!name) return null;
    const slug = slugify(name); if (!slug) return null;
    if (cats.has(slug)) return cats.get(slug)!;
    let { data } = await db.from("categories").select("id").eq("slug", slug).maybeSingle();
    if (!data) { const r = await db.from("categories").insert({ name, slug, status: "published" }).select("id").single(); data = r.data ?? (await db.from("categories").select("id").eq("slug", slug).maybeSingle()).data; }
    cats.set(slug, data?.id ?? null); return data?.id ?? null;
  };
  const exists = async (table: string, id: string | null) => (id ? ((await db.from(table).select("id").eq("id", id).maybeSingle()).data?.id as string | undefined) ?? null : null);
  const byTmdb = async (table: string, tmdbId: number | null) => (tmdbId ? ((await db.from(table).select("id").eq("tmdb_id", tmdbId).limit(1).maybeSingle()).data?.id as string | undefined) ?? null : null);
  const byTitle = async (table: string, col: string, title: string, year?: number | null) => {
    let q = db.from(table).select(`id,${col}`).ilike(col, title.replace(/[%_\\]/g, "\\$&")).limit(5);
    if (year && table !== "channels") q = q.eq("release_year", year);
    const { data } = await q;
    const m = (data ?? []).filter((r: any) => norm(r[col]) === norm(title));
    return m.length === 1 ? (m[0].id as string) : null;
  };
  const byUrl = async (kind: string, url: string | null) => (url ? ((await db.from("playback_sources").select("content_id").eq("content_kind", kind).eq("url", url).limit(1).maybeSingle()).data?.content_id as string | undefined) ?? null : null);
  const tmdbFind = async (kind: "movie" | "tv", title: string, y: number | null) => {
    if (tmdbBudget <= 0 || (kind === "movie" && !y)) return null; // only confident matches
    tmdbBudget--;
    try {
      const r: any = await tmdbGet(`/search/${kind}`, { query: title, language: "pt-BR", ...(kind === "movie" ? { year: y! } : {}) }, { ttl: 86400 });
      const hits = (r.results ?? []).filter((x: any) => [x.title, x.original_title, x.name, x.original_name].some((t) => t && norm(t) === norm(title)) && (kind === "tv" || String(x.release_date ?? "").startsWith(String(y))));
      return hits.length === 1 ? (hits[0].id as number) : null;
    } catch { tmdbBudget = 0; return null; }
  };
  const source = async (kind: "movie" | "episode" | "channel", contentId: string, it: Item) => {
    if (!it.url) return;
    const fields = { url: it.url, source_type: it.stream_type === "hls" ? "hls" : "url", last_seen_at: now(), unavailable_since: null };
    const { data: ex } = await db.from("playback_sources").select("id").eq("m3u_list_id", listId).eq("content_kind", kind).eq("content_id", contentId).eq("external_ref", it.ext_key).maybeSingle();
    if (ex) { const u = await db.from("playback_sources").update(fields).eq("id", ex.id); if (u.error) throw u.error; return; }
    const { count } = await db.from("playback_sources").select("id", { count: "exact", head: true }).eq("content_kind", kind).eq("content_id", contentId).eq("is_active", true);
    const r = await db.from("playback_sources").insert({ ...fields, content_kind: kind, content_id: contentId, external_ref: it.ext_key, m3u_list_id: listId, label: String(list.name).slice(0, 60), provider: "m3u", is_active: true, is_primary: !count, sort_order: count ?? 0, drm: {} });
    if (r.error) throw r.error;
  };
  const fillMissing = async (table: string, id: string, imgCol: string, it: Item) => {
    const { data: cur } = await db.from(table).select(`${imgCol},category_id`).eq("id", id).single();
    const upd: any = {}; if (!cur?.[imgCol] && it.logo) upd[imgCol] = it.logo; if (!cur?.category_id) upd.category_id = await category(it.group_title);
    if (upd.category_id === null) delete upd.category_id;
    if (Object.keys(upd).length) await db.from(table).update(upd).eq("id", id);
  };
  const markOk = (it: Item, contentId: string) => db.from("m3u_items").update({ content_id: contentId, imported_at: now(), import_error: null, import_attempts: it.import_attempts + 1, last_attempt_at: now() }).eq("id", it.id);
  const markErr = async (it: Item, e: unknown) => {
    const m = msg(e).slice(0, 500);
    await db.from("m3u_items").update({ import_error: m, import_attempts: it.import_attempts + 1, last_attempt_at: now() }).eq("id", it.id);
    await db.from("m3u_import_errors").insert({ list_id: listId, item_id: it.id, batch_id: batchId, error: m, attempt: it.import_attempts + 1 });
    return m;
  };

  async function importMovie(it: Item) {
    let id = await exists("movies", it.content_id);
    if (id) { await source("movie", id, it); return { id, skipped: true }; }
    id = (await byTmdb("movies", it.tmdb_id)) ?? (await byTitle("movies", "title", it.title, it.year)) ?? (await byUrl("movie", it.url));
    if (id) await fillMissing("movies", id, "poster_url", it);
    else {
      const tmdbId = it.tmdb_id ?? (await tmdbFind("movie", it.title, it.year));
      let meta: Awaited<ReturnType<typeof movieMeta>> | null = null;
      if (tmdbId && list.enrich_tmdb) { try { meta = await movieMeta(tmdbId, false); } catch { meta = null; } }
      id = meta ? await byTmdb("movies", meta.fields.tmdb_id) : null;
      if (!id) {
        const base: any = meta ? meta.fields : { title: it.title.slice(0, 200), poster_url: it.logo, release_year: it.year, external_source: `m3u:${listId}`, external_id: it.ext_key.slice(0, 200) };
        const slug = await uniqueSlug(ctx, "movies", base.title, base.release_year ?? null);
        const ins = await db.from("movies").insert({ ...base, poster_url: base.poster_url ?? it.logo, category_id: await category(it.group_title), slug, status: "published" }).select("id").single();
        if (ins.error) throw ins.error;
        id = ins.data.id as string;
        if (meta) await linkGenres(ctx, "movie", id, meta.genres);
      }
    }
    await source("movie", id!, it);
    return { id: id!, skipped: false };
  }

  async function importChannel(it: Item) {
    let id = await exists("channels", it.content_id);
    if (id) { await source("channel", id, it); return { id, skipped: true }; }
    id = (await byTitle("channels", "name", it.title)) ?? (await byUrl("channel", it.url));
    if (id) await fillMissing("channels", id, "logo_url", it);
    else {
      const slug = await uniqueSlug(ctx, "channels", it.title, null);
      const ins = await db.from("channels").insert({ name: it.title.slice(0, 200), slug, logo_url: it.logo, category_id: await category(it.group_title), status: "published" }).select("id").single();
      if (ins.error) throw ins.error;
      id = ins.data.id as string;
    }
    await source("channel", id!, it);
    return { id: id!, skipped: false };
  }

  async function importSeries(it: Item) {
    let sid = await exists("series", it.content_id);
    if (!sid) {
      sid = await byTitle("series", "title", it.title);
      if (sid) await fillMissing("series", sid, "poster_url", it);
      else {
        const tmdbId = await tmdbFind("tv", it.title, null);
        let meta: Awaited<ReturnType<typeof seriesMeta>> | null = null;
        if (tmdbId) { try { meta = await seriesMeta(tmdbId, false); } catch { meta = null; } }
        sid = meta ? await byTmdb("series", meta.fields.tmdb_id) : null;
        if (!sid) {
          const base: any = meta ? meta.fields : { title: it.title.slice(0, 200), poster_url: it.logo, external_source: `m3u:${listId}`, external_id: it.ext_key.slice(0, 200) };
          const slug = await uniqueSlug(ctx, "series", base.title, base.release_year ?? null);
          const ins = await db.from("series").insert({ ...base, poster_url: base.poster_url ?? it.logo, category_id: await category(it.group_title), slug, status: "published" }).select("id").single();
          if (ins.error) throw ins.error;
          sid = ins.data.id as string;
          if (meta) await linkGenres(ctx, "series", sid, meta.genres);
        }
      }
      await markOk(it, sid!);
    }
    const seasons = new Map<number, string>();
    let errors = 0;
    const pendingQ = (sel: any) => sel.eq("list_id", listId).eq("kind", "episode").eq("series_key", it.series_key).is("content_id", null).eq("missing", false).or(`import_error.is.null,last_attempt_at.lt."${jobStart}"`);
    while (!over()) {
      const { data: eps } = await pendingQ(db.from("m3u_items").select("*")).order("season").order("episode").limit(50);
      if (!eps?.length) break;
      for (const ep of eps as Item[]) {
        if (over()) break;
        try {
          let seasonId = seasons.get(ep.season!);
          if (!seasonId) {
            seasonId = (await db.from("seasons").select("id").eq("series_id", sid).eq("season_number", ep.season).limit(1).maybeSingle()).data?.id;
            if (!seasonId) { const s = await db.from("seasons").insert({ series_id: sid, season_number: ep.season, title: `Temporada ${ep.season}`, status: "published", sort_order: ep.season }).select("id").single(); if (s.error) throw s.error; seasonId = s.data.id; }
            seasons.set(ep.season!, seasonId!);
          }
          const cur = (await db.from("episodes").select("id,thumbnail_url").eq("season_id", seasonId).eq("episode_number", ep.episode).limit(1).maybeSingle()).data as any;
          let eid: string;
          if (cur) { eid = cur.id; if (!cur.thumbnail_url && ep.logo) await db.from("episodes").update({ thumbnail_url: ep.logo }).eq("id", eid); }
          else { const ins = await db.from("episodes").insert({ season_id: seasonId, episode_number: ep.episode, title: ep.title.slice(0, 200), thumbnail_url: ep.logo, status: "published" }).select("id").single(); if (ins.error) throw ins.error; eid = ins.data.id; }
          await source("episode", eid, ep);
          await markOk(ep, eid);
        } catch (e) { errors++; await markErr(ep, e); }
      }
    }
    const { count } = await pendingQ(db.from("m3u_items").select("id", { count: "exact", head: true }));
    return { remaining: count ?? 0, errors };
  }

  const results: ImportResult[] = [];
  for (const id of ids) {
    if (over()) { results.push({ id, status: "pending" }); continue; }
    const { data: it } = await db.from("m3u_items").select("*").eq("id", id).eq("list_id", listId).maybeSingle();
    if (!it) { results.push({ id, status: "skipped", message: "Item não encontrado" }); continue; }
    try {
      if (it.kind === "series") {
        const r = await importSeries(it);
        results.push({ id, status: r.remaining ? "partial" : "done", remaining: r.remaining, episodeErrors: r.errors });
      } else if (it.kind === "movie" || it.kind === "channel") {
        const r = it.kind === "movie" ? await importMovie(it) : await importChannel(it);
        await markOk(it, r.id);
        results.push({ id, status: r.skipped ? "skipped" : "done", ...(r.skipped ? { message: "Já importado — fonte atualizada" } : {}) });
      } else results.push({ id, status: "skipped", message: "Importe pela série" });
    } catch (e) { results.push({ id, status: "error", message: await markErr(it, e) }); }
  }
  return results;
}
