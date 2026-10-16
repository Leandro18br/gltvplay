/* eslint-disable @typescript-eslint/no-explicit-any */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { extrasPatch, mapCredits, mapVideos } from "./extras";
import { completionFields, coverDecision, isMissing, missingMetadata, rankCandidates, reliableMatch, rowYear, searchTitles, simplifiedTitle, type MatchCandidate, type CompletionKind } from "./completion";

/**
 * Official TMDB integration — METADATA ONLY. Never creates playback sources.
 * Credentials stay server-side (TMDB_API_KEY secret: v3 key or v4 read token).
 */
const BASE = "https://api.themoviedb.org/3";
const LANG = "pt-BR";
const DAY = 86400;

export class TmdbError extends Error {}

type Ctx = { supabase: any; userId: string };

export async function assertStaff(ctx: Ctx) {
  const { data } = await ctx.supabase.rpc("is_staff", { _user_id: ctx.userId });
  if (!data) throw new Error("Acesso negado");
}

async function admin() {
  return (await import("@/integrations/supabase/client.server")).supabaseAdmin as any;
}

function errorFor(status: number, notFound: string) {
  if (status === 401) return "API Key do TMDB inválida ou não configurada.";
  if (status === 404) return notFound;
  if (status === 429) return "Limite de requisições do TMDB atingido. Tente novamente mais tarde.";
  return "Não foi possível conectar ao TMDB.";
}

export async function tmdbGet(path: string, params: Record<string, string | number | undefined>, opts: { ttl: number; fresh?: boolean; notFound?: string }) {
  const key = process.env["TMDB_API_KEY"];
  if (!key) throw new TmdbError("API Key do TMDB inválida ou não configurada.");
  const clean = Object.entries(params).filter(([, v]) => v !== undefined && v !== "").sort(([a], [b]) => a.localeCompare(b));
  const cacheKey = `${path}?${clean.map(([k, v]) => `${k}=${v}`).join("&")}`;
  const db = await admin();
  if (!opts.fresh && opts.ttl > 0) {
    const { data } = await db.from("tmdb_cache").select("body").eq("cache_key", cacheKey).gt("expires_at", new Date().toISOString()).maybeSingle();
    if (data) return data.body;
  }
  const url = new URL(BASE + path);
  clean.forEach(([k, v]) => url.searchParams.set(k, String(v)));
  const headers: Record<string, string> = { accept: "application/json" };
  if (key.startsWith("eyJ")) headers["Authorization"] = `Bearer ${key}`;
  else url.searchParams.set("api_key", key);
  let res: Response;
  try {
    res = await fetch(url, { headers, signal: AbortSignal.timeout(12000) });
  } catch {
    throw new TmdbError("Não foi possível conectar ao TMDB.");
  }
  if (!res.ok) throw new TmdbError(errorFor(res.status, opts.notFound ?? "Conteúdo não encontrado."));
  const body = await res.json();
  if (opts.ttl > 0) {
    await db.from("tmdb_cache").upsert({ cache_key: cacheKey, body, expires_at: new Date(Date.now() + opts.ttl * 1000).toISOString() });
  }
  return body;
}

type Images = { base: string; poster: string; backdrop: string; still: string };
async function imageConfig(): Promise<Images> {
  const c = await tmdbGet("/configuration", {}, { ttl: DAY });
  const img = c.images ?? {};
  const pick = (list: string[] | undefined, want: string) => (list?.includes(want) ? want : "original");
  return { base: img.secure_base_url ?? "https://image.tmdb.org/t/p/", poster: pick(img.poster_sizes, "w500"), backdrop: pick(img.backdrop_sizes, "w1280"), still: pick(img.still_sizes, "w300") };
}
const imgUrl = (i: Images, size: string, p?: string | null) => (p ? `${i.base}${size}${p}` : null);
const year = (d?: string | null) => (d && /^\d{4}/.test(d) ? Number(d.slice(0, 4)) : null);
const date = (d?: string | null) => (d && /^\d{4}-\d{2}-\d{2}$/.test(d) ? d : null);
const slugify = (s: string) => s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");

function wrap<T>(fn: () => Promise<T>) {
  return fn().catch((e) => {
    if (e instanceof TmdbError) throw new Error(e.message);
    throw e;
  });
}

