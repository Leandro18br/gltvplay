export type BugouSeries = { id: string; title: string; year: number | null; poster_url: string | null; category: string };

/** "1883 (2021)" -> { title: "1883", year: 2021 }. */
export function parseBugouName(nome: string): { title: string; year: number | null } {
  const s = nome.trim();
  const m = s.match(/^(.*?)\s*\((\d{4})\)\s*$/);
  if (m?.[1]?.trim() && m[2]) return { title: m[1].trim(), year: Number(m[2]) };
  return { title: s, year: null };
}

export type BugouEpisode = { id: string; season: number; episode: number; title: string; image: string | null; duration_minutes: number | null; embed_url: string };
export type BugouDetails = { id: string; title: string; year: number | null; plot: string | null; cover: string | null; seasons: { season: number; episodes: BugouEpisode[] }[] };

const https = (u: unknown) => typeof u === "string" && /^https?:\/\//.test(u) ? u.replace(/^http:\/\//, "https://") : null;

/** Provider-documented "Embed Free" player URL (no vtoken; never a direct video link). */
export function bugouEmbedUrl(episodeId: string, ext: string) {
  const e = /^[a-z0-9]{2,5}$/i.test(ext) ? ext : "mp4";
  return `https://cinema.bugoumods.com/player.php?type=vod_streams&id=${encodeURIComponent(episodeId)}&ext=${e}&embed=free`;
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
      eps.push({ id: eid, season, episode: n, title: String(e?.title || e?.info?.name || `Episódio ${n}`).trim().slice(0, 300), image: https(e?.info?.movie_image ?? e?.info?.cover_big), duration_minutes: secs > 0 ? Math.round(secs / 60) : null, embed_url: bugouEmbedUrl(eid, String(e?.container_extension ?? "mp4")) });
    }
    eps.sort((a, b) => a.episode - b.episode);
    if (eps.length) seasons.push({ season, episodes: eps });
  }
  seasons.sort((a, b) => a.season - b.season);
  return { id, title: String(info.title || name.title || "").trim(), year: Number(info.year) || name.year, plot: info.plot ? String(info.plot) : null, cover: https(info.cover), seasons };
}
