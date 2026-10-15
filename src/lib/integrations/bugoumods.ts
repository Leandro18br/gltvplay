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

export type BugouEpisode = { id: string; season: number; episode: number; title: string; image: string | null; duration_minutes: number | null; embed_url: string; ext: string };
export type BugouDetails = { id: string; title: string; year: number | null; plot: string | null; cover: string | null; seasons: { season: number; episodes: BugouEpisode[] }[] };

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

export type BugouMovieDetails = { id: string; title: string; year: number | null; plot: string | null; cover: string | null; ext: string; genres: string[]; providerMetadataPaths: string[] };

/** Return only JSON key paths for metadata audit; never return tokens or arbitrary field values. */
export function findBugouMetadataPaths(value: unknown, path = "", depth = 0): string[] {
  if (!value || typeof value !== "object" || depth > 5) return [];
  const targets = new Set(["plot", "description", "overview", "genre", "genres", "genre_name", "genre_names", "genre_ids"]);
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
      visit(row.name ?? row.genre_name ?? row.genre ?? row.label ?? row.title);
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
  const plotValue = info?.plot ?? info?.description ?? info?.overview ?? data?.plot ?? data?.description ?? data?.overview ?? j?.plot;
  const genreValues = [
    info?.genre, info?.genres, info?.genre_name, info?.genre_names, info?.genre_ids,
    data?.genre, data?.genres, data?.genre_name, data?.genre_names, data?.genre_ids,
    j?.genre, j?.genres, j?.genre_ids,
  ];
  const genres = parseBugouGenreNames(...genreValues);
  const providerMetadataPaths = findBugouMetadataPaths(j);
  const cover = https(coverValue);
  const yearValue = Number(info?.year ?? data?.year) || name.year;
  return {
    id: String(data?.stream_id ?? data?.id ?? j?.id ?? id),
    title: String(info?.title ?? data?.title ?? name.title ?? data?.name ?? info?.name ?? "").trim(),
    year: yearValue || null,
    plot: typeof plotValue === "string" && plotValue.trim() ? plotValue.trim() : null,
    cover,
    ext,
    genres,
    providerMetadataPaths,
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
      eps.push({ id: eid, season, episode: n, title: String(e?.title || e?.info?.name || `Episódio ${n}`).trim().slice(0, 300), image: https(e?.info?.movie_image ?? e?.info?.cover_big), duration_minutes: secs > 0 ? Math.round(secs / 60) : null, embed_url: bugouEmbedUrl(eid, String(e?.container_extension ?? "mp4")), ext: String(e?.container_extension ?? "mp4") });
    }
    eps.sort((a, b) => a.episode - b.episode);
    if (eps.length) seasons.push({ season, episodes: eps });
  }
  seasons.sort((a, b) => a.season - b.season);
  return { id, title: String(info.title || name.title || "").trim(), year: Number(info.year) || name.year, plot: info.plot ? String(info.plot) : null, cover: https(info.cover), seasons };
}
