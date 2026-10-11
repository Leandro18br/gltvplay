import { describe, expect, it } from "vitest";
import { parseBugouName, parseBugouDetails, bugouEmbedUrl } from "./bugoumods";

describe("parseBugouName", () => {
  it("separa título e ano", () => expect(parseBugouName("1883 (2021)")).toEqual({ title: "1883", year: 2021 }));
  it("sem ano mantém título", () => expect(parseBugouName("Dark")).toEqual({ title: "Dark", year: null }));
});

describe("parseBugouDetails", () => {
  it("maps seasons/episodes to tokenless embed URLs", () => {
    const d = parseBugouDetails("4453", { info: { name: "#blackAF (2020)", title: "#blackAF", year: "2020" }, episodes: { "1": [{ id: "21204888", episode_num: "1", title: "Episódio 1", container_extension: "mp4", info: { duration_secs: 2100 } }, { id: "x", episode_num: "2" }] } });
    expect(d.seasons).toHaveLength(1);
    expect(d.seasons[0].episodes).toHaveLength(1);
    expect(d.seasons[0].episodes[0].embed_url).toBe("https://cinema.bugoumods.com/player.php?type=vod_streams&id=21204888&ext=mp4&embed=free");
    expect(d.seasons[0].episodes[0].duration_minutes).toBe(35);
    expect(bugouEmbedUrl("1", "bad ext")).not.toContain("vtoken");
  });
});