// Maps TMDB genre ids onto the fixed system genres only; never creates new genres.
export async function linkGenres(ctx: Ctx, kind: "movie" | "series", contentId: string, genres: { id?: number; name: string }[]) {
  const joinTable = kind === "movie" ? "movie_genres" : "series_genres";
  const fk = kind === "movie" ? "movie_id" : "series_id";
  const ids = (genres ?? []).map((g) => g.id).filter((n): n is number => typeof n === "number");
  if (!ids.length) return;
  const { data: rows } = await (ctx.supabase.from("genres") as any).select("id").overlaps("tmdb_genre_ids", ids);
  for (const row of (rows ?? []) as { id: string }[]) {
    await ctx.supabase.from(joinTable).upsert({ [fk]: contentId, genre_id: row.id } as any, { onConflict: `${fk},genre_id`, ignoreDuplicates: true });
  }
}

export async function uniqueSlug(ctx: Ctx, table: string, title: string, y: number | null) {
  const base = slugify(title) || "conteudo";
  for (const s of [base, y ? `${base}-${y}` : null, `${base}-${Date.now().toString(36)}`]) {
    if (!s) continue;
    const { data } = await ctx.supabase.from(table).select("id").eq("slug", s).maybeSingle();
    if (!data) return s;
  }
  return `${base}-${crypto.randomUUID().slice(0, 6)}`;
}

/* ---------- metadata mappers (only TMDB-owned columns) ---------- */
/** pt-BR first, then pt-PT; never falls back to English text for synopsis. */
function ptTranslation(body: any) {
  const list = (body.translations?.translations ?? []) as any[];
  const br = list.find((t) => t.iso_639_1 === "pt" && t.iso_3166_1 === "BR")?.data ?? {};
  const pt = list.find((t) => t.iso_639_1 === "pt" && t.iso_3166_1 === "PT")?.data ?? {};
  const pick = (k: string) => (typeof br[k] === "string" && br[k].trim()) || (typeof pt[k] === "string" && pt[k].trim()) || null;
  return { title: (typeof br.title === "string" && br.title.trim()) || (typeof br.name === "string" && br.name.trim()) || null, overview: pick("overview"), tagline: pick("tagline") };
}
const DETAIL_APPEND = "external_ids,translations";
const MOVIE_FULL = "external_ids,translations,credits,videos,release_dates";
const TV_FULL = "external_ids,translations,credits,videos,content_ratings";
const VIDEO_LANGS = "pt,en,null";
export async function movieMeta(tmdbId: number, fresh: boolean) {
  const [m, i] = await Promise.all([tmdbGet(`/movie/${tmdbId}`, { language: LANG, append_to_response: MOVIE_FULL, include_video_language: VIDEO_LANGS }, { ttl: DAY, fresh, notFound: "Filme não encontrado." }), imageConfig()]);
  const tr = ptTranslation(m);
  const fields = {
    tmdb_id: m.id, imdb_id: m.imdb_id ?? m.external_ids?.imdb_id ?? null,
    title: tr.title || m.title || m.original_title, original_title: m.original_title ?? null, description: m.overview || tr.overview || null,
    release_date: date(m.release_date), release_year: year(m.release_date), duration_minutes: m.runtime || null,
    poster_path: m.poster_path ?? null, backdrop_path: m.backdrop_path ?? null,
    poster_url: imgUrl(i, i.poster, m.poster_path), backdrop_url: imgUrl(i, i.backdrop, m.backdrop_path),
    vote_average: m.vote_average ?? null, vote_count: m.vote_count ?? null, popularity: m.popularity ?? null,
    tagline: m.tagline || tr.tagline || null, tmdb_status: m.status ?? null, language: m.original_language ?? null,
    country: m.production_countries?.[0]?.name ?? m.origin_country?.[0] ?? null,
    external_source: "tmdb", external_id: `movie:${m.id}`, tmdb_synced_at: new Date().toISOString(),
  };
  return { fields, genres: m.genres ?? [], body: m, images: i };
}

