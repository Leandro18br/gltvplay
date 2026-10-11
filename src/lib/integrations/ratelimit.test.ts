import { describe, expect, it } from "vitest";
import { adaptFactor, backoffMs, fetchProviderJson, minIntervalMs, parseRetryAfter, RateLimitedError } from "./ratelimit";

const url = new URL("https://example.test/x");
const res = (status: number, body: unknown = {}, headers: Record<string, string> = {}) => new Response(JSON.stringify(body), { status, headers });

describe("rate limit helpers", () => {
  it("Retry-After in seconds is respected", () => expect(parseRetryAfter("120")).toBe(120_000));
  it("Retry-After as HTTP date", () => expect(parseRetryAfter(new Date(1_000_000 + 30_000).toUTCString(), 1_000_000)).toBe(30_000));
  it("Retry-After is capped at 15 minutes", () => expect(parseRetryAfter("99999")).toBe(900_000));
  it("missing Retry-After gives null", () => expect(parseRetryAfter(null)).toBeNull());
  it("backoff grows and has jitter bounds", () => {
    expect(backoffMs(1, 15_000, 600_000, () => 0)).toBe(11_250);
    expect(backoffMs(3, 15_000, 600_000, () => 1)).toBe(75_000);
    expect(backoffMs(20, 15_000, 600_000, () => 0.5)).toBe(600_000);
  });
  it("30 requests/min paces 2s apart; halved after 429", () => {
    expect(minIntervalMs(30)).toBe(2000);
    expect(minIntervalMs(30, adaptFactor(1, "429"))).toBe(4000);
    expect(adaptFactor(0.5, "ok")).toBeCloseTo(0.6);
  });
});

describe("fetchProviderJson", () => {
  it("429 makes exactly one request and carries Retry-After", async () => {
    let calls = 0;
    const p = fetchProviderJson(url, "episódios", { timeoutMs: 1000, fetchImpl: (async () => { calls++; return res(429, {}, { "Retry-After": "45" }); }) as any, sleep: async () => {} });
    await expect(p).rejects.toBeInstanceOf(RateLimitedError);
    await p.catch(e => expect(e.retryAfterMs).toBe(45_000));
    expect(calls).toBe(1);
  });
  it("5xx retries once then succeeds", async () => {
    let calls = 0;
    const r = await fetchProviderJson(url, "x", { timeoutMs: 1000, fetchImpl: (async () => (++calls === 1 ? res(503) : res(200, { ok: 1 }))) as any, sleep: async () => {} });
    expect(r).toEqual({ json: { ok: 1 }, requests: 2 });
  });
  it("4xx other than 429 fails without retry", async () => {
    let calls = 0;
    await expect(fetchProviderJson(url, "x", { timeoutMs: 1000, fetchImpl: (async () => { calls++; return res(404); }) as any, sleep: async () => {} })).rejects.toThrow("HTTP 404");
    expect(calls).toBe(1);
  });
});
