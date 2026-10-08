/** Pure helpers for configurable API integrations (shared by server, admin UI and tests). */
import { z } from "zod";

export const INTEGRATION_KINDS = { catalog: "API de Catálogo", movie_player: "API de Player", episode_player: "API de Player de Série" } as const;
export const AUTH_METHODS = { none: "Sem autenticação", query_key: "API Key na URL", header_key: "API Key no Header", bearer: "Bearer Token", custom_header: "Header personalizado" } as const;
export const ENDPOINT_KINDS = {
  search_movies: "Buscar filmes", search_series: "Buscar séries", movie_by_id: "Buscar filme por ID", series_by_id: "Buscar série por ID",
  movie_player: "Buscar player de filme", episode_player: "Buscar player de episódio", seasons: "Buscar temporadas", episodes: "Buscar episódios",
} as const;
export const CACHE_OPTIONS = [[0, "Sem cache"], [300, "5 minutos"], [900, "15 minutos"], [3600, "1 hora"], [21600, "6 horas"], [86400, "24 horas"], [604800, "7 dias"]] as const;
export const VARIABLES = ["tmdb_id", "imdb_id", "movie_id", "series_id", "series_tmdb_id", "episode_id", "episode_tmdb_id", "season", "episode", "title", "year", "query", "external_id"] as const;
export type Vars = Partial<Record<(typeof VARIABLES)[number], string>>;
export type CatalogField = "title" | "original_title" | "description" | "poster" | "backdrop" | "year" | "release_date" | "duration" | "rating" | "genres" | "external_id" | "tmdb_id" | "season_number" | "episode_number" | "thumbnail";
export type Mapping = {
  player_path?: string; player_type?: "auto" | "embed" | "hls" | "url";
  results_path?: string; image_base?: string; fields?: Partial<Record<CatalogField, string>>;
};
export const kvSchema = z.record(z.string().regex(/^[A-Za-z0-9_.\-[\]]{1,80}$/), z.string().max(1000)).refine(o => Object.keys(o).length <= 30, "Máximo 30 itens");

/** Replaces {var} placeholders. `encode` URL-encodes values for paths/queries. Throws on a missing variable. */
export function fillTemplate(tpl: string, vars: Vars, encode: (v: string) => string = v => v): string {
  return tpl.replace(/\{([a-z_]+)\}/g, (_m, name: string) => {
    const v = (vars as Record<string, string | undefined>)[name];
    if (v == null || v === "") throw new Error(`Variável {${name}} sem valor`);
    return encode(v);
  });
}

/** Reads a dotted path with array indexes, e.g. `data.player`, `results[0].url`. */
export function getPath(obj: unknown, path: string | undefined): unknown {
  if (!path?.trim()) return obj;
  let cur: unknown = obj;
  for (const part of path.trim().replace(/\[(\d+)\]/g, ".$1").split(".").filter(Boolean)) {
    if (cur == null || typeof cur !== "object") return undefined;
    cur = (cur as Record<string, unknown>)[part];
  }
  return cur;
}

const COMMON_PLAYER_KEYS = ["embed_url", "embedUrl", "player_url", "playerUrl", "player", "embed", "iframe", "url", "link", "src", "file", "stream", "data.player", "data.embed_url", "data.url", "result.url", "results[0].url", "sources[0].url"];