export async function seriesMeta(tmdbId: number, fresh: boolean) {
  const [s, i] = await Promise.all([tmdbGet(`/tv/${tmdbId}`, { language: LANG, append_to_response: TV_FULL, include_video_language: VIDEO_LANGS }, { ttl: DAY, fresh, notFound: "Série não encontrada." }), imageConfig()]);
  const tr = ptTranslation(s);
  const fields = {
    tmdb_id: s.id, imdb_id: s.external_ids?.imdb_id ?? null,
    title: tr.title || s.name || s.original_name, original_title: s.original_name ?? null, description: s.overview || tr.overview || null,
    first_air_date: date(s.first_air_date), release_year: year(s.first_air_date),
    poster_path: s.poster_path ?? null, backdrop_path: s.backdrop_path ?? null,
    poster_url: imgUrl(i, i.poster, s.poster_path), backdrop_url: imgUrl(i, i.backdrop, s.backdrop_path),
    vote_average: s.vote_average ?? null, vote_count: s.vote_count ?? null, popularity: s.popularity ?? null,
    tagline: s.tagline || tr.tagline || null, tmdb_status: s.status ?? null, language: s.original_language ?? null,
    country: s.origin_country?.[0] ?? null, number_of_seasons: s.number_of_seasons ?? null, number_of_episodes: s.number_of_episodes ?? null,
    external_source: "tmdb", external_id: `tv:${s.id}`, tmdb_synced_at: new Date().toISOString(),
  };
  return { fields, genres: s.genres ?? [], seasons: (s.seasons ?? []) as any[], images: i, body: s };
}

/* ---------------- server functions ---------------- */
export const tmdbStatus = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await assertStaff(context as Ctx);
    return { configured: !!process.env["TMDB_API_KEY"] };
  });

export const tmdbTestConnection = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await assertStaff(context as Ctx);
    try {
      const c = await tmdbGet("/configuration", {}, { ttl: DAY, fresh: true });
      return { ok: true as const, message: "Conectado", imageBase: c.images?.secure_base_url ?? null };
    } catch (e) {
      return { ok: false as const, message: e instanceof Error ? e.message : "Erro na conexão" };
    }
  });

export const tmdbSearch = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ kind: z.enum(["movie", "series"]), query: z.string().trim().min(1).max(200), year: z.string().regex(/^\d{4}$/).optional(), page: z.number().int().min(1).max(50).default(1) }).parse(d))
  .handler(({ data, context }) => wrap(async () => {
    const ctx = context as Ctx;
    await assertStaff(ctx);
    const isMovie = data.kind === "movie";
    const params = isMovie
      ? { query: data.query, language: LANG, page: data.page, include_adult: "false", primary_release_year: data.year }
      : { query: data.query, language: LANG, page: data.page, include_adult: "false", first_air_date_year: data.year };
    const [r, i] = await Promise.all([tmdbGet(isMovie ? "/search/movie" : "/search/tv", params, { ttl: 900 }), imageConfig()]);
    const results = ((r.results ?? []) as any[]).map((x) => ({
      tmdb_id: x.id as number,
      title: String(x.title ?? x.name ?? ""),
      original_title: (x.original_title ?? x.original_name ?? null) as string | null,
      year: year(x.release_date ?? x.first_air_date),
      rating: typeof x.vote_average === "number" ? x.vote_average : null,
      language: (x.original_language ?? null) as string | null,
      poster_url: imgUrl(i, "w342", x.poster_path),
    }));
    const ids = results.map((x) => x.tmdb_id);
    const existing: Record<number, string> = {};
    if (ids.length) {
      const { data: rows } = await ctx.supabase.from(isMovie ? "movies" : "series").select("id, tmdb_id").in("tmdb_id", ids);
      (rows ?? []).forEach((row: any) => (existing[row.tmdb_id] = row.id));
    }
    return { results, existing, totalPages: (r.total_pages ?? 1) as number };
  }));

