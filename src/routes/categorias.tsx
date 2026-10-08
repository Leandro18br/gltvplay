import { createFileRoute, Link } from "@tanstack/react-router";
import { useSuspenseQuery } from "@tanstack/react-query";
import { Tags } from "lucide-react";
import { categoriesQuery } from "@/lib/catalog";
import { RetryState, SiteShell, PageTitle, EmptyState } from "@/components/site/SiteShell";

export const Route = createFileRoute("/categorias")({
  loader: ({ context }) => context.queryClient.ensureQueryData(categoriesQuery),
  head: () => ({
    meta: [
      { title: "Categorias — Streaming" },
      { name: "description", content: "Navegue por categorias de filmes, séries e canais." },
      { property: "og:title", content: "Categorias — Streaming" },
      { property: "og:description", content: "Navegue por categorias de filmes, séries e canais." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
    links: [{ rel: "canonical", href: "/categorias" }],
  }),
  errorComponent: () => <RetryState title="Não foi possível carregar as categorias" />,
  notFoundComponent: () => <SiteShell><EmptyState title="Página não encontrada" /></SiteShell>,
  component: Page,
});

function Page() {
  const { data } = useSuspenseQuery(categoriesQuery);
  return (
    <SiteShell>
      <PageTitle title="Categorias" subtitle="Encontre exatamente o que você quer assistir." />
      {data.length === 0 ? <EmptyState icon={<Tags />} title="Nenhuma categoria publicada" /> : (
        <ul className="mx-auto grid max-w-[1600px] grid-cols-2 gap-3 px-4 md:grid-cols-3 md:px-10 lg:grid-cols-4">
          {data.map((c) => (
            <li key={c.id}>
              <Link to="/categoria/$slug" params={{ slug: c.slug }} className="group relative flex aspect-[16/9] items-end overflow-hidden rounded-2xl border border-border bg-gradient-to-br from-accent to-card p-4 transition hover:border-primary/50 hover:shadow-glow">
                {c.image_url && <img src={c.image_url} alt="" loading="lazy" className="absolute inset-0 h-full w-full object-cover opacity-60 transition duration-500 group-hover:scale-105" />}
                <div className="absolute inset-0 bg-fade" />
                <div className="relative min-w-0">
                  <h2 className="truncate text-lg font-semibold">{c.name}</h2>
                  {c.description && <p className="line-clamp-1 text-xs text-muted-foreground">{c.description}</p>}
                </div>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </SiteShell>
  );
}
