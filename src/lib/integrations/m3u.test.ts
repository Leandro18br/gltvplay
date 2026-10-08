import { describe, expect, it } from "vitest";
import { parseM3u, entityKey, categoryName, maskListUrl, assertSafeListUrl, createParser, lines, itemKey, seriesItemKey } from "./m3u";

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
    expect(entityKey(entries[2]!)).not.toBe(entityKey(entries[3]!));
    expect(entries[2]!.url).not.toBe(entries[3]!.url);
  });
  it("normalizes group names", () => {
    expect(categoryName("FILMES | AÇÃO")).toBe("Ação");
    expect(categoryName("CANAIS | ESPORTES")).toBe("Esportes");
  });
  it("hides credentials and blocks private hosts", () => {
    expect(maskListUrl("http://h.com:8080/get.php?username=a&password=b")).toBe("http://h.com:8080/••••");
    expect(() => assertSafeListUrl("http://127.0.0.1/x.m3u")).toThrow();
  });
  it("uses kind-prefixed stable ids so a movie and a series with the same name never collide", () => {
    const dark = parseM3u(`#EXTM3U\n#EXTINF:-1 group-title="FILMES",Dark\nhttp://s/movie/1.mp4\n#EXTINF:-1 group-title="SÉRIES",Dark S01E01\nhttp://s/series/2.mp4`).entries;
    expect(itemKey(dark[0]!)).toBe("movie:t:dark");
    expect(seriesItemKey(dark[1]!)).toBe("series:t:dark");
  });
});

/** Feeds bytes in small chunks, like a network body. */
function body(text: string, chunk = 7) {
  const bytes = new TextEncoder().encode(text);
  return new Response(new ReadableStream({ start(c) { for (let i = 0; i < bytes.length; i += chunk) c.enqueue(bytes.slice(i, i + chunk)); c.close(); } }));
}
async function readAll(res: Response, start: number, skip: number, init?: { m3u?: boolean; plus?: boolean }, stopAfter = Infinity) {
  const p = createParser(init); const out: string[] = []; let safe = start;
  for await (const l of lines(res, start, skip)) {
    const e = p.line(l.text);
    if (e && e !== "skip") out.push(e.name);
    if (!p.pending) safe = l.end;
    if (out.length >= stopAfter && !p.pending) break;
  }
  return { out, safe, plus: p.isPlus };
}

describe("resumable indexing", () => {
  it("resumes from a checkpoint without losing or repeating entries (server ignoring Range)", async () => {
    const all = (await readAll(body(LIST), 0, 0)).out;
    const first = await readAll(body(LIST), 0, 0, undefined, 2);
    expect(first.out).toEqual(["Globo HD", "Matrix (1999)"]);
    const rest = await readAll(body(LIST), first.safe, first.safe, { m3u: true, plus: first.plus });
    expect([...first.out, ...rest.out]).toEqual(all);
    expect(all).toHaveLength(4);
  });
  it("resumes from a checkpoint when the server honours Range", async () => {
    const first = await readAll(body(LIST), 0, 0, undefined, 1);
    const tail = new TextDecoder().decode(new TextEncoder().encode(LIST).slice(first.safe));
    const rest = await readAll(body(tail), first.safe, 0, { m3u: true, plus: true });
    expect(rest.out).toEqual(["Matrix (1999)", "Dark S01E01", "Dark S01E02"]);
  });
  it("never checkpoints between an #EXTINF line and its URL", async () => {
    const p = createParser();
    p.line("#EXTM3U"); p.line('#EXTINF:-1,Canal');
    expect(p.pending).toBe(true);
    p.line("http://s/live/1.ts");
    expect(p.pending).toBe(false);
  });
});
