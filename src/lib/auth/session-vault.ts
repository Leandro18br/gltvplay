import type { Session } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";

/**
 * One browser holds a single active auth session, but the owner, resellers and clients use
 * separate areas. Each area keeps its own session (tokens only, never passwords) in its slot;
 * entering an area restores that area's session, so signing in to one never logs out another.
 * Every guard still re-validates role/access on the server, so a slot grants nothing by itself.
 */
export type Slot = "admin" | "reseller" | "client";
type Stored = { user_id: string; access_token: string; refresh_token: string };
const KEY = (s: Slot) => `session-slot:${s}`;
const SLOTS: Slot[] = ["admin", "reseller", "client"];

let swapping = false;
export const isSwapping = () => swapping;

function read(slot: Slot): Stored | null {
  try { const v = localStorage.getItem(KEY(slot)); return v ? (JSON.parse(v) as Stored) : null; } catch { return null; }
}
function write(slot: Slot, s: Session) {
  localStorage.setItem(KEY(slot), JSON.stringify({ user_id: s.user.id, access_token: s.access_token, refresh_token: s.refresh_token }));
}
export function forgetSlot(slot: Slot) { localStorage.removeItem(KEY(slot)); }

/** Keeps every slot belonging to this user in sync with rotated tokens. */
export function syncSlots(session: Session | null) {
  if (!session || typeof window === "undefined") return;
  for (const s of SLOTS) if (read(s)?.user_id === session.user.id) write(s, session);
}

/** Records the current (already authorized) session as this area's session. */
export async function claimSlot(slot: Slot) {
  const { data } = await supabase.auth.getSession();
  if (data.session) write(slot, data.session);
}

/** Makes this area's saved session the active one, if it isn't already. */
export async function ensureSlot(slot: Slot) {
  const saved = read(slot);
  if (!saved) return;
  const { data } = await supabase.auth.getSession();
  if (data.session?.user.id === saved.user_id) return;
  swapping = true;
  try {
    const { error } = await supabase.auth.setSession({ access_token: saved.access_token, refresh_token: saved.refresh_token });
    if (error) forgetSlot(slot); // revoked or expired: this area must sign in again
  } finally { swapping = false; }
}

/** Ends only this area's session (revoked on the server) and forgets it. */
export async function signOutSlot(slot: Slot) {
  await ensureSlot(slot);
  const saved = read(slot);
  const { data } = await supabase.auth.getSession();
  forgetSlot(slot);
  if (data.session && (!saved || data.session.user.id === saved.user_id)) await supabase.auth.signOut({ scope: "local" });
}