/** Imports or refreshes a movie. Never touches playback, status, category, featured or ordering. */
export const tmdbImportMovie = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ tmdbId: z.number().int().positive(), update: z.boolean().default(false) }).parse(d))
  .handler(({ data, context }) => wrap(async () => {
    const ctx = context as Ctx;
    await assertStaff(ctx);
    const { fields, genres } = await movieMeta(data.tmdbId, data.update);
    const r = await ctx.supabase.rpc("import_tmdb_movie_metadata", { _patch: fields, _genre_ids: genres.map((g: any) => g.id) });
    if (r.error) throw new Error("Não foi possível salvar os metadados do filme.");
    if (r.data.outcome === "ambiguous") throw new Error("Correspondência ambígua com conteúdo existente. Confira o título e ano antes de importar.");
    return { id: r.data.id as string, created: r.data.outcome === "created", exists: r.data.outcome !== "created" && !data.update };
  }));

export const tmdbImportSeries = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ tmdbId: z.number().int().positive(), update: z.boolean().default(false) }).parse(d))
  .handler(({ data, context }) => wrap(async () => {
    const ctx = context as Ctx;
    await assertStaff(ctx);
    const { data: found } = await ctx.supabase.from("series").select("id").eq("tmdb_id", data.tmdbId).maybeSingle();
    if (found && !data.update) return { id: found.id as string, created: false, exists: true };
    const { fields, genres } = await seriesMeta(data.tmdbId, data.update);
    let id: string;
    if (found) {
      await applyCompletion(ctx, "series", found.id, await completionRow(ctx, "series", found.id), fields, genres);
      id = found.id;
    } else {
      const slug = await uniqueSlug(ctx, "series", fields.title, fields.release_year);
      const r = await ctx.supabase.from("series").insert({ ...fields, slug, status: "published" }).select("id").single();
      if (r.error) throw r.error;
      id = r.data.id;
    }
    await linkGenres(ctx, "series", id, genres);
    return { id, created: !found, exists: false };
  }));

const contentInput = z.object({ kind: z.enum(["movie", "series"]), id: z.string().uuid() });
const unidentified = "Não foi possível identificar este conteúdo no TMDB. Confira o título e o ano.";

async function completionRow(ctx: Ctx, kind: "movie" | "series", id: string) {
  const { data: row, error } = await ctx.supabase.from(kind === "movie" ? "movies" : "series").select("*").eq("id", id).maybeSingle();
  if (error) throw new Error("Não foi possível carregar este conteúdo.");
  if (!row) throw new Error("Conteúdo não encontrado.");
  return row;
}

export async function resolveCompletion(kind: "movie" | "series", row: any) {
  if (Number.isInteger(row.tmdb_id) && row.tmdb_id > 0) {
    try {
      await tmdbGet(`/${kind === "movie" ? "movie" : "tv"}/${row.tmdb_id}`, { language: LANG, append_to_response: "external_ids" }, { ttl: DAY, notFound: unidentified });
      return { tmdbId: row.tmdb_id as number, candidates: [] as MatchCandidate[] };
    } catch (e) {
      if (!(e instanceof TmdbError) || e.message !== unidentified) throw e;
      // Invalid registered identifiers are never used to apply unrelated metadata.
    }
  }
  const candidates = new Map<number, MatchCandidate>();
  const i = await imageConfig();
  const y = rowYear(row);
  const path = kind === "movie" ? "/search/movie" : "/search/tv";
  const add = (r: any) => { for (const x of (r.results ?? []).slice(0, 20)) if (!candidates.has(x.id)) candidates.set(x.id, { tmdb_id: x.id, kind, title: String(x.title ?? x.name ?? ""), original_title: x.original_title ?? x.original_name ?? null, year: year(x.release_date ?? x.first_air_date), poster_url: imgUrl(i, "w342", x.poster_path) }); };
  const queries = [...new Set(searchTitles(row).flatMap((t) => [t, simplifiedTitle(t)]).filter((t) => t.length > 1))].slice(0, 6);
  for (const query of queries) {
    const base = { query, language: LANG, page: 1, include_adult: "false" };
    // 1) Year-filtered search ("year" covers any release date of a movie, not only the primary one).
    const yearParam = y ? (kind === "movie" ? { year: y } : { first_air_date_year: y }) : {};
    const r = await tmdbGet(path, { ...base, ...yearParam }, { ttl: 900 });
    add(r);
    // 2) Registered year can differ from TMDB's (festival vs. local release): retry without year, scored later.
    if (y && !(r.results ?? []).length) add(await tmdbGet(path, base, { ttl: 900 }));
    if (reliableMatch(row, [...candidates.values()])) break;
  }
  const results = rankCandidates(row, [...candidates.values()]).slice(0, 12);
  return { tmdbId: reliableMatch(row, results), candidates: results };
}

