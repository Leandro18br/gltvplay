import { describe, expect, it } from "vitest";
import { normalizePlaybackSources } from "./sources";

describe("normalizePlaybackSources", () => {
  const url = "https://provider.example/watch?id=42";

  it("accepts RPC rows that alias source_type as type", () => {
    expect(normalizePlaybackSources([{ id: "s1", url, type: "embed", label: "API" }])).toEqual([
      { id: "s1", url, type: "embed", label: "API" },
    ]);
  });

  it("accepts the database column name source_type", () => {
    expect(normalizePlaybackSources([{ id: "s2", url, source_type: "embed", label: "API" }])[0]?.type).toBe("embed");
  });

  it("supports wrapped RPC payloads and detects HLS without changing its URL", () => {
    const hls = "https://provider.example/master.m3u8?token=keep";
    expect(normalizePlaybackSources({ sources: [{ id: "s3", url: hls, source_type: "url" }] })).toEqual([
      { id: "s3", url: hls, type: "hls", label: null },
    ]);
  });

  it("drops malformed rows instead of inventing playback URLs", () => {
    expect(normalizePlaybackSources([
      { id: "missing-url", source_type: "embed" },
      { id: "bad-url", url: "javascript:alert(1)", source_type: "embed" },
      { id: "ok", url, source_type: "url" },
    ])).toEqual([{ id: "ok", url, type: "url", label: null }]);
  });

  it("returns an empty list for unexpected RPC shapes", () => {
    expect(normalizePlaybackSources({ data: [{ id: "s1", url }] })).toEqual([]);
    expect(normalizePlaybackSources(null)).toEqual([]);
  });
});
