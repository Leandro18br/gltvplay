import { describe, expect, it } from "vitest";
import { buildMegaEmbedUrl } from "./megaembed";

const cfg = { movieTemplate: "https://megaembed.com/embed/movie?tmdb={tmdb_id}", episodeTemplate: "https://megaembed.com/embed/series?tmdb={tmdb_id}&sea={season}&epi={episode}" };

describe("buildMegaEmbedUrl", () => {
  it("uses the movie's real TMDB id", () => {
    expect(buildMegaEmbedUrl(cfg, { kind: "movie", tmdbId: 950396 })).toBe("https://megaembed.com/embed/movie?tmdb=950396");
  });
  it("targets the specific episode with series TMDB + season + episode", () => {
    expect(buildMegaEmbedUrl(cfg, { kind: "episode", tmdbSeriesId: 12345, season: 1, episode: 3 })).toBe("https://megaembed.com/embed/series?tmdb=12345&sea=1&epi=3");
  });
  it("puts ?player= before the color hash", () => {
    expect(buildMegaEmbedUrl({ ...cfg, player: "vidstack", color: "#00BFFF" }, { kind: "movie", tmdbId: 1 })).toBe("https://megaembed.com/embed/movie?tmdb=1&player=vidstack#00BFFF");
  });
  it("ignores unknown players", () => {
    expect(buildMegaEmbedUrl({ ...cfg, player: "evil" }, { kind: "movie", tmdbId: 1 })).toBe("https://megaembed.com/embed/movie?tmdb=1");
  });
});
