import { describe, it, expect, vi, afterEach } from "vitest";
import { resolveSecureUrl, isMixedContent } from "./mpegts";
const setProto = (p: string) => vi.stubGlobal("window", { location: { protocol: p } });
afterEach(() => vi.unstubAllGlobals());
describe("HTTPS alternative for HTTP sources", () => {
  it("keeps HTTP URL untouched on an HTTP page", async () => { setProto("http:"); expect(await resolveSecureUrl("http://x.tv/a.ts")).toBe("http://x.tv/a.ts"); });
  it("keeps HTTPS URL untouched", async () => { setProto("https:"); expect(isMixedContent("https://x.tv/a.ts")).toBe(false); });
  it("uses HTTPS variant when it answers OK over HTTPS", async () => { setProto("https:"); vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, url: "https://x.tv/a.ts?u=1" }))); expect(await resolveSecureUrl("http://x.tv/a.ts?u=1")).toBe("https://x.tv/a.ts?u=1"); });
  it("rejects when HTTPS redirects back to HTTP", async () => { setProto("https:"); vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, url: "http://1.2.3.4/auth/x" }))); expect(await resolveSecureUrl("http://x.tv/a.ts")).toBeNull(); });
  it("rejects when HTTPS fails", async () => { setProto("https:"); vi.stubGlobal("fetch", vi.fn(async () => { throw new TypeError("fail"); })); expect(await resolveSecureUrl("http://x.tv/a.ts")).toBeNull(); });
});
describe("HTTP port on HTTPS variant", () => {
  it("drops explicit :80 when probing HTTPS", async () => { setProto("https:"); vi.stubGlobal("fetch", vi.fn(async (u: string) => ({ ok: true, url: u }))); expect(await resolveSecureUrl("http://x.tv:80/live/a.ts")).toBe("https://x.tv/live/a.ts"); });
});