export type DetectedPlayer = { type: "embed" | "hls" | "url"; url: string };
/** Identifies a player from a raw API value. Never turns an iframe into a direct video. */
export function detectPlayer(value: unknown, forced: Mapping["player_type"] = "auto"): DetectedPlayer | null {
  if (typeof value !== "string") return null;
  let v = value.trim();
  let fromIframe = false;
  if (/^<iframe[\s>]/i.test(v)) { v = /\bsrc\s*=\s*["']?([^"'\s>]+)/i.exec(v)?.[1] ?? ""; fromIframe = true; }
  v = v.replace(/&amp;/g, "&");
  let u: URL;
  try { u = new URL(v); } catch { return null; }
  if (u.protocol !== "https:" || u.username || u.password) return null;
  const url = u.href;
  if (fromIframe) return { type: "embed", url };
  if (forced && forced !== "auto") return { type: forced, url };
  if (/\.m3u8$/i.test(u.pathname)) return { type: "hls", url };
  if (/\.(mp4|m4v|webm|ogv|mov)$/i.test(u.pathname)) return { type: "url", url };
  return { type: "embed", url };
}

/** Finds the player in a response using the configured path, or common keys as a fallback. */
export function extractPlayer(body: unknown, mapping: Mapping): DetectedPlayer | null {
  if (typeof body === "string") return detectPlayer(body, mapping.player_type);
  if (mapping.player_path?.trim()) return detectPlayer(getPath(body, mapping.player_path), mapping.player_type);
  for (const k of COMMON_PLAYER_KEYS) { const p = detectPlayer(getPath(body, k), mapping.player_type); if (p) return p; }
  return null;
}

export type CatalogItem = {
  external_id: string; tmdb_id: string | null; title: string; original_title: string | null; description: string | null;
  poster_url: string | null; backdrop_url: string | null; release_year: number | null; duration_minutes: number | null;
  rating: number | null; genres: string[]; season_number: number | null; episode_number: number | null; thumbnail_url: string | null;
};
const str = (v: unknown) => (v == null || v === "" ? null : typeof v === "object" ? null : String(v));
const num = (v: unknown) => { const n = Number(v); return v == null || v === "" || !isFinite(n) ? null : n; };
const img = (v: unknown, base?: string) => { const s = str(v); if (!s) return null; if (/^https:\/\//.test(s)) return s; return base && /^https:\/\//.test(base) ? base.replace(/\/$/, "") + "/" + s.replace(/^\//, "") : null; };

/** Normalizes a catalog response into items using results_path + field paths. */
export function mapCatalog(body: unknown, mapping: Mapping): CatalogItem[] {
  const root = getPath(body, mapping.results_path);
  const list = Array.isArray(root) ? root : root && typeof root === "object" ? [root] : [];
  const f = { title: "title", original_title: "original_title", description: "overview", poster: "poster_path", backdrop: "backdrop_path", year: "", release_date: "release_date", duration: "runtime", rating: "vote_average", genres: "genres", external_id: "id", tmdb_id: "", season_number: "season_number", episode_number: "episode_number", thumbnail: "still_path", ...mapping.fields };
  return list.slice(0, 50).flatMap((r): CatalogItem[] => {
    const title = str(getPath(r, f.title)) ?? str(getPath(r, "name"));
    const ext = str(getPath(r, f.external_id));
    if (!title && num(getPath(r, f.episode_number)) == null && num(getPath(r, f.season_number)) == null) return [];
    const date = str(getPath(r, f.release_date)) ?? str(getPath(r, "first_air_date")) ?? str(getPath(r, "air_date"));
    const year = num(f.year ? getPath(r, f.year) : null) ?? (date && /^\d{4}/.test(date) ? Number(date.slice(0, 4)) : null);
    const g = getPath(r, f.genres);
    return [{
      external_id: ext ?? title ?? "", tmdb_id: f.tmdb_id ? str(getPath(r, f.tmdb_id)) : null,
      title: (title ?? "").slice(0, 200), original_title: str(getPath(r, f.original_title)) ?? str(getPath(r, "original_name")),
      description: str(getPath(r, f.description))?.slice(0, 5000) ?? null,
      poster_url: img(getPath(r, f.poster), mapping.image_base), backdrop_url: img(getPath(r, f.backdrop), mapping.image_base),
      release_year: year && year > 1800 && year < 2200 ? year : null,
      duration_minutes: num(getPath(r, f.duration)), rating: num(getPath(r, f.rating)),
      genres: Array.isArray(g) ? g.map(x => (typeof x === "object" && x ? str((x as Record<string, unknown>).name) : str(x))).filter((x): x is string => !!x).slice(0, 10) : [],
      season_number: num(getPath(r, f.season_number)), episode_number: num(getPath(r, f.episode_number)),
      thumbnail_url: img(getPath(r, f.thumbnail), mapping.image_base),
    }];
  });
}

/** Blocks hosts that would turn the server into a proxy to internal networks. */
export function isBlockedHost(host: string): boolean {
  const h = host.toLowerCase().replace(/^\[|\]$/g, "");
  if (!h.includes(".") || /(^|\.)(localhost|local|internal|intranet|lan|home|corp)$/.test(h)) return true;
  if (/^[\d.]+$/.test(h)) return true; // literal IPv4
  if (h.includes(":")) return true; // literal IPv6
  if (/metadata|169\.254/.test(h)) return true;
  return false;
}

/** Builds the final request URL, guaranteeing it stays on the integration's base host. */
export function buildUrl(baseUrl: string, path: string, vars: Vars, query: Record<string, string>): URL {
  const base = new URL(baseUrl);
  if (base.protocol !== "https:" || base.username || base.password || isBlockedHost(base.hostname)) throw new Error("URL base inválida ou bloqueada");
  const filled = fillTemplate(path, vars, encodeURIComponent);
  if (/^[a-z]+:|^\/\//i.test(filled) || filled.includes("..")) throw new Error("Caminho inválido");
  const url = new URL(base.href.replace(/\/$/, "") + (filled && !filled.startsWith("/") && !filled.startsWith("?") ? "/" : "") + filled);
  if (url.host !== base.host || url.protocol !== "https:") throw new Error("O endpoint precisa usar o mesmo domínio da URL base");
  for (const [k, v] of Object.entries(query)) url.searchParams.set(k, fillTemplate(v, vars));
  return url;
}

export function httpErrorLabel(status: number | null, error?: string | null): string {
  if (status == null) return error || "Erro de conexão";
  const m: Record<number, string> = { 400: "HTTP 400 · Requisição inválida", 401: "HTTP 401 · Não autorizado (verifique a chave)", 403: "HTTP 403 · Acesso proibido", 404: "HTTP 404 · Não encontrado", 429: "HTTP 429 · Muitas requisições", 500: "HTTP 500 · Erro no servidor da API" };
  return m[status] ?? (status >= 200 && status < 300 ? `HTTP ${status}` : `HTTP ${status} · Erro`);
}

export const maskSecret = (v: string) => (v.length <= 4 ? "****" : "************" + v.slice(-4));
