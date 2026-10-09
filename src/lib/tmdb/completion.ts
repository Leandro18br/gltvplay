/** Deliberately excludes provenance, playback, publication and hierarchy fields. */
export const completionFields = {
  movie: ["tmdb_id", "imdb_id", "title", "original_title", "description", "release_date", "release_year", "duration_minutes", "poster_url", "backdrop_url", "poster_path", "backdrop_path", "vote_average", "vote_count", "popularity", "tagline", "tmdb_status", "language", "country"],
  series: ["tmdb_id", "imdb_id", "title", "original_title", "description", "first_air_date", "release_year", "poster_url", "backdrop_url", "poster_path", "backdrop_path", "vote_average", "vote_count", "popularity", "tagline", "tmdb_status", "language", "country", "number_of_seasons", "number_of_episodes"],
  season: ["tmdb_id", "title", "description", "air_date", "poster_url"],
  episode: ["tmdb_id", "title", "original_title", "description", "release_date", "duration_minutes", "vote_average", "vote_count", "still_path", "thumbnail_url"],
} as const;

export type CompletionKind = keyof typeof completionFields;
export type MetadataRow = Record<string, unknown>;
export const isMissing = (value: unknown) => value == null || (typeof value === "string" && !value.trim());

export function missingMetadata(kind: CompletionKind, current: MetadataRow, incoming: MetadataRow): MetadataRow {
  const patch: MetadataRow = {};
  for (const key of completionFields[kind]) {
    const value = incoming[key];
    const empty = isMissing(current[key]) || (["tmdb_id", "release_year", "duration_minutes", "number_of_seasons", "number_of_episodes"].includes(key) && current[key] === 0);
    if (!empty || isMissing(value)) continue;
    if (typeof value === "number" && (!Number.isFinite(value) || value < 0)) continue;
    if (["tmdb_id", "release_year", "duration_minutes"].includes(key) && value === 0) continue;
    // Do not associate a TMDB image path with an existing custom image.
    if (key === "poster_path" && !isMissing(current["poster_url"])) continue;
    if (key === "backdrop_path" && !isMissing(current["backdrop_url"])) continue;
    if (key === "still_path" && !isMissing(current["thumbnail_url"])) continue;
    patch[key] = value;
  }
  return patch;
}

export function normalizeTitle(title: string) {
  return title.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

export function searchTitles(row: MetadataRow): string[] {
  return [...new Set([row["original_title"], row["title"]].filter((x): x is string => typeof x === "string" && !!x.trim()).flatMap((title) => {
    const clean = title.replace(/\[(?:[^\]]+)\]/g, " ").replace(/\b(?:4k|1080p|720p|480p|2160p|fhd|uhd|hd|dublado|legendado)\b/gi, " ").replace(/\(\d{4}\)/g, " ").replace(/\s+/g, " ").trim();
    return [clean, title.trim()];
  }))].slice(0, 4);
}

export type MatchCandidate = { tmdb_id: number; title: string; original_title: string | null; year: number | null; poster_url: string | null; kind?: "movie" | "series" };
export function reliableMatch(row: MetadataRow, candidates: MatchCandidate[]): number | null {
  const titles = searchTitles(row).map(normalizeTitle);
  const y = rowYear(row);
  // Only one exact title + exact year match is accepted automatically; remakes/similar names go to manual choice.
  const matches = candidates.filter((c) => [c.title, c.original_title].some((t) => t && titles.includes(normalizeTitle(t))) && y != null && c.year === y);
  return matches.length === 1 ? matches[0]?.tmdb_id ?? null : null;
}
/** Year written inside an M3U-style title, e.g. "Filme (2008)". */
export function titleYear(row: MetadataRow): number | null {
  for (const t of [row["title"], row["original_title"]]) {
    const m = typeof t === "string" ? t.match(/\((19\d{2}|20\d{2})\)/) : null;
    if (m) return Number(m[1]);
  }
  return null;
}
export const rowYear = (row: MetadataRow) => (typeof row["release_year"] === "number" && row["release_year"] > 0 ? (row["release_year"] as number) : titleYear(row));

/** Punctuation-free variant ("Missão: Impossível – Acerto" → "Missão Impossível Acerto"). */
export function simplifiedTitle(title: string) {
  return title.replace(/[^\p{L}\p{N}\s]/gu, " ").replace(/\s+/g, " ").trim();
}

/** Confidence: exact title (registered/original/translated) + exact year = 100. */
export function matchScore(row: MetadataRow, c: MatchCandidate): number {
  const titles = searchTitles(row).map(normalizeTitle);
  const exact = [c.title, c.original_title].some((t) => t && titles.includes(normalizeTitle(t)));
  const partial = !exact && [c.title, c.original_title].some((t) => t && titles.some((x) => x.length > 3 && (normalizeTitle(t).includes(x) || x.includes(normalizeTitle(t)))));
  const y = rowYear(row);
  const yearScore = y == null || c.year == null ? 0 : c.year === y ? 40 : Math.abs(c.year - y) === 1 ? 15 : -30;
  return (exact ? 60 : partial ? 25 : 0) + yearScore;
}

export function rankCandidates(row: MetadataRow, candidates: MatchCandidate[]) {
  return [...candidates].map((c, i) => ({ c, i, s: matchScore(row, c) })).sort((a, b) => b.s - a.s || a.i - b.i).map((x) => x.c);
}
