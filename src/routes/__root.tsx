import { QueryClient, QueryClientProvider, useQueryClient } from "@tanstack/react-query";
import {
  Outlet,
  Link,
  createRootRouteWithContext,
  useRouter,
  HeadContent,
  Scripts,
  type ErrorComponentProps,
} from "@tanstack/react-router";
import { useEffect, type ReactNode } from "react";

import appCss from "../styles.css?url";
import { reportLovableError } from "../lib/lovable-error-reporting";
import { supabase } from "@/integrations/supabase/client";
import { Toaster } from "@/components/ui/sonner";
import { useQuery } from "@tanstack/react-query";
import { siteSettingsQuery } from "@/lib/catalog";
import { checkSiteAccess, clearSiteAccessCache } from "@/lib/access/gate";
import { syncSlots, isSwapping } from "@/lib/auth/session-vault";

// Admin → site sync: the database is the single source of truth. Realtime change events
// (plus a periodic safety refresh) invalidate cached catalog reads so the public site re-queries.
function CatalogSync() {
  const qc = useQueryClient();
  useEffect(() => {
    let t: ReturnType<typeof setTimeout> | undefined;
    const bump = () => {
      clearTimeout(t);
      t = setTimeout(() => {
        qc.invalidateQueries({ queryKey: ["catalog"] });
        qc.invalidateQueries({ queryKey: ["site_settings"] });
        qc.invalidateQueries({ queryKey: ["player"] });
      }, 400);
    };
    const ch = supabase.channel("catalog-sync");
    for (const table of ["movies", "series", "seasons", "episodes", "channels", "categories", "genres", "banners", "site_settings", "home_layouts", "playback_sources", "embed_domains"]) {
      ch.on("postgres_changes", { event: "*", schema: "public", table }, bump);
    }
    ch.subscribe();
    const iv = setInterval(() => { if (document.visibilityState === "visible") bump(); }, 120_000);
    return () => { clearTimeout(t); clearInterval(iv); supabase.removeChannel(ch); };
  }, [qc]);
  return null;
}

function SettingsSync() {
  const { data } = useQuery(siteSettingsQuery);
  useEffect(() => {
    if (!data) return;
    const root = document.documentElement.style;
    // Keep the global brand palette fixed; site settings may still control the favicon.
    root.setProperty("--primary", "#00DDFA");
    root.setProperty("--ring", "#00DDFA");
    root.setProperty("--background", "#000000");
    if (data.favicon_url) {
      let link = document.querySelector<HTMLLinkElement>("link[rel='icon']");
      if (!link) { link = document.createElement("link"); link.rel = "icon"; document.head.appendChild(link); }
      link.href = data.favicon_url;
    }
  }, [data]);
  return null;
}

function NotFoundComponent() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="max-w-md text-center">
        <h1 className="text-7xl font-bold text-foreground">404</h1>
        <h2 className="mt-4 text-xl font-semibold text-foreground">Page not found</h2>
        <p className="mt-2 text-sm text-muted-foreground">
          The page you're looking for doesn't exist or has been moved.
        </p>
        <div className="mt-6">
          <Link
            to="/"
            className="inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
          >
            Go home
          </Link>
        </div>
      </div>
    </div>
  );
}

function ErrorComponent({ error, reset }: ErrorComponentProps) {
  console.error(error);
  const router = useRouter();
  useEffect(() => {
    reportLovableError(error, { boundary: "tanstack_root_error_component" });
  }, [error]);

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="max-w-md text-center">
        <h1 className="text-xl font-semibold tracking-tight text-foreground">
          This page didn't load
        </h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Something went wrong on our end. You can try refreshing or head back home.
        </p>
        <div className="mt-6 flex flex-wrap justify-center gap-2">
          <button
            onClick={() => {
              router.invalidate();
              reset();
            }}
            className="inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
          >
            Try again
          </button>
          <a
            href="/"
            className="inline-flex items-center justify-center rounded-md border border-input bg-background px-4 py-2 text-sm font-medium text-foreground transition-colors hover:bg-accent"
          >
            Go home
          </a>
        </div>
      </div>
    </div>
  );
}

export const Route = createRootRouteWithContext<{ queryClient: QueryClient }>()({
  head: () => ({
    meta: [
      { charSet: "utf-8" },
      { name: "viewport", content: "width=device-width, initial-scale=1" },
      { title: "GLTV Play" },
      { name: "description", content: "Plataforma de streaming de filmes, séries e canais." },
    ],
    links: [
      {
        rel: "stylesheet",
        href: appCss,
      },
      { rel: "icon", href: "/favicon.ico", type: "image/x-icon" },
      { rel: "preconnect", href: "https://fonts.googleapis.com" },
      { rel: "preconnect", href: "https://fonts.gstatic.com", crossOrigin: "anonymous" },
      { rel: "stylesheet", href: "https://fonts.googleapis.com/css2?family=Maven+Pro:wght@400;500;600;700;800&display=swap" },
    ],
  }),
  shellComponent: RootShell,
  component: RootComponent,
  notFoundComponent: NotFoundComponent,
  errorComponent: ErrorComponent,
});

function RootShell({ children }: { children: ReactNode }) {
  return (
    <html lang="pt-BR">
      <head>
        <HeadContent />
      </head>
      <body>
        {children}
        <Scripts />
      </body>
    </html>
  );
}

function RootComponent() {
  const { queryClient } = Route.useRouteContext();
  const router = useRouter();

  useEffect(() => {
    const { data } = supabase.auth.onAuthStateChange((event, session) => {
      if (event === "TOKEN_REFRESHED" || event === "SIGNED_IN" || event === "USER_UPDATED") syncSlots(session);
      if (isSwapping()) { clearSiteAccessCache(); return; }
      if (event !== "SIGNED_IN" && event !== "SIGNED_OUT" && event !== "USER_UPDATED") return;
      clearSiteAccessCache();
      if (event === "SIGNED_IN") {
        const dest = sessionStorage.getItem("post_auth_redirect");
        if (dest && dest.startsWith("/") && !dest.startsWith("//")) { sessionStorage.removeItem("post_auth_redirect"); router.navigate({ to: dest }); }
      }
      router.invalidate();
      if (event !== "SIGNED_OUT") queryClient.invalidateQueries();
      else queryClient.clear();
    });
    // Expired or revoked accesses lose the catalog without waiting for a navigation.
    const iv = setInterval(async () => {
      if (document.visibilityState !== "visible") return;
      const p = window.location.pathname;
      if (/^\/(admin|revend|auth|reset-password)/.test(p)) return;
      if (!(await checkSiteAccess(true))) { queryClient.removeQueries({ queryKey: ["catalog"] }); router.invalidate(); }
    }, 60_000);
    return () => { data.subscription.unsubscribe(); clearInterval(iv); };
  }, [router, queryClient]);

  return (
    <QueryClientProvider client={queryClient}>
      {/* Required: nested routes render here. Removing <Outlet /> breaks all child routes. */}
      <SettingsSync />
      <CatalogSync />
      <Outlet />
      <Toaster />
    </QueryClientProvider>
  );
}
