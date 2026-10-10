/* eslint-disable @typescript-eslint/no-explicit-any */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

/** Creates a separate sign-in account for a reseller. Main administrator only. */
export const createResellerAccount = createServerFn({ method: "POST" }).middleware([requireSupabaseAuth])
  .inputValidator(z.object({
    name: z.string().trim().min(2).max(120),
    email: z.string().trim().toLowerCase().email().max(255),
    password: z.string().min(8).max(72),
    credits: z.number().int().min(0).max(100000).default(0),
  }))
  .handler(async ({ data, context }) => {
    const sb = context.supabase as any;
    const { data: ok } = await sb.rpc("is_super_admin", { _user_id: context.userId });
    if (!ok) throw new Error("Acesso negado");
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const created = await supabaseAdmin.auth.admin.createUser({
      email: data.email, password: data.password, email_confirm: true, user_metadata: { name: data.name },
    });
    if (created.error || !created.data.user) {
      const m = created.error?.message ?? "";
      throw new Error(/already|exists|registered/i.test(m) ? "Este e-mail já está cadastrado." : "Não foi possível criar a conta do revendedor.");
    }
    const uid = created.data.user.id;
    const up = await sb.rpc("admin_upsert_reseller", { _user_id: uid, _display_name: data.name, _status: "active" });
    if (up.error) {
      await supabaseAdmin.auth.admin.deleteUser(uid);
      throw new Error("Não foi possível registrar o revendedor.");
    }
    if (data.credits > 0) {
      const adj = await sb.rpc("admin_adjust_credits", { _reseller_id: uid, _delta: data.credits, _note: "Saldo inicial no cadastro", _request_id: crypto.randomUUID() });
      if (adj.error) return { id: uid, warning: "Revendedor criado, mas o saldo inicial não foi lançado." };
    }
    return { id: uid };
  });
