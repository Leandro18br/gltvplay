import { describe, expect, it } from "vitest";
import { categoryEntries, categorySlugForKind } from "./categories";
import { pool } from "./pool";

describe("import categories", () => {
  it("keeps the original name and dedupes by slug", () => {
    expect(categoryEntries(["Ação", " ação ", "Netflix", null, ""])).toEqual([{ name: "Ação", slug: "acao" }, { name: "Netflix", slug: "netflix" }]);
  });
});
describe("category type separation", () => {
  it("uses separate slugs when the same name belongs to different content types", () => {
    expect(categorySlugForKind("esportes", "channel", "catalog")).toBe("esportes-canais");
    expect(categorySlugForKind("esportes", "catalog", "channel")).toBe("esportes-catalogo");
    expect(categorySlugForKind("esportes", "catalog", "catalog")).toBe("esportes");
  });
});

describe("pool", () => {
  it("runs at most `limit` tasks at once and processes every item", async () => {
    let live = 0, peak = 0; const seen: number[] = [];
    await pool([1, 2, 3, 4, 5, 6, 7], 3, async n => { live++; peak = Math.max(peak, live); await Promise.resolve(); seen.push(n); live--; });
    expect(peak).toBe(3); expect(seen.sort()).toEqual([1, 2, 3, 4, 5, 6, 7]);
  });
});
