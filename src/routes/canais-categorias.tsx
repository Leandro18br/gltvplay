import { requireSiteAccess } from "@/lib/access/gate";
import { createFileRoute, Link, Outlet, useRouterState } from "@tanstack/react-router";
import { useSuspenseQuery } from "@tanstack/react-query";
import { MonitorPlay } from "lucide-react";
import { kindCategoriesQuery } from "@/lib/catalog";
import { RetryState, SiteShell, PageTitle, EmptyState } from "@/components/site/SiteShell";

export const Route = createFileRoute("/canais-categorias")({
  ssr: false,
  beforeLoad: requireSiteAccess,
  loader: ({ context }) => context.queryClient.ensureQueryData(kindCategoriesQuery(["channel"])),
  head: () => ({
    meta: [
      { title: "Categorias de canais — Streaming" },
      { name: "description", content: "Navegue pelas categorias de canais ao vivo." },
      { property: "og:title", content: "Categorias de canais — Streaming" },
      { property: "og:description", content: "Navegue pelas categorias de canais ao vivo." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
    links: [{ rel: "canonical", href: "/canais-categorias" }],
  }),
  errorComponent: () => <RetryState title="Não foi possível carregar as categorias de canais" />,
  notFoundComponent: () => <SiteShell><EmptyState title="Página não encontrada" /></SiteShell>,
  component: Page,
});

function Page() {
  const pathname = useRouterState({ select: (state) => state.location.pathname });
  const { data } = useSuspenseQuery(kindCategoriesQuery(["channel"]));

  // This file route is also the layout parent of /canais-categorias/$slug.
  // Render the child route instead of keeping the category grid mounted over it.
  if (pathname !== "/canais-categorias" && pathname !== "/canais-categorias/") {
    return <Outlet />;
  }

  return (
    <SiteShell>
      <PageTitle title="Categorias de canais" subtitle="Escolha uma categoria e assista aos canais ao vivo." />
      {data.length === 0 ? <EmptyState icon={<MonitorPlay />} title="Nenhuma categoria de canais publicada" /> : (
        <ul className="mx-auto grid max-w-[1600px] grid-cols-2 gap-3 px-4 md:grid-cols-3 md:px-10 lg:grid-cols-4">
          {data.map((c) => (
            <li key={c.id}>
              <Link to="/canais-categorias/$slug" params={{ slug: c.slug }} className="group relative flex aspect-[16/9] items-center justify-center overflow-hidden rounded-2xl border border-border bg-gradient-to-br from-accent to-card p-4 text-center transition hover:border-primary/70 hover:shadow-glow focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:ring-offset-background active:scale-[0.99]">
                {c.image_url && <img src={c.image_url} alt="" loading="lazy" className="absolute inset-0 h-full w-full object-cover opacity-60 transition duration-500 group-hover:scale-105" />}
                <div className="absolute inset-0 bg-fade" />
                <div className="relative z-10 flex min-w-0 w-full items-center justify-center">
                  <h2 className="max-w-full whitespace-normal break-words text-center text-lg font-semibold leading-snug">{c.name}</h2>
                </div>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </SiteShell>
  );
}
