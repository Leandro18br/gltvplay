import { createFileRoute } from "@tanstack/react-router";
import { catalogListQuery } from "@/lib/catalog";
import { RetryState, SiteShell, EmptyState } from "@/components/site/SiteShell";
import { CatalogPage, validateCatalogSearch } from "@/components/site/CatalogPage";

export const Route = createFileRoute("/series")({
  validateSearch: validateCatalogSearch,
  loaderDeps: ({ search }) => ({ genero: search.genero, ordem: search.ordem }),
  loader: ({ context, deps }) => context.queryClient.ensureInfiniteQueryData(catalogListQuery("series", deps.genero, deps.ordem ?? "recent")),
  head: () => ({
    meta: [
      { title: "Séries — Streaming" },
      { name: "description", content: "Catálogo completo de séries com temporadas e episódios." },
      { property: "og:title", content: "Séries — Streaming" },
      { property: "og:description", content: "Catálogo completo de séries com temporadas e episódios." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
    links: [{ rel: "canonical", href: "/series" }],
  }),
  errorComponent: () => <RetryState title="Não foi possível carregar" />,
  notFoundComponent: () => <SiteShell><EmptyState title="Página não encontrada" /></SiteShell>,
  component: Page,
});

function Page() {
  const search = Route.useSearch();
  return (
    <SiteShell>
      <CatalogPage kind="series" title="Séries" subtitle="Maratone temporadas completas." search={search} />
    </SiteShell>
  );
}
