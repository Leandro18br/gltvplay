/* eslint-disable @typescript-eslint/no-explicit-any */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

/**
 * Creates a reseller with an internal sign-in account and numeric 6-digit credentials.
 * Main administrator only. The plain password is returned once and stored only as a hash.
 */
export const createResellerAccount = createServerFn({ method: "POST" }).middleware([requireSupabaseAuth])
  .inputValidator(z.object({
    name: z.string().trim().min(2).max(120),
    credits: z.number().int().min(0).max(100000).default(0),
  }))
  .handler(async ({ data, context }) => {
    const sb = context.supabase as any;
    const { data: ok } = await sb.rpc("is_super_admin", { _user_id: context.userId });
    if (!ok) throw new Error("Acesso negado: somente o proprietário pode criar revendedores.");
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { randomSecret } = await import("@/lib/access/session.server");
    const email = `revenda-${crypto.randomUUID()}@revendedores.invalid`;
    const created = await supabaseAdmin.auth.admin.createUser({
      email, password: randomSecret(), email_confirm: true, user_metadata: { name: data.name },
    });
    if (created.error || !created.data.user) throw new Error(`Falha ao criar a conta: ${created.error?.message ?? "erro desconhecido"}`);
    const uid = created.data.user.id;
    const up = await sb.rpc("admin_upsert_reseller", { _user_id: uid, _display_name: data.name, _status: "active" });
    if (up.error) { await supabaseAdmin.auth.admin.deleteUser(uid); throw new Error(`Falha ao registrar o revendedor: ${up.error.message}`); }
    const cred = await sb.rpc("issue_reseller_login", { _user_id: uid });
    if (cred.error) {
      await supabaseAdmin.auth.admin.deleteUser(uid);
      throw new Error(`Falha ao gerar as credenciais: ${cred.error.message}`);
    }
    let warning: string | undefined;
    if (data.credits > 0) {
      const adj = await sb.rpc("admin_adjust_credits", { _reseller_id: uid, _delta: data.credits, _note: "Saldo inicial no cadastro", _request_id: crypto.randomUUID() });
      if (adj.error) warning = "Revendedor criado, mas o saldo inicial não foi lançado.";
    }
    const c = cred.data as { login: string; password: string };
    return { id: uid, login: c.login, password: c.password, warning };
  });

/** Issues new numeric credentials (new password; keeps login) for an existing reseller. Owner only. */
export const resetResellerLogin = createServerFn({ method: "POST" }).middleware([requireSupabaseAuth])
  .inputValidator(z.object({ userId: z.string().uuid() }))
  .handler(async ({ data, context }) => {
    const r = await (context.supabase as any).rpc("issue_reseller_login", { _user_id: data.userId });
    if (r.error) throw new Error(/forbidden/.test(r.error.message) ? "Acesso negado." : r.error.message);
    return r.data as { login: string; password: string };
  });

const RESELLER_REASONS: Record<string, string> = {
  invalid: "Usuário ou senha incorretos.",
  blocked: "Esta conta de revendedor está bloqueada. Fale com o administrador.",
};

/** Reseller sign-in with 6-digit user/password; repeated failures lock for 15 minutes. */
export const resellerLogin = createServerFn({ method: "POST" })
  .inputValidator(z.object({ login: z.string().regex(/^\d{6}$/), password: z.string().regex(/^\d{6}$/) }))
  .handler(async ({ data }) => {
    const { adminDb, sha256, clientIp, mintSession } = await import("@/lib/access/session.server");
    const db = await adminDb();
    const ipHash = await sha256(`reseller-login:${clientIp()}`);
    const key = `r:${data.login}`;
    const lock = await db.rpc("access_login_lock", { _login: key, _ip_hash: ipHash });
    if (lock.error) throw new Error("Serviço indisponível. Tente novamente.");
    if ((lock.data ?? 0) > 0) return { ok: false as const, message: `Muitas tentativas. Tente novamente em ${Math.ceil(lock.data / 60)} min.` };
    const v = await db.rpc("verify_reseller_login", { _login: data.login, _password: data.password });
    if (v.error) throw new Error("Serviço indisponível. Tente novamente.");
    const res = v.data as { ok: boolean; reason?: string; user_id?: string };
    await db.from("access_login_attempts").insert({ login: key, ip_hash: ipHash, success: !!res.ok });
    if (!res.ok || !res.user_id) return { ok: false as const, message: RESELLER_REASONS[res.reason ?? "invalid"] ?? RESELLER_REASONS["invalid"]! };
    const tokens = await mintSession(res.user_id);
    return { ok: true as const, ...tokens };
  });
