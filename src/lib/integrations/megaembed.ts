export const MEGAEMBED_PLAYERS = { megaplay: "MegaPlay", megatube: "MegaTube", vidstack: "Vidstack", clappr: "Clappr" } as const;
export type MegaEmbedPlayer = keyof typeof MEGAEMBED_PLAYERS;

export type MegaEmbedConfig = {
  movieTemplate: string;
  episodeTemplate: string;
  player?: string | null;
  color?: string | null;
};

export type MegaEmbedTarget =
  | { kind: "movie"; tmdbId: number }
  | { kind: "episode"; tmdbSeriesId: number; season: number; episode: number };

/** Builds the MegaEmbed embed URL: template vars → ?player= → #color (player always before the hash). */
export function buildMegaEmbedUrl(cfg: MegaEmbedConfig, t: MegaEmbedTarget): string {
  const fill = (tpl: string, vars: Record<string, number>) =>
    tpl.replace(/\{(\w+)\}/g, (m, k: string) => {
      const key = k.toLowerCase();
      const v = vars[key];
      if (v === undefined) return m;
      if (!Number.isInteger(v) || v < 0) throw new Error("Identificador inválido");
      return String(v);
    });
  const url = t.kind === "movie"
    ? fill(cfg.movieTemplate, { tmdb_id: t.tmdbId, movie_id: t.tmdbId })
    : fill(cfg.episodeTemplate, { tmdb_id: t.tmdbSeriesId, tmdb_series_id: t.tmdbSeriesId, series_id: t.tmdbSeriesId, season: t.season, episode: t.episode });
  if (/\{\w+\}/.test(url)) throw new Error("Modelo de URL com variável desconhecida");
  const u = new URL(url);
  if (u.protocol !== "https:") throw new Error("A URL do MegaEmbed precisa ser https");
  u.hash = "";
  if (cfg.player && cfg.player in MEGAEMBED_PLAYERS) u.searchParams.set("player", cfg.player);
  let out = u.toString();
  const color = cfg.color?.trim();
  if (color && /^#[0-9A-Fa-f]{3,8}$/.test(color)) out += `#${color.slice(1)}`;
  return out;
}
