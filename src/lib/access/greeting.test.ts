import { describe, it, expect } from "vitest";
import { greetingFor } from "./greeting";

describe("greetingFor", () => {
  it("male name", () => expect(greetingFor("João Silva")).toBe("Bem-vindo, João!"));
  it("female name", () => expect(greetingFor("Maria")).toBe("Bem-vinda, Maria!"));
  it("unknown name is neutral", () => expect(greetingFor("Kai")).toBe("Olá, Kai!"));
  it("empty name is generic", () => expect(greetingFor("  ")).toBe("Bem-vindo(a)!"));
  it("null name is generic", () => expect(greetingFor(null)).toBe("Bem-vindo(a)!"));
});
