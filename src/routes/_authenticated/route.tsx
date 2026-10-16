import { createFileRoute, Outlet, redirect } from "@tanstack/react-router";
import { getAreaClient } from "@/lib/auth/area-client";
const supabase = getAreaClient("client");
import { ensureSlot } from "@/lib/auth/session-vault";

export const Route = createFileRoute("/_authenticated")({
  ssr: false,
  head: () => ({ meta: [{ name: "robots", content: "noindex, nofollow" }] }),
  beforeLoad: async ({ location }) => {
    await ensureSlot("client");
    const { data, error } = await supabase.auth.getUser();
    if (error || !data.user) throw redirect({ to: "/auth", search: { redirect: location.href, mode: undefined } });
    return { user: data.user };
  },
  component: () => <Outlet />,
});
