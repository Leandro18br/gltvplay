import { describe, expect, it, vi } from "vitest";
vi.mock("@/integrations/supabase/client", () => ({ supabase: {} }));
import { clampPage, pageCount, PAGE_SIZE } from "./catalog";
describe("public catalog pages", () => {
  it("uses 24 titles per page and counts pages from the filtered total", () => {
    expect(PAGE_SIZE).toBe(24);
    expect(pageCount(5542)).toBe(231);
    expect(pageCount(24)).toBe(1);
    expect(pageCount(25)).toBe(2);
    expect(pageCount(0)).toBe(1);
  });
  it("keeps the requested page inside the valid range", () => {
    expect(clampPage(0, 5)).toBe(1);
    expect(clampPage(9, 5)).toBe(5);
  });
});
