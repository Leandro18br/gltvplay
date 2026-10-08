import { describe, expect, it } from "vitest";
import { buildUrl, detectPlayer, extractPlayer, fillTemplate, getPath, isBlockedHost, mapCatalog } from "./engine";

describe("variáveis", () => {
  it("substitui variáveis do caminho", () => expect(fillTemplate("/series/{series_id}/season/{season}/episode/{episode}", { series_id: "12345", season: "2", episode: "5" })).toBe("/series/12345/season/2/episode/5"));
  it("falha quando falta variável", () => expect(() => fillTemplate("/movie/{tmdb_id}", {})).toThrow("{tmdb_id}"));
});
describe("mapeamento", () => {
  it("lê data.player", () => expect(getPath({ data: { player: "x" } }, "data.player")).toBe("x"));
  it("lê results[0].url", () => expect(getPath({ results: [{ url: "y" }] }, "results[0].url")).toBe("y"));
  it("acha embed_url sem caminho configurado", () => expect(extractPlayer({ embed_url: "https://exemplo.com/player/123" }, {})).toEqual({ type: "embed", url: "https://exemplo.com/player/123" }));
  it("mapeia catálogo com prefixo de imagem", () => {
    const [i] = mapCatalog({ results: [{ id: 20558, title: "A", release_date: "2010-05-01", poster_path: "/p.jpg" }] }, { results_path: "results", image_base: "https://img.exemplo.com/w500", fields: { tmdb_id: "id" } });
    expect(i).toMatchObject({ title: "A", release_year: 2010, tmdb_id: "20558", poster_url: "https://img.exemplo.com/w500/p.jpg" });
  });
});
describe("tipo do player", () => {
  it("iframe vira embed com o src", () => expect(detectPlayer('<iframe src="https://streambetter.shop/filme/20558" allowfullscreen></iframe>')).toEqual({ type: "embed", url: "https://streambetter.shop/filme/20558" }));
  it("m3u8 vira HLS", () => expect(detectPlayer("https://cdn.exemplo.com/a/index.m3u8")?.type).toBe("hls"));
  it("rejeita http sem TLS", () => expect(detectPlayer("http://exemplo.com/embed/1")).toBeNull());
});
describe("proteção contra proxy aberto", () => {
  it("bloqueia localhost e IPs", () => { expect(isBlockedHost("localhost")).toBe(true); expect(isBlockedHost("127.0.0.1")).toBe(true); expect(isBlockedHost("169.254.169.254")).toBe(true); });
  it("mantém o mesmo domínio da URL base", () => expect(() => buildUrl("https://api.exemplo.com", "//evil.com/x", {}, {})).toThrow());
  it("variável com .. é recusada", () => expect(() => buildUrl("https://api.exemplo.com/v1", "/movie/{tmdb_id}", { tmdb_id: "../../x" }, {})).toThrow());
  it("variável não troca o domínio", () => expect(buildUrl("https://api.exemplo.com/v1", "/movie/{tmdb_id}", { tmdb_id: "x@evil.com/y" }, {}).host).toBe("api.exemplo.com"));
  it("monta URL com query", () => expect(buildUrl("https://api.exemplo.com/v1", "/player/{tmdb_id}", { tmdb_id: "20558" }, { lang: "pt" }).href).toBe("https://api.exemplo.com/v1/player/20558?lang=pt"));
});
