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
    if (key === "poster_path" && !isMissing(current.poster_url)) continue;
    if (key === "backdrop_path" && !isMissing(current.backdrop_url)) continue;
    if (key === "still_path" && !isMissing(current.thumbnail_url)) continue;
    patch[key] = value;
  }
  return patch;
}

export function normalizeTitle(title: string) {
  return title.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

export function searchTitles(row: MetadataRow): string[] {
  return [...new Set([row.original_title, row.title].filter((x): x is string => typeof x === "string" && !!x.trim()).flatMap((title) => {
    const clean = title.replace(/\[(?:[^\]]+)\]/g, " ").replace(/\b(?:4k|1080p|720p|480p|2160p|fhd|uhd|hd|dublado|legendado)\b/gi, " ").replace(/\(\d{4}\)/g, " ").replace(/\s+/g, " ").trim();
    return [clean, title.trim()];
  }))].slice(0, 4);
}

export type MatchCandidate = { tmdb_id: number; title: string; original_title: string | null; year: number | null; poster_url: string | null };
export function reliableMatch(row: MetadataRow, candidates: MatchCandidate[]): number | null {
  const titles = searchTitles(row).map(normalizeTitle);
  const matches = candidates.filter((c) => [c.title, c.original_title].some((t) => t && titles.includes(normalizeTitle(t))) && typeof row.release_year === "number" && c.year === row.release_year);
  return matches.length === 1 ? matches[0]?.tmdb_id ?? null : null;
}