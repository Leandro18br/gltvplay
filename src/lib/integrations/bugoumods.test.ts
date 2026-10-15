import { describe, expect, it } from "vitest";
import { parseBugouName, parseBugouDetails, parseBugouMovieDetails, bugouEmbedUrl } from "./bugoumods";

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
      year: 2024,
      plot: "Sinopse do filme",
      cover: "https://example.com/cover.jpg",
      ext: "mkv",
      genres: [],
    });
  });

  it("uses a safe default extension when provider data is missing or invalid", () => {
    expect(parseBugouMovieDetails("321", { info: { title: "Outro Filme", plot: "Descrição" } }).ext).toBe("mp4");
  });

  it("normalizes genre names from strings, arrays, and objects without treating numeric IDs as names", () => {
    const d = parseBugouMovieDetails("456", {
      info: { title: "Filme com gêneros", genre: "Ação, Aventura" },
      data: { genres: [{ name: "Drama" }, { id: 28 }, "Comédia"] },
    });
    expect(d.genres).toEqual(["Ação", "Aventura", "Drama", "Comédia"]);
  });
});
