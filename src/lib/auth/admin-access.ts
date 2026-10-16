import type { User } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";
import { ensureSlot } from "@/lib/auth/session-vault";
import type { StaffRole } from "@/lib/admin/db";

/**
 * Single shared admin authorization check. Distinguishes "no session", "not staff" and
 * "temporary failure" so a network/RPC error is never reported as "access denied".
 * Concurrent callers share one in-flight request; a confirmed result is reused briefly for
 * the same user/token to avoid repeating the RPC on every panel navigation. The database
 * (RLS + role functions) remains the security boundary — this only drives the UI gate.
 */
export type AdminAccess =
  | { status: "ok"; user: User; role: StaffRole }
  | { status: "unauthenticated" }
  | { status: "forbidden" }
  | { status: "error"; message: string };

const STAFF = ["super_admin", "admin", "editor"];
const TTL_MS = 60_000;
let cache: { token: string; at: number; result: AdminAccess } | null = null;
let inflight: Promise<AdminAccess> | null = null;

export function clearAdminAccessCache() { cache = null; }

/** Seeds the cache right after a successful login so the gate doesn't re-query. */
export function primeAdminAccess(token: string, result: AdminAccess) {
  cache = { token, at: Date.now(), result };
}

export async function resolveRole(): Promise<{ role: string | null; error: string | null }> {
  const { data, error } = await supabase.rpc("my_role");
  return { role: (data as string | null) ?? null, error: error ? error.message : null };
}

export function roleToAccess(user: User, role: string | null): AdminAccess {
  if (role && STAFF.includes(role)) return { status: "ok", user, role: role as StaffRole };
  return { status: "forbidden" };
}

async function run(): Promise<AdminAccess> {
  await ensureSlot("admin");
  const { data } = await supabase.auth.getSession(); // waits for initial session hydration
  const session = data.session;
  if (!session) return { status: "unauthenticated" };
  if (cache && cache.token === session.access_token && Date.now() - cache.at < TTL_MS) return cache.result;
  const { role, error } = await resolveRole();
  if (error) {
    if (/jwt|token|401|not authenticated/i.test(error)) return { status: "unauthenticated" };
    return { status: "error", message: error };
  }
  if (!role || role === null) return { status: "unauthenticated" };
  const result = roleToAccess(session.user, role);
  if (result.status !== "error") cache = { token: session.access_token, at: Date.now(), result };
  return result;
}

export function checkAdminAccess(): Promise<AdminAccess> {
  if (!inflight) inflight = run().catch((e) => ({ status: "error", message: e instanceof Error ? e.message : String(e) }) as AdminAccess).finally(() => { inflight = null; });
  return inflight;
}
