import { describe, expect, it } from "vitest";
import { classifyResponse, isDirectEmbedEndpoint, isScriptEndpoint } from "./script-url";
const o = "https://cinema.bugoumods.com/player.php?type=live_streams&id=2012360165&ext=mp4";
const base = { status: 200, xfo: null, csp: null, body: "", finalUrl: o, originalUrl: o };
describe("player.php endpoints", () => {
  it("uses BugouMods VIP player.php directly as an iframe endpoint", () => {
    expect(isDirectEmbedEndpoint(o)).toBe(true);
    expect(isDirectEmbedEndpoint("http://cinema.bugoumods.com/player.php?id=1")).toBe(false);
    expect(isDirectEmbedEndpoint("https://example.com/player.php?id=1")).toBe(false);
  });
  it("recognizes script endpoints, not media files", () => { expect(isScriptEndpoint(o)).toBe(true); expect(isScriptEndpoint("https://x.com/a.mp4")).toBe(false); expect(isScriptEndpoint("https://x.com/a.m3u8")).toBe(false); });
  it("HTML with ext=mp4 is an embed, never video", () => { const r = classifyResponse({ ...base, contentType: "text/html", body: "<!DOCTYPE html>" }); expect(r.kind).toBe("html"); expect(r.playUrl).toBe(o); });
  it("keeps all params for direct video", () => { expect(classifyResponse({ ...base, contentType: "video/mp4" })).toMatchObject({ kind: "video", playUrl: o }); });
  it("detects HLS by body", () => { expect(classifyResponse({ ...base, contentType: "text/plain", body: "#EXTM3U\n" }).kind).toBe("hls"); });
  it("refuses non-embeddable pages", () => { expect(classifyResponse({ ...base, contentType: "text/html", xfo: "DENY" }).playUrl).toBeNull(); });
  it("does not upgrade http without a confirmed https redirect", () => { const h = o.replace("https", "http"); expect(classifyResponse({ ...base, contentType: "text/html", originalUrl: h, finalUrl: h }).playUrl).toBeNull(); });
  it("reports blocked and auth", () => { expect(classifyResponse({ ...base, status: 403, contentType: "text/html" }).kind).toBe("blocked"); expect(classifyResponse({ ...base, status: 401, contentType: null }).kind).toBe("auth"); });
});