export const tmdbResolveContent = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => contentInput.parse(d))
  .handler(({ data, context }) => wrap(async () => {
    const ctx = context as Ctx;
    await assertStaff(ctx);
    return resolveCompletion(data.kind, await completionRow(ctx, data.kind, data.id));
  }));

export async function applyCompletion(ctx: Ctx, kind: CompletionKind, id: string, current: any, fields: any, genres: any[] = []) {
  const patch: any = { ...missingMetadata(kind, current, fields), ...officialDates(kind, fields) };
  // Fixed genres only: no `_genres` payload, so the RPC never creates genres.
  const { data, error } = await ctx.supabase.rpc("complete_tmdb_metadata", {
    _kind: kind, _id: id, _patch: patch, _genre_ids: genres.map((g) => g.id).filter((id): id is number => Number.isInteger(id)),
  });
  if (error) {
    if (error.code === "23505") throw new Error("Este TMDB ID já está associado a outro conteúdo. Nenhum registro foi recriado ou mesclado.");
    throw new Error("Não foi possível salvar as informações. Tente novamente.");
  }
  return data as { filled: number; genres: number; genres_created: number; fields: Record<string, string | number | null> };
}
/** Official TMDB date + its year always win over a wrong registered year; absent/invalid dates are never sent. */
export function officialDates(kind: CompletionKind, fields: any) {
  const key = kind === "movie" ? "release_date" : kind === "series" ? "first_air_date" : null;
  const d = key ? fields[key] : null;
  return key && typeof d === "string" && /^\d{4}-\d{2}-\d{2}$/.test(d) ? { [key]: d, release_year: Number(d.slice(0, 4)) } : {};
}

/** Individual missing-field completion; never writes sources or internal provenance. */
export const tmdbRefresh = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => contentInput.extend({ tmdbId: z.number().int().positive().optional() }).parse(d))
  .handler(({ data, context }) => wrap(async () => {
    const ctx = context as Ctx;
    await assertStaff(ctx);
    const row = await completionRow(ctx, data.kind, data.id);
    // An explicit admin choice (candidate list or wider manual search) is validated by the details fetch below.
    const tmdbId = data.tmdbId ?? (await resolveCompletion(data.kind, row)).tmdbId;
    if (!tmdbId) throw new Error(unidentified);
    const meta = data.kind === "movie" ? await movieMeta(tmdbId, false) : await seriesMeta(tmdbId, false);
    const result = await applyCompletion(ctx, data.kind, data.id, row, meta.fields, meta.genres);
    // Credits, videos and extra fields: separate fill-only step; a failure here keeps the metadata above.
    const credits = mapCredits(meta.body, meta.images.base);
    const { videos, trailer } = mapVideos(meta.body);
    let extras: { filled: number; fields: Record<string, unknown>; credits: number; videos: number } | null = null;
    let extrasError: string | null = null;
    const ex = await ctx.supabase.rpc("apply_tmdb_extras", { _kind: data.kind, _id: data.id, _patch: extrasPatch(data.kind, meta.body), _credits: credits, _videos: videos });
    if (ex.error) extrasError = "Elenco e trailer não puderam ser salvos. Tente novamente."; else extras = ex.data;
    const castCount = credits.filter((c) => c.type === "cast").length;
    const empty = completionFields[data.kind].filter((k) => isMissing(row[k]) && !(k in result.fields) && !["poster_path", "backdrop_path"].includes(k));
    const dateConfirmed = Object.keys(officialDates(data.kind, meta.fields)).length > 0;
    return { ok: true, ...result, filledFields: [...Object.keys(result.fields ?? {}), ...Object.keys(extras?.fields ?? {})], empty, dateConfirmed, tmdbId,
      cast: extras ? castCount : 0, crew: extras ? credits.length - castCount : 0, videos: extras?.videos ?? 0, trailer: trailer ? trailer.name ?? "Trailer" : null, extrasError };
  }));

