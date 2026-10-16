export type BugouSeries = { id: string; title: string; year: number | null; poster_url: string | null; category: string };

/** Search key: no accents, lowercase, punctuation -> space, collapsed spaces. "#blackAF: Série" -> "blackaf serie". */
export function normTitle(s: string): string {
  return s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}
export const compactTitle = (s: string) => normTitle(s).replace(/ /g, "");

/** "1883 (2021)" -> { title: "1883", year: 2021 }. */
export function parseBugouName(nome: string): { title: string; year: number | null } {
  const s = nome.trim();
  const m = s.match(/^(.*?)\s*\((\d{4})\)\s*$/);
  if (m?.[1]?.trim() && m[2]) return { title: m[1].trim(), year: Number(m[2]) };
  return { title: s, year: null };
}

export type BugouEpisode = { id: string; season: number; episode: number; title: string; image: string | null; duration_minutes: number | null; embed_url: string; ext: string; plot?: string | null; release_date?: string | null; rating?: number | null; tmdb_id?: number | null };
export type BugouSeasonMeta = { season: number; overview: string | null; air_date: string | null; cover: string | null; tmdb_id: number | null };
export type BugouDetails = {
  id: string; title: string; year: number | null; plot: string | null; cover: string | null;
  seasons: { season: number; episodes: BugouEpisode[] }[];
  backdrop?: string | null; releaseDate?: string | null; rating?: number | null; trailer?: string | null;
  genres?: string[]; durationMinutes?: number | null; seasonMeta?: BugouSeasonMeta[];
};

