import { createFileRoute } from "@tanstack/react-router";
import { RetryState, SiteShell, EmptyState } from "@/components/site/SiteShell";
import { CatalogPage, catalogPagedQuery, validateCatalogSearch } from "@/components/site/CatalogPage";

export const Route = createFileRoute("/canais")({
  validateSearch: validateCatalogSearch,
  loaderDeps: ({ search }) => ({ genero: search.genero, ordem: search.ordem, pagina: search.pagina }),
  loader: ({ context, deps }) => context.queryClient.ensureQueryData(catalogPagedQuery("channel", deps)),
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
  errorComponent: () => <RetryState title="Não foi possível carregar" />,
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
