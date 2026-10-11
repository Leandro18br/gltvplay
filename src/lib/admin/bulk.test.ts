import { describe, expect, it } from "vitest";
import { batchSize, chunk, summarize } from "./bulk";

describe("bulk actions", () => {
  it("splits ids in batches without losing any", () => {
    const ids = Array.from({ length: 1201 }, (_, i) => String(i));
    const parts = chunk(ids, batchSize("movie", "delete"));
    expect(parts.length).toBe(3);
    expect(parts.flat()).toEqual(ids);
  });
  it("series deletes use smaller batches", () => {
    expect(batchSize("series", "delete")).toBe(100);
  });
  it("partial failure is never reported as total success", () => {
    const s = summarize({ requested: 10, affected: 5, missing: [], failed: ["a", "b", "c", "d", "e"], errors: ["forbidden"], seasons: 0, episodes: 0 }, "delete", "filme(s)");
    expect(s.ok).toBe(false);
    expect(s.text).toContain("5 falharam");
  });
});
