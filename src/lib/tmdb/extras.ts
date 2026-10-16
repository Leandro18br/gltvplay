/* eslint-disable @typescript-eslint/no-explicit-any */
/** Pure mappers for TMDB credits, videos and extra metadata (no I/O). */

export type TmdbVideo = { id: string; name: string | null; type: string | null; site: string | null; key: string; iso_639_1: string | null; iso_3166_1: string | null; official: boolean | null; published_at: string | null; primary: boolean };

/** Rank of a real trailer: official pt-BR > pt-BR > official pt > pt > official other > other. null = not a trailer. */
export function trailerRank(v: any): number | null {
  if (v?.type !== "Trailer" || v?.site !== "YouTube" || !v?.key) return null;
  const pt = v.iso_639_1 === "pt";
  const br = pt && v.iso_3166_1 === "BR";
  const official = v.official === true;
  if (br) return official ? 0 : 1;
  if (pt) return official ? 2 : 3;
  return official ? 4 : 5;
}

export function mapVideos(body: any): { videos: TmdbVideo[]; trailer: TmdbVideo | null } {
  const raw = ((body?.videos?.results ?? []) as any[]).filter((v) => v?.id && v?.key && v?.site === "YouTube");
  const seen = new Set<string>();
  const list = raw.filter((v) => (seen.has(v.id) ? false : (seen.add(v.id), true)));
  const ranked = list.map((v) => ({ v, r: trailerRank(v) })).filter((x) => x.r !== null)
    .sort((a, b) => (a.r! - b.r!) || String(b.v.published_at ?? "").localeCompare(String(a.v.published_at ?? "")));
  const bestId = ranked[0]?.v.id ?? null;
  const videos = list.slice(0, 30).map((v) => ({
    id: String(v.id), name: v.name ?? null, type: v.type ?? null, site: v.site ?? null, key: String(v.key),
    iso_639_1: v.iso_639_1 ?? null, iso_3166_1: v.iso_3166_1 ?? null, official: typeof v.official === "boolean" ? v.official : null,
    published_at: typeof v.published_at === "string" ? v.published_at : null, primary: v.id === bestId,
  }));
  return { videos, trailer: videos.find((v) => v.primary) ?? null };
}

const CREW_JOBS = new Set(["Director", "Screenplay", "Writer", "Novel", "Story", "Creator", "Executive Producer"]);
export const CREW_LABEL: Record<string, string> = { Director: "Direção", Screenplay: "Roteiro", Writer: "Roteiro", Novel: "Obra original", Story: "História", Creator: "Criação", "Executive Producer": "Produção executiva" };

export function mapCredits(body: any, imageBase: string, maxCast = 30) {
  const credits = body?.credits ?? {};
  const photo = (p?: string | null) => (p ? `${imageBase}w185${p}` : null);
  const cast = ((credits.cast ?? []) as any[]).filter((c) => c?.credit_id && c?.name).slice(0, maxCast).map((c, i) => ({
    type: "cast", credit_id: String(c.credit_id), person_id: c.id ?? null, name: c.name, character: c.character || null, job: null, department: "Acting",
    profile_url: photo(c.profile_path), order: Number.isInteger(c.order) ? c.order : i,
  }));
  const crew = ((credits.crew ?? []) as any[]).filter((c) => c?.credit_id && c?.name && CREW_JOBS.has(c.job) && (c.job !== "Executive Producer" || body?.created_by === undefined)).slice(0, 20).map((c, i) => ({
    type: "crew", credit_id: String(c.credit_id), person_id: c.id ?? null, name: c.name, character: null, job: c.job, department: c.department ?? null,
    profile_url: photo(c.profile_path), order: i,
  }));
  const creators = ((body?.created_by ?? []) as any[]).filter((c) => c?.credit_id && c?.name).map((c, i) => ({
    type: "crew", credit_id: String(c.credit_id), person_id: c.id ?? null, name: c.name, character: null, job: "Creator", department: "Creator",
    profile_url: photo(c.profile_path), order: i,
  }));
  return [...cast, ...creators, ...crew];
}

/** Brazilian age rating (Classificação Indicativa) only; never another country's. */
export function brazilRating(kind: "movie" | "series", body: any): string | null {
  if (kind === "movie") {
    const br = ((body?.release_dates?.results ?? []) as any[]).find((r) => r.iso_3166_1 === "BR");
    const c = ((br?.release_dates ?? []) as any[]).map((d) => String(d.certification ?? "").trim()).find(Boolean);
    return c || null;
  }
  const br = ((body?.content_ratings?.results ?? []) as any[]).find((r) => r.iso_3166_1 === "BR");
  return String(br?.rating ?? "").trim() || null;
}

export function extrasPatch(kind: "movie" | "series", body: any) {
  const { trailer } = mapVideos(body);
  const names = (list: any) => ((list ?? []) as any[]).map((x) => String(x?.name ?? "").trim()).filter(Boolean);
  const patch: Record<string, unknown> = {
    age_rating: brazilRating(kind, body),
    trailer_url: trailer ? `https://www.youtube.com/watch?v=${trailer.key}` : null,
    production_companies: names(body?.production_companies),
    production_countries: names(body?.production_countries),
  };
  if (kind === "series") {
    patch["last_air_date"] = typeof body?.last_air_date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(body.last_air_date) ? body.last_air_date : null;
    patch["in_production"] = typeof body?.in_production === "boolean" ? body.in_production : null;
    patch["networks"] = names(body?.networks);
  }
  return patch;
}
