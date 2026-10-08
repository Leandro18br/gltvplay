import { createFileRoute } from "@tanstack/react-router";
import { catalogListQuery } from "@/lib/catalog";
import { SiteShell, EmptyState } from "@/components/site/SiteShell";
import { CatalogPage, validateCatalogSearch } from "@/components/site/CatalogPage";

export const Route = createFileRoute("/canais")({
  validateSearch: validateCatalogSearch,
  loaderDeps: ({ search }) => ({ genero: search.genero, ordem: search.ordem }),
  loader: ({ context, deps }) => context.queryClient.prefetchInfiniteQuery(catalogListQuery("channel", deps.genero, deps.ordem ?? "recent")),
  head: () => ({
    meta: [
      { title: "Canais ao vivo — Streaming" },
      { name: "description", content: "Assista canais ao vivo com transmissão autorizada." },
      { property: "og:title", content: "Canais ao vivo — Streaming" },
      { property: "og:description", content: "Assista canais ao vivo com transmissão autorizada." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
    links: [{ rel: "canonical", href: "/canais" }],
  }),
  errorComponent: () => <SiteShell><EmptyState title="Não foi possível carregar" /></SiteShell>,
  notFoundComponent: () => <SiteShell><EmptyState title="Página não encontrada" /></SiteShell>,
  component: Page,
});

function Page() {
  const search = Route.useSearch();
  return (
    <SiteShell>
      <CatalogPage kind="channel" title="Canais ao vivo" subtitle="Programação ao vivo, 24 horas." search={search} />
    </SiteShell>
  );
}