/** One existing season per request. No imports, removals or renumbering. */
export const tmdbCompleteSeasonEpisodes = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ seriesId: z.string().uuid(), seasonId: z.string().uuid() }).parse(d))
  .handler(({ data, context }) => wrap(async () => {
    const ctx = context as Ctx;
    await assertStaff(ctx);
    const series = await completionRow(ctx, "series", data.seriesId);
    if (!series.tmdb_id) throw new Error("Atualize as informações da série via TMDB primeiro.");
    const { data: season, error } = await ctx.supabase.from("seasons").select("*").eq("id", data.seasonId).eq("series_id", data.seriesId).maybeSingle();
    if (error || !season) throw new Error("Temporada não encontrada nesta série.");
    const [t, i] = await Promise.all([
      tmdbGet(`/tv/${series.tmdb_id}/season/${season.season_number}`, { language: LANG }, { ttl: DAY, notFound: "Temporada não encontrada no TMDB." }), imageConfig(),
    ]);
    const { data: episodes, error: episodeError } = await ctx.supabase.from("episodes").select("*").eq("season_id", season.id);
    if (episodeError) throw new Error("Não foi possível carregar os episódios.");
    const plans = (episodes ?? []).flatMap((episode: any) => {
      // Exact identity: series TMDB id + season number + episode number.
      const e = (t.episodes ?? []).find((x: any) => x.episode_number === episode.episode_number);
      if (!e) return [];
      return [{ episode, fields: { tmdb_id: e.id ?? null, title: e.name || null, description: e.overview || null, release_date: date(e.air_date), duration_minutes: e.runtime || null, vote_average: e.vote_average ?? null, vote_count: e.vote_count ?? null, still_path: e.still_path ?? null, thumbnail_url: imgUrl(i, i.still, e.still_path) } }];
    });
    const seasonResult = await applyCompletion(ctx, "season", season.id, season, { tmdb_id: t.id, title: t.name || null, description: t.overview || null, air_date: date(t.air_date), poster_url: imgUrl(i, i.poster, t.poster_path) });
    let filled = seasonResult.filled, updated = 0;
    const covers = { analyzed: (episodes ?? []).length, fixed: 0, valid: 0, notFound: (episodes ?? []).length - plans.length, failed: 0 };
    for (const plan of plans) {
      try {
        const r = await applyCompletion(ctx, "episode", plan.episode.id, plan.episode, plan.fields);
        filled += r.filled;
        if (r.filled) updated++;
        const fresh = isMissing(plan.episode.thumbnail_url) ? plan.fields.thumbnail_url : plan.episode.thumbnail_url;
        const d = coverDecision(fresh as string | null, plan.fields.still_path);
        if (d === "valid") covers.valid++;
        else if (d === "not_found") covers.notFound++;
        else {
          const { error: e2 } = await ctx.supabase.from("episodes").update({ thumbnail_url: plan.fields.thumbnail_url, still_path: plan.fields.still_path }).eq("id", plan.episode.id);
          if (e2) covers.failed++; else covers.fixed++;
        }
      } catch { covers.failed++; }
    }
    return { filled, updated, matched: plans.length, unmatched: (episodes ?? []).length - plans.length, covers };
  }));

/** Lists TMDB seasons of a series (including Specials / season 0) with "already imported" flags. */
export const tmdbListSeasons = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ seriesId: z.string().uuid() }).parse(d))
  .handler(({ data, context }) => wrap(async () => {
    const ctx = context as Ctx;
    await assertStaff(ctx);
    const { data: row } = await ctx.supabase.from("series").select("tmdb_id").eq("id", data.seriesId).maybeSingle();
    if (!row?.tmdb_id) throw new Error("Esta série não possui TMDB ID. Importe-a pelo TMDB primeiro.");
    const s = await tmdbGet(`/tv/${row.tmdb_id}`, { language: LANG, append_to_response: "external_ids" }, { ttl: DAY, notFound: "Série não encontrada." });
    const { data: have } = await ctx.supabase.from("seasons").select("season_number").eq("series_id", data.seriesId);
    const set = new Set((have ?? []).map((h: any) => h.season_number));
    return ((s.seasons ?? []) as any[]).map((x) => ({ season_number: x.season_number as number, name: String(x.name ?? ""), episode_count: (x.episode_count ?? 0) as number, air_date: x.air_date ?? null, special: x.season_number === 0, exists: set.has(x.season_number) }));
  }));

