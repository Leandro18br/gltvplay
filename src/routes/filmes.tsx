import { requireSiteAccess } from "@/lib/access/gate";
import { createFileRoute } from "@tanstack/react-router";
import { RetryState, SiteShell, EmptyState } from "@/components/site/SiteShell";
import { CatalogPage, catalogPagedQuery, validateCatalogSearch } from "@/components/site/CatalogPage";

export const Route = createFileRoute("/filmes")({
  ssr: false,
  beforeLoad: requireSiteAccess,
  validateSearch: validateCatalogSearch,
  loaderDeps: ({ search }) => ({ genero: search.genero, ordem: search.ordem, pagina: search.pagina }),
  loader: ({ context, deps }) => context.queryClient.ensureQueryData(catalogPagedQuery("movie", deps)),
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
  errorComponent: () => <RetryState title="Não foi possível carregar" />,
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
