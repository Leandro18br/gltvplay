/* eslint-disable @typescript-eslint/no-explicit-any */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

/**
 * Reseller account administration (owner only). Resellers sign in with e-mail + password
 * through the normal auth system; passwords are never stored or returned except the one
 * generated/defined in the same operation.
 */

const email = z.string().trim().toLowerCase().email().max(254);
const password = z.string().min(10).max(72);

function genPassword() {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789!@#$%*";
  const b = new Uint32Array(16); crypto.getRandomValues(b);
  return Array.from(b, (n) => chars[n % chars.length]).join("");
}

async function requireOwner(context: any) {
  const { data: ok } = await context.supabase.rpc("is_super_admin", { _user_id: context.userId });
  if (!ok) throw new Error("Acesso negado: somente o proprietário pode gerenciar revendedores.");
}

async function requireReseller(context: any, uid: string) {
  const { data, error } = await context.supabase.from("resellers").select("user_id,status,display_name").eq("user_id", uid).maybeSingle();
  if (error || !data) throw new Error("Revendedor não encontrado.");
  if (data.status === "deleted") throw new Error("Este revendedor foi excluído.");
  return data as { user_id: string; status: string; display_name: string | null };
}

function authErr(m?: string) {
  if (!m) return "erro desconhecido";
  if (/already.*registered|already exists|email_exists/i.test(m)) return "este e-mail já está em uso por outra conta";
  if (/weak|pwned|leaked/i.test(m)) return "senha fraca ou já vazada; use outra";
  return m;
}

export const createResellerAccount = createServerFn({ method: "POST" }).middleware([requireSupabaseAuth])
  .inputValidator(z.object({
    name: z.string().trim().min(2).max(120),
    email,
    password: password.optional(),
    credits: z.number().int().min(0).max(100000).default(0),
  }))
  .handler(async ({ data, context }) => {
    await requireOwner(context);
    const sb = context.supabase as any;
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const pass = data.password ?? genPassword();
    const created = await supabaseAdmin.auth.admin.createUser({
      email: data.email, password: pass, email_confirm: true, user_metadata: { name: data.name },
    });
    if (created.error || !created.data.user) throw new Error(`Falha ao criar a conta: ${authErr(created.error?.message)}`);
    const uid = created.data.user.id;
    const up = await sb.rpc("admin_upsert_reseller", { _user_id: uid, _display_name: data.name, _status: "active" });
    if (up.error) { await supabaseAdmin.auth.admin.deleteUser(uid); throw new Error(`Falha ao registrar o revendedor: ${up.error.message}`); }
    let warning: string | undefined;
    if (data.credits > 0) {
      const adj = await sb.rpc("admin_adjust_credits", { _reseller_id: uid, _delta: data.credits, _note: "Saldo inicial no cadastro", _request_id: crypto.randomUUID() });
      if (adj.error) warning = "Revendedor criado, mas o saldo inicial não foi lançado.";
    }
    return { id: uid, email: data.email, password: pass, warning };
  });

export const updateResellerAccount = createServerFn({ method: "POST" }).middleware([requireSupabaseAuth])
  .inputValidator(z.object({ userId: z.string().uuid(), name: z.string().trim().min(2).max(120), email }))
  .handler(async ({ data, context }) => {
    await requireOwner(context);
    const r = await requireReseller(context, data.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const cur = await supabaseAdmin.auth.admin.getUserById(data.userId);
    if (cur.error || !cur.data.user) throw new Error("Conta do revendedor não encontrada.");
    if ((cur.data.user.email ?? "").toLowerCase() !== data.email) {
      const u = await supabaseAdmin.auth.admin.updateUserById(data.userId, { email: data.email, email_confirm: true });
      if (u.error) throw new Error(`Falha ao alterar o e-mail: ${authErr(u.error.message)}`);
      await (supabaseAdmin as any).from("profiles").update({ email: data.email }).eq("id", data.userId);
    }
    const up = await (context.supabase as any).rpc("admin_upsert_reseller", { _user_id: data.userId, _display_name: data.name, _status: r.status });
    if (up.error) throw new Error(up.error.message);
    return { ok: true };
  });

export const resetResellerPassword = createServerFn({ method: "POST" }).middleware([requireSupabaseAuth])
  .inputValidator(z.object({ userId: z.string().uuid(), password: password.optional() }))
  .handler(async ({ data, context }) => {
    await requireOwner(context);
    await requireReseller(context, data.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const pass = data.password ?? genPassword();
    const u = await supabaseAdmin.auth.admin.updateUserById(data.userId, { password: pass });
    if (u.error || !u.data.user) throw new Error(`Falha ao redefinir a senha: ${authErr(u.error?.message)}`);
    return { email: u.data.user.email ?? "", password: pass };
  });

/** Logical deletion: keeps clients, credit history and requests; blocks sign-in. */
export const deleteResellerAccount = createServerFn({ method: "POST" }).middleware([requireSupabaseAuth])
  .inputValidator(z.object({ userId: z.string().uuid() }))
  .handler(async ({ data, context }) => {
    await requireOwner(context);
    await requireReseller(context, data.userId);
    const d = await (context.supabase as any).rpc("admin_delete_reseller", { _user_id: data.userId });
    if (d.error) throw new Error(d.error.message);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    await supabaseAdmin.auth.admin.updateUserById(data.userId, { ban_duration: "876000h" });
    return { ok: true };
  });