export const tmdbImportSeasons = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ seriesId: z.string().uuid(), seasonNumbers: z.array(z.number().int().min(0).max(500)).max(100) }).parse(d))
  .handler(({ data, context }) => wrap(async () => {
    const ctx = context as Ctx;
    await assertStaff(ctx);
    const { data: row } = await ctx.supabase.from("series").select("tmdb_id").eq("id", data.seriesId).maybeSingle();
    if (!row?.tmdb_id) throw new Error("Esta série não possui TMDB ID.");
    const [s, i] = await Promise.all([tmdbGet(`/tv/${row.tmdb_id}`, { language: LANG, append_to_response: "external_ids" }, { ttl: DAY, notFound: "Série não encontrada." }), imageConfig()]);
    const { data: have } = await ctx.supabase.from("seasons").select("id, season_number").eq("series_id", data.seriesId);
    const byNum = new Map((have ?? []).map((h: any) => [h.season_number, h.id]));
    const out: { season_number: number; id: string; created: boolean }[] = [];
    for (const n of data.seasonNumbers) {
      const t = ((s.seasons ?? []) as any[]).find((x) => x.season_number === n);
      if (!t) continue;
      const meta = { tmdb_id: t.id ?? null, air_date: date(t.air_date), description: t.overview || null, poster_url: imgUrl(i, i.poster, t.poster_path) };
      const existing = byNum.get(n) as string | undefined;
      if (existing) {
        await ctx.supabase.from("seasons").update({ tmdb_id: meta.tmdb_id, air_date: meta.air_date }).eq("id", existing);
        out.push({ season_number: n, id: existing, created: false });
      } else {
        const r = await ctx.supabase.from("seasons").insert({ ...meta, series_id: data.seriesId, season_number: n, title: n === 0 ? "Especiais" : t.name || null, status: "published", sort_order: n }).select("id").single();
        if (r.error) throw r.error;
        out.push({ season_number: n, id: r.data.id, created: true });
      }
    }
    return out;
  }));

/** Imports episodes of one season (metadata only — no players/sources). */
export const tmdbImportEpisodes = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ seasonId: z.string().uuid() }).parse(d))
  .handler(({ data, context }) => wrap(async () => {
    const ctx = context as Ctx;
    await assertStaff(ctx);
    const { data: season } = await ctx.supabase.from("seasons").select("season_number, series(tmdb_id)").eq("id", data.seasonId).maybeSingle();
    const tv = season?.series?.tmdb_id;
    if (!tv) throw new Error("A série desta temporada não possui TMDB ID.");
    const [t, i] = await Promise.all([tmdbGet(`/tv/${tv}/season/${season.season_number}`, { language: LANG }, { ttl: DAY, notFound: "Temporada não encontrada no TMDB." }), imageConfig()]);
    const { data: have } = await ctx.supabase.from("episodes").select("id, episode_number").eq("season_id", data.seasonId);
    const byNum = new Map((have ?? []).map((h: any) => [h.episode_number, h.id]));
    let created = 0, updated = 0;
    for (const e of (t.episodes ?? []) as any[]) {
      const meta = {
        tmdb_id: e.id ?? null, title: e.name || `Episódio ${e.episode_number}`, original_title: e.name || null,
        description: e.overview || null, release_date: date(e.air_date), duration_minutes: e.runtime || null,
        vote_average: e.vote_average ?? null, vote_count: e.vote_count ?? null, still_path: e.still_path ?? null,
        thumbnail_url: imgUrl(i, i.still, e.still_path),
      };
      const existing = byNum.get(e.episode_number) as string | undefined;
      if (existing) {
        const r = await ctx.supabase.from("episodes").update(meta).eq("id", existing);
        if (r.error) throw r.error;
        updated++;
      } else {
        const r = await ctx.supabase.from("episodes").insert({ ...meta, season_id: data.seasonId, episode_number: e.episode_number, status: "published" });
        if (r.error) throw r.error;
        created++;
      }
    }
    return { created, updated };
  }));