const isoDate = (v: unknown) => typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v.trim()) ? v.trim() : null;
const posNum = (v: unknown) => { const n = Number(v); return Number.isFinite(n) && n > 0 ? n : null; };
const text = (v: unknown, max = 5000) => typeof v === "string" && v.trim() && !/^(n\/a|none|null|sem sinopse dispon[ií]vel\.?)$/i.test(v.trim()) ? v.trim().slice(0, max) : null;
/** Provider rating is 0-10; "0" means unrated. */
const rating10 = (v: unknown) => { const n = posNum(v); return n && n <= 10 ? Math.round(n * 10) / 10 : null; };
/** YouTube id or URL -> watch URL. */
export function bugouTrailer(v: unknown): string | null {
  const s = typeof v === "string" ? v.trim() : "";
  if (/^[A-Za-z0-9_-]{11}$/.test(s)) return `https://www.youtube.com/watch?v=${s}`;
  return /^https:\/\/(www\.)?(youtube\.com|youtu\.be)\//i.test(s) ? s : null;
}
/** backdrop_path arrives as an array, a URL, or a Python-style "['https://…']" string. */
export function bugouBackdrop(v: unknown): string | null {
  const first = Array.isArray(v) ? v[0] : typeof v === "string" ? (v.match(/https?:\/\/[^'"\s\],]+/)?.[0] ?? null) : null;
  return typeof first === "string" && /^https?:\/\//.test(first) ? first.replace(/^http:\/\//, "https://") : null;
}

/** Provider genre labels (TMDB pt-BR or English names) -> slugs of the system's existing genres. Never invents genres. */
const GENRE_ALIASES: Record<string, string[]> = {
  "acao": ["acao"], "action": ["acao"], "aventura": ["aventura"], "adventure": ["aventura"],
  "action adventure": ["acao", "aventura"], "acao e aventura": ["acao", "aventura"], "acao aventura": ["acao", "aventura"],
  "animacao": ["animacao"], "animation": ["animacao"], "comedia": ["comedia"], "comedy": ["comedia"], "crime": ["crime"],
  "documentario": ["documentario"], "documentary": ["documentario"], "drama": ["drama"], "familia": ["familia"], "family": ["familia"],
  "fantasia": ["fantasia"], "fantasy": ["fantasia"], "faroeste": ["faroeste"], "western": ["faroeste"],
  "ficcao cientifica": ["ficcao-cientifica"], "science fiction": ["ficcao-cientifica"], "sci fi": ["ficcao-cientifica"],
  "sci fi fantasy": ["ficcao-cientifica", "fantasia"], "ficcao cientifica e fantasia": ["ficcao-cientifica", "fantasia"],
  "guerra": ["guerra"], "war": ["guerra"], "war politics": ["guerra"], "guerra e politica": ["guerra"],
  "historia": ["historia"], "history": ["historia"], "misterio": ["misterio"], "mystery": ["misterio"],
  "musica": ["musica"], "music": ["musica"], "romance": ["romance"], "terror": ["terror"], "horror": ["terror"],
  "thriller": ["thriller-suspense"], "suspense": ["thriller-suspense"], "thriller suspense": ["thriller-suspense"],
  "cinema tv": ["cinema-tv"], "tv movie": ["cinema-tv"], "kids": ["infantil"], "infantil": ["infantil"],
};
export function mapBugouGenreSlugs(names: string[]): string[] {
  const out = new Set<string>();
  for (const n of names) for (const slug of GENRE_ALIASES[normTitle(n)] ?? []) out.add(slug);
  return [...out];
}

const https = (u: unknown) => typeof u === "string" && /^https?:\/\//.test(u) ? u.replace(/^http:\/\//, "https://") : null;

/** Provider "Embed Free" player URL (tokenless; shown in admin previews only, never stored). */
export function bugouEmbedUrl(episodeId: string, ext: string) {
  const e = /^[a-z0-9]{2,5}$/i.test(ext) ? ext : "mp4";
  return `https://cinema.bugoumods.com/player.php?type=vod_streams&id=${encodeURIComponent(episodeId)}&ext=${e}&embed=free`;
}

/** Provider "Embed VIP" player URL, same format the provider's own "Embed VIP" button generates. Server-side only. */
export function bugouVipEmbedUrl(episodeId: string, ext: string, vtoken: string) {
  const e = /^[a-z0-9]{2,5}$/i.test(ext) ? ext : "mp4";
  return `https://cinema.bugoumods.com/player.php?type=vod_streams&id=${encodeURIComponent(episodeId)}&ext=${e}&vtoken=${encodeURIComponent(vtoken)}&embed=vip`;
}

export type BugouMovieDetails = {
  id: string; title: string; originalTitle: string | null; year: number | null;
  plot: string | null; cover: string | null; backdrop: string | null;
  releaseDate: string | null; durationMinutes: number | null; ageRating: string | null;
  quality: string | null; language: string | null; country: string | null;
  ext: string; genres: string[]; providerMetadataPaths: string[];
  tmdbId?: number | null; rating?: number | null; trailer?: string | null;
};

/** Return only JSON key paths for metadata audit; never return tokens or arbitrary field values. */
export function findBugouMetadataPaths(value: unknown, path = "", depth = 0): string[] {
  if (!value || typeof value !== "object" || depth > 5) return [];
  const targets = new Set(["plot", "description", "overview", "genre", "genres", "genre_name", "genre_names", "genre_ids", "movie_image", "cover_big", "backdrop_path", "releasedate", "release_date", "duration", "duration_secs", "duration_seconds", "mpaa_rating", "age_rating", "language", "country", "director", "cast", "original_title", "container_extension"]);
  const found: string[] = [];
  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    const next = path ? path + "." + key : key;
    if (targets.has(key.toLowerCase()) && child != null && child !== "") found.push(next);
    if (child && typeof child === "object") found.push(...findBugouMetadataPaths(child, next, depth + 1));
    if (found.length >= 30) break;
  }
  return [...new Set(found)].slice(0, 30);
}

/** Read genre labels only from the provider payload; numeric-only IDs cannot safely be resolved to names. */
export function parseBugouGenreNames(...values: unknown[]): string[] {
  const names: string[] = [];
  const visit = (value: unknown) => {
    if (typeof value === "string") {
      value.split(/[,;|]/).map((part) => part.trim()).filter(Boolean).forEach((part) => names.push(part));
      return;
    }
    if (Array.isArray(value)) {
      value.forEach(visit);
      return;
    }
    if (value && typeof value === "object") {
      const row = value as Record<string, unknown>;
      // Xtream-like providers may use {name}, {genre_name}, or {genre}; don't infer a name from a numeric ID.
      visit(row["name"] ?? row["genre_name"] ?? row["genre"] ?? row["label"] ?? row["title"]);
    }
  };
  values.forEach(visit);
  const unique = new Map<string, string>();
  for (const raw of names) {
    const name = raw.replace(/\\s+/g, " ").trim().slice(0, 80);
    const key = normTitle(name);
    if (key && !/^\d+$/.test(name) && !unique.has(key)) unique.set(key, name);
  }
  return [...unique.values()].slice(0, 30);
}

/** Normalizes the provider's VOD detail response while tolerating its common wrapper shapes. */
export function parseBugouMovieDetails(id: string, j: any): BugouMovieDetails {
  const data = j?.movie_data ?? j?.data?.movie_data ?? j?.data ?? j?.result ?? j ?? {};
  const info = j?.info ?? data?.info ?? data;
  const name = parseBugouName(String(info?.name ?? info?.title ?? data?.name ?? data?.title ?? ""));
  const rawExt = String(data?.container_extension ?? info?.container_extension ?? j?.container_extension ?? data?.ext ?? info?.ext ?? "mp4").trim().replace(/^\\./, "");
  const ext = /^[a-z0-9]{2,5}$/i.test(rawExt) ? rawExt : "mp4";
  const coverValue = info?.movie_image ?? info?.cover_big ?? info?.cover ?? data?.stream_icon ?? data?.cover ?? data?.poster ?? j?.cover;
  const backdropValue = info?.backdrop_path ?? info?.backdrop ?? info?.background ?? data?.backdrop_path ?? data?.backdrop ?? data?.background ?? j?.backdrop_path;
  const plotValue = info?.plot ?? info?.description ?? info?.overview ?? data?.plot ?? data?.description ?? data?.overview ?? j?.plot;
  const genreValues = [
    info?.genre, info?.genres, info?.genre_name, info?.genre_names, info?.genre_ids,
    data?.genre, data?.genres, data?.genre_name, data?.genre_names, data?.genre_ids,
    j?.genre, j?.genres, j?.genre_ids,
  ];
  const genres = parseBugouGenreNames(...genreValues);
  const providerMetadataPaths = findBugouMetadataPaths(j);
  const cover = https(coverValue);
  const backdropRaw = Array.isArray(backdropValue) ? backdropValue.find((x: unknown) => typeof x === "string" && /^https?:\/\//i.test(x as string)) : backdropValue;
  const backdrop = https(typeof backdropRaw === "object" && backdropRaw ? (backdropRaw as any).url ?? (backdropRaw as any).file_path : backdropRaw);
  const yearValue = Number(info?.year ?? data?.year) || name.year;
  const releaseDateRaw = info?.releasedate ?? info?.release_date ?? data?.releasedate ?? data?.release_date ?? j?.releasedate ?? j?.release_date;
  const releaseDate = typeof releaseDateRaw === "string" && /^\d{4}-\d{2}-\d{2}$/.test(releaseDateRaw.trim()) ? releaseDateRaw.trim() : null;
  const durationRaw = Number(info?.duration_secs ?? info?.duration_seconds ?? data?.duration_secs ?? data?.duration_seconds);
  const durationText = String(info?.duration ?? data?.duration ?? "").trim();
  const durationClock = durationText.match(/^(?:(\d{1,3}):)?(\d{1,2}):(\d{2})$/);
  const durationMinutes = Number.isFinite(durationRaw) && durationRaw > 0
    ? Math.round(durationRaw / 60)
    : durationClock ? Number(durationClock[1] ?? 0) * 60 + Number(durationClock[2]) + Math.floor(Number(durationClock[3]) / 60) : null;
  const textValue = (...values: unknown[]) => {
    const value = values.find((x) => typeof x === "string" && x.trim());
    return typeof value === "string" ? value.trim().slice(0, 200) : null;
  };
  const originalTitle = textValue(info?.original_title, info?.o_name, data?.original_title, j?.original_title);
  const ageRating = textValue(info?.age_rating, info?.mpaa_rating, info?.certification, data?.age_rating, data?.mpaa_rating, data?.certification);
  const quality = textValue(info?.quality, data?.quality, j?.quality);
  const language = textValue(info?.language, info?.audio_language, data?.language, data?.audio_language, j?.language);
  const country = textValue(info?.country, info?.country_name, data?.country, data?.country_name, j?.country);
  return {
    id: String(data?.stream_id ?? data?.id ?? j?.id ?? id),
    title: String(info?.title ?? data?.title ?? name.title ?? data?.name ?? info?.name ?? "").trim(),
    originalTitle,
    year: yearValue || null,
    plot: typeof plotValue === "string" && plotValue.trim() ? plotValue.trim() : null,
    cover,
    backdrop,
    releaseDate,
    durationMinutes: durationMinutes && durationMinutes > 0 ? Math.round(durationMinutes) : null,
    ageRating,
    quality,
    language,
    country,
    ext,
    genres,
    providerMetadataPaths,
    tmdbId: posNum(info?.tmdb_id ?? data?.tmdb_id) ? Math.trunc(Number(info?.tmdb_id ?? data?.tmdb_id)) : null,
    rating: rating10(info?.rating ?? data?.rating),
    trailer: bugouTrailer(info?.youtube_trailer ?? data?.youtube_trailer),
  };
}

/** Parses index.php?ajax=1&type=series_info JSON; drops anything without a numeric id/number. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function parseBugouDetails(id: string, j: any): BugouDetails {
  const info = j?.info ?? {};
  const name = parseBugouName(String(info.name ?? info.title ?? ""));
  const seasons: BugouDetails["seasons"] = [];
  for (const [sk, list] of Object.entries(j?.episodes ?? {})) {
    const season = Number(sk);
    if (!Number.isInteger(season) || season < 0 || !Array.isArray(list)) continue;
    const eps: BugouEpisode[] = [];
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    for (const e of list as any[]) {
      const eid = String(e?.id ?? ""); const n = Number(e?.episode_num);
      if (!/^\d+$/.test(eid) || !Number.isInteger(n) || n < 1 || eps.some(x => x.episode === n)) continue;
      const secs = Number(e?.info?.duration_secs);
      const ei = e?.info ?? {};
      eps.push({ id: eid, season, episode: n, title: String(e?.title || ei?.name || `Episódio ${n}`).trim().slice(0, 300), image: https(ei?.movie_image ?? ei?.cover_big), duration_minutes: secs > 0 ? Math.round(secs / 60) : null, embed_url: bugouEmbedUrl(eid, String(e?.container_extension ?? "mp4")), ext: String(e?.container_extension ?? "mp4"),
        plot: text(ei?.plot ?? ei?.description), release_date: isoDate(ei?.release_date ?? ei?.releasedate), rating: rating10(ei?.rating), tmdb_id: posNum(ei?.tmdb_id) ? Math.trunc(Number(ei.tmdb_id)) : null });
    }
    eps.sort((a, b) => a.episode - b.episode);
    if (eps.length) seasons.push({ season, episodes: eps });
  }
  seasons.sort((a, b) => a.season - b.season);
  const seasonMeta: BugouSeasonMeta[] = (Array.isArray(j?.seasons) ? j.seasons : []).map((x: any) => ({
    season: Number(x?.season_number), overview: text(x?.overview), air_date: isoDate(x?.air_date), cover: https(x?.cover_big ?? x?.cover), tmdb_id: posNum(x?.id) ? Math.trunc(Number(x.id)) : null,
  })).filter((x: BugouSeasonMeta) => Number.isInteger(x.season) && x.season >= 0);
  const runTime = posNum(info.episode_run_time);
  return {
    id, title: String(info.title || name.title || "").trim(), year: Number(info.year) || name.year,
    plot: text(info.plot ?? info.description), cover: https(info.cover), seasons,
    backdrop: bugouBackdrop(info.backdrop_path), releaseDate: isoDate(info.release_date ?? info.releaseDate),
    rating: rating10(info.rating), trailer: bugouTrailer(info.youtube_trailer),
    genres: parseBugouGenreNames(info.genre, info.genres), durationMinutes: runTime ? Math.round(runTime) : null, seasonMeta,
  };
}
