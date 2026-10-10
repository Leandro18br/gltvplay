/* eslint-disable @typescript-eslint/no-explicit-any */
import { createClient } from "@supabase/supabase-js";
import { getRequestHeader } from "@tanstack/react-start/server";

export async function sha256(s: string) {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

export function randomSecret() {
  const b = new Uint8Array(32); crypto.getRandomValues(b);
  return btoa(String.fromCharCode(...b));
}

export function clientIp() {
  return getRequestHeader("cf-connecting-ip") ?? getRequestHeader("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown";
}

/**
 * Rotates the internal account's random password and signs it in, returning session tokens.
 * Numeric codes are verified separately in the database; the internal password is never shown.
 */
export async function mintSession(uid: string) {
  const url = process.env["SUPABASE_URL"]; const key = process.env["SUPABASE_PUBLISHABLE_KEY"];
  if (!url || !key) throw new Error("Serviço indisponível");
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const secret = randomSecret();
  const u = await supabaseAdmin.auth.admin.updateUserById(uid, { password: secret });
  if (u.error || !u.data.user?.email) throw new Error("Não foi possível iniciar a sessão.");
  const pub = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { fetch: (input, init) => { const h = new Headers(init?.headers); if (key.startsWith("sb_") && h.get("Authorization") === `Bearer ${key}`) h.delete("Authorization"); h.set("apikey", key); return fetch(input, { ...init, headers: h }); } },
  });
  const s = await pub.auth.signInWithPassword({ email: u.data.user.email, password: secret });
  if (s.error || !s.data.session) throw new Error("Não foi possível iniciar a sessão.");
  return { access_token: s.data.session.access_token, refresh_token: s.data.session.refresh_token };
}

export async function adminDb() {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  return supabaseAdmin as any;
}
