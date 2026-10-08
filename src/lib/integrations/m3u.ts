/** Pure M3U / M3U Plus parsing and classification (shared by server sync and tests). */
export type M3uKind = "movie" | "episode" | "channel";
export type M3uEntry = {
  kind: M3uKind; name: string; title: string; group: string | null; logo: string | null; url: string;
  tvgId: string | null; tmdbId: number | null; year: number | null;
  series: string | null; season: number | null; episode: number | null; streamType: "hls" | "url";
};

export const norm = (s: string) => s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
export const slugify = (s: string) => norm(s).replace(/ /g, "-");

function attrs(line: string) {
  const out: Record<string, string> = {};
  for (const m of line.matchAll(/([a-zA-Z0-9_-]+)="([^"]*)"/g)) out[(m[1] ?? "").toLowerCase()] = m[2] ?? "";
  return out;
}

const SXE = /\bS(\d{1,2})\s*[.\-_ ]?\s*E(\d{1,3})\b|\b(\d{1,2})x(\d{1,3})\b|\bT(\d{1,2})\s*[.\-_ ]?\s*E(\d{1,3})\b/i;

export function classify(info: string, url: string): M3uEntry | null {
  if (!/^https?:\/\//i.test(url)) return null;
  const a = attrs(info);
  const comma = info.lastIndexOf('",') >= 0 ? info.slice(info.lastIndexOf('",') + 2) : info.slice(info.indexOf(",") + 1);
  const name = (a["tvg-name"] || comma || "").trim().slice(0, 300);
  if (!name) return null;
  const group = a["group-title"]?.trim() || null;
  const g = norm(group ?? "");
  const path = (url.split("?")[0] ?? "").toLowerCase();
  const sxe = name.match(SXE);
  const isSeriesUrl = /\/series\//.test(path);
  const isMovieUrl = /\/movies?\//.test(path);
  const isLiveUrl = /\/live\//.test(path) || /\.ts$/.test(path);
  const fileExt = /\.(mp4|mkv|avi|mov|webm)$/.test(path);
  const seriesGroup = /\b(serie|series|novela|novelas|anime|animes|tv shows?)\b/.test(g);
  const movieGroup = /\b(filme|filmes|movie|movies|vod|cinema)\b/.test(g);
  let kind: M3uKind;
  if (sxe && (isSeriesUrl || seriesGroup || fileExt || !isLiveUrl)) kind = "episode";
  else if (isSeriesUrl) kind = "episode";
  else if (isMovieUrl || (movieGroup && !isLiveUrl) || (fileExt && !seriesGroup)) kind = "movie";
  else kind = "channel";
  if (kind === "episode" && !sxe) return null; // series item without season/episode cannot be placed safely
  const yearM = name.match(/[([](19\d{2}|20\d{2})[)\]]/) ?? name.match(/\s-\s(19\d{2}|20\d{2})\b/);
  const year = yearM ? Number(yearM[1]) : null;
  const tmdbRaw = a["tmdb-id"] || a["tmdb"] || a["tvg-tmdb"] || "";
  const tmdbId = /^\d+$/.test(tmdbRaw) ? Number(tmdbRaw) : null;
  let title = name, series: string | null = null, season: number | null = null, episode: number | null = null;
  if (kind === "episode" && sxe) {
    season = Number(sxe[1] ?? sxe[3] ?? sxe[5]); episode = Number(sxe[2] ?? sxe[4] ?? sxe[6]);
    series = name.slice(0, sxe.index).replace(/[\s\-–|:.]+$/, "").replace(/[([](19|20)\d{2}[)\]]/, "").trim() || name;
    title = name.slice((sxe.index ?? 0) + sxe[0].length).replace(/^[\s\-–|:.]+/, "").trim() || `Episódio ${episode}`;
  } else if (kind === "movie") title = name.replace(/[([](19|20)\d{2}[)\]]/, "").replace(/\s-\s(19|20)\d{2}\b/, "").trim() || name;
  const logo = a["tvg-logo"] && /^https?:\/\//i.test(a["tvg-logo"]) ? a["tvg-logo"] : null;
  return { kind, name, title, group, logo, url, tvgId: a["tvg-id"]?.trim() || null, tmdbId, year, series, season, episode, streamType: /\.m3u8$/.test(path) ? "hls" : "url" };
}

/** Incremental line parser: feed lines, get entries. */
export function createParser() {
  let pending: string | null = null, header = false, plus = false;
  return {
    get isM3u() { return header; }, get isPlus() { return plus; },
    line(raw: string): M3uEntry | null | "skip" {
      const l = raw.trim();
      if (!l) return "skip";
      if (l.startsWith("#EXTM3U")) { header = true; if (/(url-tvg|x-tvg-url|tvg-)/i.test(l)) plus = true; return "skip"; }
      if (l.startsWith("#EXTINF")) { pending = l; if (/tvg-|group-title/i.test(l)) plus = true; return "skip"; }
      if (l.startsWith("#")) return "skip";
      if (!pending) return "skip";
      const e = classify(pending, l); pending = null; return e;
    },
  };
}

export function parseM3u(text: string) {
  const p = createParser(); const out: M3uEntry[] = [];
  for (const l of text.split(/\r?\n/)) { const e = p.line(l); if (e && e !== "skip") out.push(e); }
  return { entries: out, isM3u: p.isM3u, isPlus: p.isPlus };
}

/** Stable dedupe keys inside one list. */
export function entityKey(e: M3uEntry): string {
  if (e.kind === "episode") return `${seriesKey(e)}|s${e.season}e${e.episode}`;
  if (e.tmdbId) return `tmdb:${e.tmdbId}`;
  if (e.tvgId && e.kind === "channel") return `tvg:${e.tvgId.toLowerCase()}`;
  return `t:${norm(e.title)}${e.year ? `|${e.year}` : ""}`;
}
export const seriesKey = (e: M3uEntry) => `t:${norm(e.series ?? e.title)}`;

/** "FILMES | AÇÃO" -> "Ação"; "CANAIS | ESPORTES" -> "Esportes". */
export function categoryName(group: string | null): string | null {
  if (!group) return null;
  const parts = group.split(/[|:/»>]+/).map(s => s.trim()).filter(Boolean);
  const generic = /^(filmes?|movies?|vod|series?|séries?|canais|canal|channels?|tv|live|ao vivo)$/i;
  const pick = parts.filter(p => !generic.test(p)).pop() ?? parts[parts.length - 1];
  if (!pick) return null;
  const clean = pick.replace(/\s+/g, " ").slice(0, 60);
  return clean === clean.toUpperCase() ? clean.toLowerCase().replace(/(^|\s)\p{L}/gu, c => c.toUpperCase()) : clean;
}

/** Shows only host for a URL that may carry credentials. */
export function maskListUrl(u: string) {
  try { const x = new URL(u); return `${x.protocol}//${x.host}/••••`; } catch { return "URL inválida"; }
}

export function assertSafeListUrl(u: string) {
  let x: URL;
  try { x = new URL(u.trim()); } catch { throw new Error("URL inválida"); }
  if (!/^https?:$/.test(x.protocol)) throw new Error("Use uma URL http:// ou https://");
  const h = x.hostname.toLowerCase();
  if (h === "localhost" || h.endsWith(".local") || h.endsWith(".internal") || /^(127\.|10\.|192\.168\.|169\.254\.|0\.|172\.(1[6-9]|2\d|3[01])\.)/.test(h) || h === "[::1]") throw new Error("Endereço não permitido");
  return x;
}
