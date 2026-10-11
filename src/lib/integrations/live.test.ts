import { describe, it, expect } from "vitest";
import { parseLiveList, validPlayUrl, isPermanent } from "./live";

const link = (id: number) => `https://cinema.bugoumods.com/?play=1&type=live_streams&id=${id}&ext=mp4&vtoken=abc&embed=vip`;

describe("parseLiveList", () => {
  it("keeps real categories, preserves the official VIP link and dedupes by id", () => {
    const r = parseLiveList({ "⚽ ESPN": [{ id: 1, nome: "ESPN", capa: "http://x/a.png", link: link(1), categoria: "⚽ ESPN" }, { id: 1, nome: "ESPN", link: link(1) }], "▶️ SBT": [{ id: 2, nome: "SBT", link: "" }] });
    expect(r.categories).toEqual(["⚽ ESPN", "▶️ SBT"]);
    expect(r.channels).toHaveLength(2);
    expect(r.duplicates).toBe(1);
    expect(r.channels[0]!.playUrl).toBe(link(1));
    expect(r.channels[0]!.playUrl).toContain("embed=vip");
    expect(r.channels[1]!.playUrl).toBeNull();
    expect(r.missingLink).toBe(1);
  });
  it("rejects changed formats and provider warnings", () => {
    expect(() => parseLiveList([])).toThrow();
    expect(() => parseLiveList({ Aviso: [{ nome: "x" }] })).toThrow();
  });
  it("refuses links on other hosts or that are not live players", () => {
    expect(validPlayUrl("https://evil.com/?type=live_streams&id=1", "cinema.bugoumods.com")).toBeNull();
    expect(validPlayUrl("https://cinema.bugoumods.com/?type=vod_streams&id=1", "cinema.bugoumods.com")).toBeNull();
  });
  it("does not retry credential errors", () => { expect(isPermanent("HTTP 403")).toBe(true); expect(isPermanent("HTTP 503")).toBe(false); });
});
