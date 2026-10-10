/* eslint-disable @typescript-eslint/no-explicit-any */
import { createServerFn } from "@tanstack/react-start";
import { getRequestHeader } from "@tanstack/react-start/server";
import { createClient } from "@supabase/supabase-js";
import { z } from "zod";

const REASONS: Record<string, string> = {
  invalid: "Login ou senha incorretos.",
  expired: "Este acesso está vencido. Fale com seu revendedor para renovar.",
  suspended: "Este acesso está bloqueado. Fale com seu revendedor.",
  revoked: "Este acesso foi cancelado.",
  reseller_blocked: "Este acesso está temporariamente indisponível. Fale com seu revendedor.",
};

async function sha256(s: string) {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, "0")).join("");
}
function randomSecret() {
  const b = new Uint8Array(32); crypto.getRandomValues(b);
  return btoa(String.fromCharCode(...b));
}

/**
 * Client login with the 6-digit access codes. Credentials are verified against the
 * bcrypt hash in the database; on success a session for the access's own internal
 * account is returned. Repeated failures lock the login/IP for 15 minutes.
 */
export const accessLogin = createServerFn({ method: "POST" })
  .inputValidator(z.object({ login: z.string().regex(/^\d{6}$/), password: z.string().regex(/^\d{6}$/) }))
  .handler(async ({ data }) => {
    const url = process.env["SUPABASE_URL"]; const key = process.env["SUPABASE_PUBLISHABLE_KEY"];
    if (!url || !key) throw new Error("Serviço indisponível");
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const db = supabaseAdmin as any;
    const ip = getRequestHeader("cf-connecting-ip") ?? getRequestHeader("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown";
    const ipHash = await sha256(`access-login:${ip}`);

    const lock = await db.rpc("access_login_lock", { _login: data.login, _ip_hash: ipHash });
    if (lock.error) throw new Error("Serviço indisponível. Tente novamente.");
    if ((lock.data ?? 0) > 0) {
      return { ok: false as const, message: `Muitas tentativas. Tente novamente em ${Math.ceil(lock.data / 60)} min.` };
    }

    const v = await db.rpc("verify_access_login", { _login: data.login, _password: data.password });
    if (v.error) throw new Error("Serviço indisponível. Tente novamente.");
    const res = v.data as { ok: boolean; reason?: string; access_id?: string };
    await db.from("access_login_attempts").insert({ login: data.login, ip_hash: ipHash, success: !!res.ok });
    if (!res.ok) return { ok: false as const, message: REASONS[res.reason ?? "invalid"] ?? REASONS["invalid"]! };

    // Each access owns one internal account; its random password is rotated on every login.
    const { data: acc } = await db.from("access_accounts").select("id, login, auth_user_id").eq("id", res.access_id).single();
    const secret = randomSecret();
    const email = `acesso-${acc.id}@clientes.invalid`;
    let uid: string | null = acc.auth_user_id;
    if (uid) {
      const u = await supabaseAdmin.auth.admin.updateUserById(uid, { password: secret });
      if (u.error) uid = null;
    }
    if (!uid) {
      const c = await supabaseAdmin.auth.admin.createUser({ email, password: secret, email_confirm: true, user_metadata: { name: `Cliente ${acc.login}` } });
      if (c.error || !c.data.user) {
        const existing = await db.from("profiles").select("id").eq("email", email).maybeSingle();
        if (!existing.data) throw new Error("Não foi possível iniciar a sessão.");
        uid = existing.data.id as string;
        await supabaseAdmin.auth.admin.updateUserById(uid, { password: secret });
      } else uid = c.data.user.id;
      await db.from("access_accounts").update({ auth_user_id: uid }).eq("id", acc.id);
    }

    const pub = createClient(url, key, {
      auth: { persistSession: false, autoRefreshToken: false },
      global: { fetch: (input, init) => { const h = new Headers(init?.headers); if (key.startsWith("sb_") && h.get("Authorization") === `Bearer ${key}`) h.delete("Authorization"); h.set("apikey", key); return fetch(input, { ...init, headers: h }); } },
    });
    const s = await pub.auth.signInWithPassword({ email, password: secret });
    if (s.error || !s.data.session) throw new Error("Não foi possível iniciar a sessão.");
    return { ok: true as const, access_token: s.data.session.access_token, refresh_token: s.data.session.refresh_token };
  });
