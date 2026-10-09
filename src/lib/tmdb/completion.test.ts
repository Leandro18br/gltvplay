import { describe, expect, it } from "vitest";
import { missingMetadata, reliableMatch, searchTitles } from "./completion";

describe("individual TMDB completion", () => {
  it("fills only actual missing values and counts concrete fields", () => {
    expect(missingMetadata("movie", { title: "Meu título", description: " ", duration_minutes: 0 }, { title: "TMDB", description: "Sinopse", duration_minutes: 108, release_date: null, country: "" })).toEqual({ description: "Sinopse", duration_minutes: 108 });
  });
  it("preserves manual descriptions, titles, existing images and rating zero", () => {
    expect(missingMetadata("movie", { title: "Personalizado", description: "Minha sinopse", poster_url: "custom.jpg", backdrop_url: "custom-bg.jpg", vote_average: 0 }, { title: "Traduzido", description: "TMDB", poster_url: "tmdb.jpg", poster_path: "/p.jpg", backdrop_url: "bg.jpg", backdrop_path: "/b.jpg", vote_average: 8 })).toEqual({});
  });
  it("never writes players, provenance, category, publication or ordering from TMDB", () => {
    expect(missingMetadata("movie", {}, { tmdb_id: 45752, url: "new", playback_sources: [], external_source: "tmdb", external_id: "movie:45752", status: "draft", featured: true, sort_order: 10, category_id: "new" })).toEqual({ tmdb_id: 45752 });
  });
  it("updates only season/episode metadata, never identities or numbering", () => {
    expect(missingMetadata("episode", { id: "existing", title: "Manual" }, { id: "replacement", season_id: "other", episode_number: 2, title: "TMDB", description: "Sinopse", thumbnail_url: "still.jpg", url: "other" })).toEqual({ description: "Sinopse", thumbnail_url: "still.jpg" });
    expect(missingMetadata("season", {}, { series_id: "other", season_number: 2, status: "draft", title: "Temporada 2" })).toEqual({ title: "Temporada 2" });
  });
  it("automatically accepts only one exact title and year match", () => {
    const c = { tmdb_id: 45752, title: "Scooby-Doo 2", original_title: null, year: 2004, poster_url: null };
    expect(reliableMatch({ title: "Scooby-Doo 2", release_year: 2004 }, [c])).toBe(45752);
    expect(reliableMatch({ title: "Scooby-Doo 2", release_year: 2003 }, [c])).toBeNull();
    expect(reliableMatch({ title: "Scooby-Doo 2" }, [c])).toBeNull();
    expect(reliableMatch({ title: "Scooby-Doo 2", release_year: 2004 }, [c, { ...c, tmdb_id: 1 }])).toBeNull();
  });
  it("uses original and cleaned M3U titles without inventing metadata", () => {
    expect(searchTitles({ original_title: "The Mentalist", title: "[BR] O Mentalista (2008) HD" })).toEqual(["The Mentalist", "O Mentalista", "[BR] O Mentalista (2008) HD"]);
    expect(missingMetadata("series", {}, { duration_minutes: 50, number_of_seasons: 7, number_of_episodes: 151 })).toEqual({ number_of_seasons: 7, number_of_episodes: 151 });
  });
});