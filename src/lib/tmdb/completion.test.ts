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
import { matchScore, rankCandidates, rowYear, simplifiedTitle } from "./completion";
describe("TMDB match precision", () => {
  const c = (tmdb_id: number, title: string, year: number | null, original_title: string | null = null) => ({ tmdb_id, title, original_title, year, poster_url: null });
  it("matches a Portuguese title via the original title and year", () => {
    expect(reliableMatch({ title: "O Poderoso Chefão", original_title: "The Godfather", release_year: 1972 }, [c(238, "O Poderoso Chefão", 1972, "The Godfather"), c(240, "O Poderoso Chefão: Parte II", 1974, "The Godfather Part II")])).toBe(238);
  });
  it("separates remakes with the same name by year", () => {
    const list = [c(1, "O Rei Leão", 1994), c(2, "O Rei Leão", 2019)];
    expect(reliableMatch({ title: "O Rei Leão", release_year: 2019 }, list)).toBe(2);
    expect(reliableMatch({ title: "O Rei Leão" }, list)).toBeNull();
  });
  it("uses the year written in an M3U title", () => {
    expect(rowYear({ title: "Duna (2021) 4K" })).toBe(2021);
    expect(reliableMatch({ title: "Duna (2021) 4K" }, [c(438631, "Duna", 2021), c(841, "Duna", 1984)])).toBe(438631);
  });
  it("never auto-accepts a similar-but-different title and ranks exact matches first", () => {
    expect(reliableMatch({ title: "Alien", release_year: 1979 }, [c(9, "Alien vs. Predador", 1979)])).toBeNull();
    expect(matchScore({ title: "Alien", release_year: 1979 }, c(348, "Alien, o 8º Passageiro", 1979, "Alien"))).toBe(100);
    expect(rankCandidates({ title: "Alien", release_year: 1979 }, [c(9, "Alien vs. Predador", 2004), c(348, "Alien", 1979)])[0]?.tmdb_id).toBe(348);
  });
  it("removes punctuation for alternative queries", () => {
    expect(simplifiedTitle("Missão: Impossível – Acerto de Contas")).toBe("Missão Impossível Acerto de Contas");
  });
});

import { vi } from "vitest";
vi.mock("@/integrations/supabase/auth-middleware", () => ({ requireSupabaseAuth: {} }));
describe("official TMDB dates", async () => {
  const { officialDates } = await import("./tmdb.functions");
  it("corrects the year from the official date and never invents one", () => {
    expect(officialDates("movie", { release_date: "2018-06-06" })).toEqual({ release_date: "2018-06-06", release_year: 2018 });
    expect(officialDates("series", { first_air_date: "2023-09-27" })).toEqual({ first_air_date: "2023-09-27", release_year: 2023 });
    expect(officialDates("movie", { release_date: null })).toEqual({});
  });
});

import { coverDecision, safeImageUrl } from "./completion";
describe("episode covers", () => {
  it("upgrades malformed http TMDB urls", () => expect(safeImageUrl("http://image.tmdb.org//t/p/w227/a.jpg")).toBe("https://image.tmdb.org/t/p/w227/a.jpg"));
  it("fixes missing, http and wrong-episode stills", () => {
    expect(coverDecision(null, "/a.jpg")).toBe("fix");
    expect(coverDecision("http://image.tmdb.org//t/p/w227/a.jpg", "/a.jpg")).toBe("fix");
    expect(coverDecision("https://image.tmdb.org/t/p/w300/b.jpg", "/a.jpg")).toBe("fix");
  });
  it("keeps valid and custom covers", () => {
    expect(coverDecision("https://image.tmdb.org/t/p/w300/a.jpg", "/a.jpg")).toBe("valid");
    expect(coverDecision("https://cdn.example.com/x.jpg", "/a.jpg")).toBe("valid");
  });
  it("reports no official image", () => expect(coverDecision(null, null)).toBe("not_found"));
});
