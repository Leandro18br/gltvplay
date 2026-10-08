import { createFileRoute } from "@tanstack/react-router";
import { catalogListQuery } from "@/lib/catalog";
import { SiteShell, EmptyState } from "@/components/site/SiteShell";
import { CatalogPage, validateCatalogSearch } from "@/components/site/CatalogPage";

export const Route = createFileRoute("/filmes")({
  validateSearch: validateCatalogSearch,
  loaderDeps: ({ search }) => ({ genero: search.genero, ordem: search.ordem }),
  loader: ({ context, deps }) => context.queryClient.prefetchInfiniteQuery(catalogListQuery("movie", deps.genero, deps.ordem ?? "recent")),
  head: () => ({
    meta: [
      { title: "Filmes — Streaming" },
      { name: "description", content: "Catálogo completo de filmes para assistir online." },
      { property: "og:title", content: "Filmes — Streaming" },
      { property: "og:description", content: "Catálogo completo de filmes para assistir online." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
    links: [{ rel: "canonical", href: "/filmes" }],
  }),
  errorComponent: () => <SiteShell><EmptyState title="Não foi possível carregar" /></SiteShell>,
  notFoundComponent: () => <SiteShell><EmptyState title="Página não encontrada" /></SiteShell>,
  component: Page,
});

function Page() {
  const search = Route.useSearch();
  return (
    <SiteShell>
      <CatalogPage kind="movie" title="Filmes" subtitle="Explore todo o catálogo de filmes." search={search} />
    </SiteShell>
  );
}
