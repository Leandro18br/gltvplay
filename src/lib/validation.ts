import { z } from "zod";

// Shared auth validation (client-side UX; the auth service re-validates and hashes passwords server-side).
export const PASSWORD_RULES = [
  { id: "len", label: "Pelo menos 8 caracteres", test: (s: string) => s.length >= 8 },
  { id: "upper", label: "Uma letra maiúscula", test: (s: string) => /[A-Z]/.test(s) },
  { id: "lower", label: "Uma letra minúscula", test: (s: string) => /[a-z]/.test(s) },
  { id: "num", label: "Um número", test: (s: string) => /\d/.test(s) },
] as const;

export const isStrongPassword = (s: string) => PASSWORD_RULES.every((r) => r.test(s)) && s.length <= 72;

export const emailSchema = z.string().trim().min(1, "Informe seu e-mail").max(255, "E-mail muito longo").email("E-mail inválido");

export const passwordSchema = z
  .string()
  .min(1, "Informe uma senha")
  .max(72, "Senha muito longa")
  .refine(isStrongPassword, "A senha precisa ter 8+ caracteres, maiúscula, minúscula e número");

export const nameSchema = z
  .string()
  .trim()
  .min(2, "Informe seu nome (mín. 2 letras)")
  .max(80, "Nome muito longo")
  .refine((s) => !/[<>{}]/.test(s), "O nome contém caracteres inválidos");

export const signUpSchema = z
  .object({ name: nameSchema, email: emailSchema, password: passwordSchema, confirm: z.string() })
  .refine((d) => d.password === d.confirm, { path: ["confirm"], message: "As senhas não coincidem" });

export const signInSchema = z.object({ email: emailSchema, password: z.string().min(1, "Informe sua senha") });

export const newPasswordSchema = z
  .object({ password: passwordSchema, confirm: z.string() })
  .refine((d) => d.password === d.confirm, { path: ["confirm"], message: "As senhas não coincidem" });

export function fieldErrors(err: z.ZodError) {
  const out: Record<string, string> = {};
  for (const i of err.issues) {
    const k = String(i.path[0] ?? "form");
    if (!out[k]) out[k] = i.message;
  }
  return out;
}

export function authErrorMessage(raw: string) {
  if (/invalid login credentials/i.test(raw)) return "E-mail ou senha incorretos.";
  if (/email not confirmed/i.test(raw)) return "Confirme seu e-mail pelo link que enviamos antes de entrar.";
  if (/already registered|already exists/i.test(raw)) return "Este e-mail já está cadastrado. Faça login ou recupere sua senha.";
  if (/pwned|weak|compromised|leaked/i.test(raw)) return "Esta senha apareceu em vazamentos públicos. Escolha outra.";
  if (/rate limit|too many|security purposes/i.test(raw)) return "Muitas tentativas. Aguarde alguns instantes e tente novamente.";
  if (/current password/i.test(raw)) return "Senha atual incorreta ou não informada.";
  if (/same.*password|different from the old/i.test(raw)) return "A nova senha precisa ser diferente da atual.";
  if (/fetch|network/i.test(raw)) return "Sem conexão. Verifique sua internet.";
  return raw || "Algo deu errado. Tente novamente.";
}
