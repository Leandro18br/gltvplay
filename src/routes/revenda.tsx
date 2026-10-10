import { createFileRoute, redirect } from "@tanstack/react-router";

/** Old address of the reseller panel; kept so saved links still work. */
export const Route = createFileRoute("/revenda")({
  beforeLoad: () => { throw redirect({ to: "/revendedor/login", search: { denied: undefined } }); },
});
