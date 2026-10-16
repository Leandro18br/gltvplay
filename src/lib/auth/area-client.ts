import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import { supabase as clientAreaSupabase } from "@/integrations/supabase/client";

/**
 * Independent auth sessions per area. The public site (clients) keeps the generated client
 * and its storage; the admin and reseller panels each get their own browser client with a
 * distinct storage key, so signing in/out, token refresh and expiry in one area never touch
 * another. Server-side authorization (RLS, role RPCs, requireSupabaseAuth) is unchanged:
 * each request carries only the token of the area that made it.
 */
export type Area = "client" | "admin" | "reseller";
type DB = SupabaseClient<Database>;

const STORAGE_KEY: Record<Exclude<Area, "client">, string> = {
  admin: "gltv-auth-admin",
  reseller: "gltv-auth-reseller",
};
const clients: Partial<Record<Area, DB>> = {};

function shimFetch(key: string): typeof fetch {
  return (input, init) => {
    const headers = new Headers(typeof Request !== "undefined" && input instanceof Request ? input.headers : undefined);
    if (init?.headers) new Headers(init.headers).forEach((v, k) => headers.set(k, v));
    if ((key.startsWith("sb_publishable_") || key.startsWith("sb_secret_")) && headers.get("Authorization") === `Bearer ${key}`) headers.delete("Authorization");
    headers.set("apikey", key);
    return fetch(input, { ...init, headers });
  };
}

export function getAreaClient(area: Area): DB {
  if (area === "client" || typeof window === "undefined") return clientAreaSupabase as unknown as DB;
  const existing = clients[area];
  if (existing) return existing;
  const url = import.meta.env["VITE_SUPABASE_URL"] as string;
  const key = import.meta.env["VITE_SUPABASE_PUBLISHABLE_KEY"] as string;
  const c = createClient<Database>(url, key, {
    global: { fetch: shimFetch(key) },
    auth: { storage: window.localStorage, storageKey: STORAGE_KEY[area], persistSession: true, autoRefreshToken: true, detectSessionInUrl: false },
  });
  clients[area] = c;
  return c;
}

export function areaForPath(pathname: string): Area {
  if (/^\/admin(\/|$)/.test(pathname)) return "admin";
  if (/^\/revendedor(\/|$)/.test(pathname)) return "reseller";
  return "client";
}

export function currentArea(): Area {
  return typeof window === "undefined" ? "client" : areaForPath(window.location.pathname);
}

/**
 * Drop-in client for code that runs inside an already-rendered page (queries, mutations,
 * realtime). Route guards must use getAreaClient(area) explicitly, because during a
 * navigation the URL may still belong to the previous area.
 */
export const supabase = new Proxy({} as DB, {
  get(_, prop) {
    const c = getAreaClient(currentArea());
    const v = Reflect.get(c, prop, c);
    return typeof v === "function" ? v.bind(c) : v;
  },
});
