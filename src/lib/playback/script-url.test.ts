import { describe, expect, it } from "vitest";
import { classifyResponse, frameAllowed, needsResourceProbe, isDirectEmbedEndpoint, isScriptEndpoint } from "./script-url";
const o = "https://cinema.bugoumods.com/player.php?type=live_streams&id=2012360165&ext=mp4";
const base = { status: 200, xfo: null, csp: null, body: "", finalUrl: o, originalUrl: o };
describe("player.php endpoints", () => {
  it("probes an extensionless play URL instead of treating its fragment as MP4", () => {
    const url = "https://hsflix.top/play/B6c8jk8eQ343P2laAVL9Mc__UlLXVx0hWxRi9qMKa_c#.mp4";
    expect(needsResourceProbe(url)).toBe(true);
    const response = classifyResponse({ ...base, originalUrl: url, finalUrl: url, contentType: "text/html", body: "<!doctype html>" });
    expect(response).toMatchObject({ kind: "html", playUrl: url });
    expect(new URL(url).pathname.endsWith(".mp4")).toBe(false);
    expect(needsResourceProbe("http://example.com/movie/1")).toBe(false);
    expect(needsResourceProbe("https://example.com/play/movie.mp4#t=10")).toBe(false);
    expect(needsResourceProbe(o)).toBe(false);
  });
  it("keeps query and fragment for actual video and HLS responses", () => {
    const url = "https://example.com/play/item?key=value#.mp4";
    for (const contentType of ["video/mp4", "application/vnd.apple.mpegurl"]) expect(classifyResponse({ ...base, originalUrl: url, contentType }).playUrl).toBe(url);
  });
  it("honors explicit allowed frame ancestors rather than allowing arbitrary origins", () => {
    expect(frameAllowed(null, "frame-ancestors https://owner.example", "https://player.example/play/1", "https://gltvplay.lovable.app")).toBe(false);
    expect(frameAllowed(null, "frame-ancestors 'self' https://gltvplay.lovable.app", "https://player.example/play/1", "https://gltvplay.lovable.app")).toBe(true);
    expect(frameAllowed(null, "frame-ancestors https://*.lovable.app", "https://player.example/play/1", "https://gltvplay.lovable.app")).toBe(true);
    expect(frameAllowed(null, "frame-ancestors 'none'", "https://player.example/play/1", "https://gltvplay.lovable.app")).toBe(false);
  });
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
