import { describe, expect, it } from "vitest";
import { parseM3u, entityKey, categoryName, maskListUrl, assertSafeListUrl } from "./m3u";

const LIST = `#EXTM3U
#EXTINF:-1 tvg-id="globo.br" tvg-name="Globo HD" tvg-logo="https://x.com/g.png" group-title="CANAIS | ABERTOS",Globo HD
http://srv.com/live/u/p/1.ts
#EXTINF:-1 tvg-name="Matrix (1999)" group-title="FILMES | AÇÃO",Matrix (1999)
http://srv.com/movie/u/p/2.mp4
#EXTINF:-1 tvg-name="Dark S01E01" group-title="SÉRIES | NETFLIX",Dark S01E01
http://srv.com/series/u/p/3.mp4
#EXTINF:-1 tvg-name="Dark S01E02" group-title="SÉRIES | NETFLIX",Dark S01E02
http://srv.com/series/u/p/4.mp4`;

describe("m3u", () => {
  const { entries, isPlus } = parseM3u(LIST);
  it("detects M3U Plus and classifies items", () => {
    expect(isPlus).toBe(true);
    expect(entries.map(e => e.kind)).toEqual(["channel", "movie", "episode", "episode"]);
  });
  it("reads movie year and episode numbers", () => {
    expect(entries[1]).toMatchObject({ title: "Matrix", year: 1999 });
    expect(entries[3]).toMatchObject({ series: "Dark", season: 1, episode: 2 });
  });
  it("gives each episode its own key and URL", () => {
    expect(entityKey(entries[2])).not.toBe(entityKey(entries[3]));
    expect(entries[2].url).not.toBe(entries[3].url);
  });
  it("normalizes group names", () => {
    expect(categoryName("FILMES | AÇÃO")).toBe("Ação");
    expect(categoryName("CANAIS | ESPORTES")).toBe("Esportes");
  });
  it("hides credentials and blocks private hosts", () => {
    expect(maskListUrl("http://h.com:8080/get.php?username=a&password=b")).toBe("http://h.com:8080/••••");
    expect(() => assertSafeListUrl("http://127.0.0.1/x.m3u")).toThrow();
  });
});
