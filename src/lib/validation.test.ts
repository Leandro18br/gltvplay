import { describe, expect, it } from "vitest";
import { isStrongPassword, signUpSchema } from "./validation";

describe("senha segura", () => {
  it("rejeita senha com menos de 8 caracteres", () => expect(isStrongPassword("Ab1cdef")).toBe(false));
  it("rejeita senha sem número", () => expect(isStrongPassword("Abcdefgh")).toBe(false));
  it("rejeita senha sem maiúscula", () => expect(isStrongPassword("abcdefg1")).toBe(false));
  it("aceita senha com 8+ caracteres, maiúscula, minúscula e número", () => expect(isStrongPassword("Abcdefg1")).toBe(true));
});

describe("cadastro", () => {
  const ok = { name: "Ana", email: "ana@exemplo.com", password: "Abcdefg1", confirm: "Abcdefg1" };
  it("aceita dados válidos", () => expect(signUpSchema.safeParse(ok).success).toBe(true));
  it("exige confirmação igual à senha", () => expect(signUpSchema.safeParse({ ...ok, confirm: "Abcdefg2" }).success).toBe(false));
  it("rejeita e-mail inválido", () => expect(signUpSchema.safeParse({ ...ok, email: "ana@" }).success).toBe(false));
  it("exige nome", () => expect(signUpSchema.safeParse({ ...ok, name: " " }).success).toBe(false));
});
