import { describe, expect, it } from "vitest";
import { parseBugouName, parseBugouDetails, parseBugouMovieDetails, bugouEmbedUrl, mapBugouGenreSlugs, bugouBackdrop } from "./bugoumods";

describe("parseBugouName", () => {
  it("separa título e ano", () => expect(parseBugouName("1883 (2021)")).toEqual({ title: "1883", year: 2021 }));
  it("sem ano mantém título", () => expect(parseBugouName("Dark")).toEqual({ title: "Dark", year: null }));
});

describe("parseBugouDetails", () => {
  it("maps seasons/episodes to tokenless embed URLs", () => {
    const d = parseBugouDetails("4453", { info: { name: "#blackAF (2020)", title: "#blackAF", year: "2020" }, episodes: { "1": [{ id: "21204888", episode_num: "1", title: "Episódio 1", container_extension: "mp4", info: { duration_secs: 2100 } }, { id: "x", episode_num: "2" }] } });
    expect(d.seasons).toHaveLength(1);
    expect(d.seasons[0]!.episodes).toHaveLength(1);
    expect(d.seasons[0]!.episodes[0]!.embed_url).toBe("https://cinema.bugoumods.com/player.php?type=vod_streams&id=21204888&ext=mp4&embed=free");
    expect(d.seasons[0]!.episodes[0]!.duration_minutes).toBe(35);
    expect(bugouEmbedUrl("1", "bad ext")).not.toContain("vtoken");
  });
});

import { normTitle as nt, compactTitle as ct } from "./bugoumods";
import { describe as d2, it as i2, expect as e2 } from "vitest";
d2("normTitle", () => {
  i2("ignores accents, case, punctuation and extra spaces", () => {
    e2(nt("  #blackAF:  Série ")).toBe("blackaf serie");
    e2(nt("Ação")).toBe(nt("acao"));
    e2(ct("Black AF")).toBe(ct("#blackAF"));
  });
});


describe("parseBugouMovieDetails", () => {
  it("reads movie plot, cover, year, and extension from a VOD detail response", () => {
    const d = parseBugouMovieDetails("123", {
      info: { name: "Filme Teste (2024)", plot: "Sinopse do filme", cover: "http://example.com/cover.jpg", year: "2024" },
      movie_data: { stream_id: 123, container_extension: "mkv" },
    });
    expect(d).toEqual({
      id: "123",
      title: "Filme Teste",
      originalTitle: null,
      year: 2024,
      plot: "Sinopse do filme",
      cover: "https://example.com/cover.jpg",
      backdrop: null,
      releaseDate: null,
      durationMinutes: null,
      ageRating: null,
      quality: null,
      language: null,
      country: null,
      ext: "mkv",
      genres: [],
      providerMetadataPaths: ["info.plot", "movie_data.container_extension"],
    });
  });

  it("uses a safe default extension when provider data is missing or invalid", () => {
    expect(parseBugouMovieDetails("321", { info: { title: "Outro Filme", plot: "Descrição" } }).ext).toBe("mp4");
  });

  it("maps optional metadata only when the provider actually supplies it", () => {
    const d = parseBugouMovieDetails("654", {
      info: {
        name: "Filme Completo (2022)", original_title: "Original Movie", plot: "Sinopse",
        movie_image: "https://example.com/poster.jpg", backdrop_path: "https://example.com/backdrop.jpg",
        releasedate: "2022-04-03", duration_secs: "7200", age_rating: "12", quality: "1080p",
        language: "pt-BR", country: "BR", genre: "Ação, Drama",
      },
      movie_data: { stream_id: "654", container_extension: "mp4" },
    });
    expect(d.originalTitle).toBe("Original Movie");
    expect(d.backdrop).toBe("https://example.com/backdrop.jpg");
    expect(d.durationMinutes).toBe(120);
    expect(d.ageRating).toBe("12");
    expect(d.quality).toBe("1080p");
    expect(d.language).toBe("pt-BR");
    expect(d.country).toBe("BR");
    expect(d.genres).toEqual(["Ação", "Drama"]);
  });

  it("reads provider genres from strings, arrays and objects while ignoring numeric-only IDs", () => {
    const d = parseBugouMovieDetails("456", {
      info: { name: "Filme (2024)", plot: "Sinopse", genre: "Ação, Aventura" },
      movie_data: { stream_id: 456, genres: [{ name: "Drama" }, { id: 28 }, "Comédia"], genre_ids: [28, 12] },
    });
    expect(d.genres).toEqual(["Ação", "Aventura", "Drama", "Comédia"]);
    expect(d.providerMetadataPaths).toContain("info.plot");
    expect(d.providerMetadataPaths).toContain("info.genre");
    expect(d.genres).not.toContain("28");
  });
});

describe("BugouMods real response shapes", () => {
  it("movie_info: reads tmdb_id and o_name, ignores empty plot/genre and rating 0", () => {
    const d = parseBugouMovieDetails("19749467", { info: { tmdb_id: "1241982", name: "MOANA 2 (Cinema)", o_name: "Moana 2", plot: "", genre: "", rating: "0", duration: "00:00:00", duration_secs: "0", releasedate: "" }, movie_data: { stream_id: "19749467", year: "None", container_extension: "mp4" } });
    expect(d.tmdbId).toBe(1241982);
    expect(d.originalTitle).toBe("Moana 2");
    expect(d.plot).toBeNull();
    expect(d.genres).toEqual([]);
    expect(d.rating).toBeNull();
    expect(d.durationMinutes).toBeNull();
  });
  it("series_info: genres, backdrop list string, dates, rating, trailer, season and episode metadata", () => {
    const d = parseBugouDetails("1", {
      info: { name: "Loki (2021)", title: "Loki", year: "2021", plot: "Sinopse", genre: "Drama, Sci-Fi & Fantasy", release_date: "2021-06-09", rating: "8", backdrop_path: "['http://image.tmdb.org/t/p/w1280/x.jpg']", youtube_trailer: "ETpixAlp3bk" },
      seasons: [{ season_number: "1", overview: "Temporada", air_date: "2021-06-09", id: "114355", cover_big: "https://image.tmdb.org/s.jpg" }],
      episodes: { "1": [{ id: "21874030", episode_num: "1", title: "Glorioso Propósito", container_extension: "mp4", info: { plot: "Ep plot", release_date: "2021-06-09", rating: "7.421", tmdb_id: "2534997", duration_secs: "3180" } }] },
    });
    expect(d.genres).toEqual(["Drama", "Sci-Fi & Fantasy"]);
    expect(mapBugouGenreSlugs(d.genres!)).toEqual(["drama", "ficcao-cientifica", "fantasia"]);
    expect(d.backdrop).toBe("https://image.tmdb.org/t/p/w1280/x.jpg");
    expect(d.releaseDate).toBe("2021-06-09");
    expect(d.rating).toBe(8);
    expect(d.trailer).toBe("https://www.youtube.com/watch?v=ETpixAlp3bk");
    expect(d.seasonMeta?.[0]).toMatchObject({ season: 1, overview: "Temporada", air_date: "2021-06-09", tmdb_id: 114355 });
    expect(d.seasons[0]!.episodes[0]).toMatchObject({ plot: "Ep plot", release_date: "2021-06-09", rating: 7.4, tmdb_id: 2534997, duration_minutes: 53 });
  });
  it("unknown genre labels are not mapped to invented genres", () => {
    expect(mapBugouGenreSlugs(["Novela", "Reality"])).toEqual([]);
    expect(bugouBackdrop("")).toBeNull();
  });
});
