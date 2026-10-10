import { redirect } from "@tanstack/react-router";
import { supabase } from "@/integrations/supabase/client";
import { ensureSlot, claimSlot } from "@/lib/auth/session-vault";

let cache: { uid: string; ok: boolean; at: number } | null = null;
const TTL = 30_000;

export function clearSiteAccessCache() { cache = null; }

/** Server-validated check (RLS function) that the signed-in account may use the site. */
export async function checkSiteAccess(force = false): Promise<boolean> {
  if (typeof window !== "undefined") await ensureSlot("client");
  const { data } = await supabase.auth.getUser();
  const uid = data.user?.id;
  if (!uid) { cache = null; return false; }
  if (!force && cache && cache.uid === uid && Date.now() - cache.at < TTL) return cache.ok;
  const { data: ok, error } = await supabase.rpc("has_site_access", { _user_id: uid });
  const res = !error && !!ok;
  cache = { uid, ok: res, at: Date.now() };
  if (res) await claimSlot("client");
  else if (typeof window !== "undefined") sessionStorage.setItem("access_denied", "1");
  return res;
}

/** beforeLoad guard for every catalog page (use with ssr: false). */
export async function requireSiteAccess({ location }: { location: { href: string } }) {
  if (!(await checkSiteAccess())) {
    throw redirect({ to: "/auth", search: { redirect: location.href, mode: undefined } });
  }
}
