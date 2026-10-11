import { describe, expect, it } from "vitest";
import { liveVipLink, nextCursor, parseCategoryPage, parseHomeCategories } from "./catalog-pages";

describe("paginated provider catalog", () => {
  it("walks every page of a category before moving on (no 50-item stop)", () => {
    expect(nextCursor(0, 1, 14)).toEqual({ ci: 0, page: 2 });
    expect(nextCursor(0, 14, 14)).toEqual({ ci: 1, page: 1 });
  });
  it("reads total/pages from a category page", () => {
    const p = parseCategoryPage({ success: true, total: 823, pages: 14, page: 2, items: [{ name: "#blackAF (2020)", series_id: "4453", cover: "http://x/y.jpg" }] }, "series");
    expect(p.total).toBe(823); expect(p.pages).toBe(14); expect(p.items[0]?.id).toBe("4453");
  });
  it("rejects provider errors instead of returning an empty page", () => {
    expect(() => parseCategoryPage({ success: false, msg: "PIN" }, "live")).toThrow();
  });
  it("keeps category ids and drops duplicates", () => {
    expect(parseHomeCategories({ categories: { series: [{ category_id: "1", category_name: "A", count: 827 }, { category_id: "1", category_name: "A" }] } }, "series")).toEqual([{ id: "1", name: "A", count: 827 }]);
  });
  it("builds the VIP live link in the provider's exact format", () => {
    expect(liveVipLink("https://cinema.bugoumods.com", { id: "1", name: "PT - A Bola", ext: "ts", image: "https://i/a.png" }, "T")).toBe("https://cinema.bugoumods.com/?play=1&type=live_streams&id=1&ext=ts&name=PT%20-%20A%20Bola&img=https%3A%2F%2Fi%2Fa.png&vtoken=T&embed=vip");
  });
});
