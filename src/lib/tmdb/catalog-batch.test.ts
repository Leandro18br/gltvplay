import { describe, it, expect } from "vitest";
import { CATALOG_BATCH_SIZE, inCatalogYear, yearSegment, splitSegment } from "./catalog-batch";
describe("2026 metadata catalog", () => {
  it("includes all 2026 release dates, including upcoming dates", () => {
    expect(yearSegment()).toEqual({from:"2026-01-01",to:"2026-12-31"});
    expect(inCatalogYear("2026-12-31")).toBe(true); expect(inCatalogYear("2026-01-01")).toBe(true);
    expect(inCatalogYear("2025-12-31")).toBe(false); expect(inCatalogYear(null)).toBe(false);
  });
  it("splits overflowing TMDB intervals without date gaps or overlap", () => {
    const [a,b]=splitSegment(yearSegment());
    if(!a||!b) throw new Error("Split must return two intervals");
    expect(a.from).toBe("2026-01-01"); expect(b.to).toBe("2026-12-31");
    expect(Date.parse(b.from)-Date.parse(a.to)).toBe(86400000);
  });
  it("keeps work bounded and rejects unsplittable intervals", () => {
    expect(CATALOG_BATCH_SIZE).toBe(3);
    expect(()=>splitSegment({from:"2026-01-01",to:"2026-01-01"})).toThrow();
  });
});