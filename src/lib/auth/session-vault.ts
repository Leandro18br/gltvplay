import { getAreaClient, type Area } from "@/lib/auth/area-client";

/**
 * Area sessions are now stored by independent auth clients (see area-client.ts). This module
 * keeps the previous API: ensureSlot migrates a legacy saved session once, signOutSlot ends
 * only that area's session through the official sign-out (revokes that session server-side).
 */
export type Slot = Area;
const LEGACY = (s: Slot) => `session-slot:${s}`;

export const isSwapping = () => false;
export function syncSlots(_session: unknown) { /* sessions no longer shared */ }
export async function claimSlot(_slot: Slot) { /* each area client persists its own session */ }

const migrated = new Set<Slot>();
export async function ensureSlot(slot: Slot) {
  if (typeof window === "undefined" || migrated.has(slot)) return;
  migrated.add(slot);
  const raw = localStorage.getItem(LEGACY(slot));
  if (!raw) return;
  localStorage.removeItem(LEGACY(slot));
  if (slot === "client") return; // the client area already owns the original storage
  try {
    const saved = JSON.parse(raw) as { access_token: string; refresh_token: string };
    const c = getAreaClient(slot);
    const { data } = await c.auth.getSession();
    if (!data.session) await c.auth.setSession({ access_token: saved.access_token, refresh_token: saved.refresh_token });
  } catch { /* invalid legacy entry: area must sign in again */ }
}

export async function signOutSlot(slot: Slot) {
  await getAreaClient(slot).auth.signOut({ scope: "local" });
}
