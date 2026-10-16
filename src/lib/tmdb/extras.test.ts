import { describe, expect, it } from "vitest";
import { brazilRating, mapCredits, mapVideos } from "./extras";

const v = (id: string, o: Record<string, unknown>) => ({ id, key: `k${id}`, site: "YouTube", type: "Trailer", iso_639_1: "en", iso_3166_1: "US", official: false, ...o });
describe("tmdb extras", () => {
  it("prefers official pt-BR trailer over others", () => {
    const r = mapVideos({ videos: { results: [v("1", { official: true }), v("2", { iso_639_1: "pt", iso_3166_1: "BR" }), v("3", { iso_639_1: "pt", iso_3166_1: "BR", official: true })] } });
    expect(r.trailer?.id).toBe("3");
    expect(r.videos.filter((x) => x.primary)).toHaveLength(1);
  });
  it("never treats teasers or clips as trailer", () => {
    expect(mapVideos({ videos: { results: [v("1", { type: "Teaser" }), v("2", { type: "Clip" })] } }).trailer).toBeNull();
  });
  it("maps cast with character, photo and order; keeps only key crew", () => {
    const c = mapCredits({ credits: { cast: [{ credit_id: "c1", id: 9, name: "Ana", character: "Maria", profile_path: "/a.jpg", order: 0 }], crew: [{ credit_id: "d1", name: "Beto", job: "Director" }, { credit_id: "x", name: "Caio", job: "Grip" }] } }, "https://image.tmdb.org/t/p/");
    expect(c).toHaveLength(2);
    expect(c[0]).toMatchObject({ type: "cast", person_id: 9, character: "Maria", profile_url: "https://image.tmdb.org/t/p/w185/a.jpg", order: 0 });
    expect(c[1]).toMatchObject({ type: "crew", job: "Director" });
  });
  it("uses only the Brazilian age rating", () => {
    expect(brazilRating("movie", { release_dates: { results: [{ iso_3166_1: "US", release_dates: [{ certification: "PG" }] }] } })).toBeNull();
    expect(brazilRating("series", { content_ratings: { results: [{ iso_3166_1: "BR", rating: "14" }] } })).toBe("14");
  });
});
