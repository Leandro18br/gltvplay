import { describe, expect, it } from "vitest";
import { parseBugouName } from "./bugoumods";

describe("parseBugouName", () => {
  it("separa título e ano", () => expect(parseBugouName("1883 (2021)")).toEqual({ title: "1883", year: 2021 }));
  it("sem ano mantém título", () => expect(parseBugouName("Dark")).toEqual({ title: "Dark", year: null }));
});
