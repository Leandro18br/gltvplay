import { requireSiteAccess } from "@/lib/access/gate";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useSuspenseQuery } from "@tanstack/react-query";
import { useState } from "react";
import { Tags } from "lucide-react";
import { kindCategoriesQuery } from "@/lib/catalog";
import { RetryState, SiteShell, PageTitle, EmptyState } from "@/components/site/SiteShell";

export const Route = createFileRoute("/categorias")({
  ssr: false,
  beforeLoad: requireSiteAccess,
  loader: async ({ context }) => {
    await Promise.all([
      context.queryClient.ensureQueryData(kindCategoriesQuery(["movie"])),
      context.queryClient.ensureQueryData(kindCategoriesQuery(["series"])),
    ]);
  },
  head: () => ({
    meta: [
      { title: "Categorias — Streaming" },
      { name: "description", content: "Navegue por categorias de filmes e séries." },
      { property: "og:title", content: "Categorias — Streaming" },
      { property: "og:description", content: "Navegue por categorias de filmes e séries." },
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
  const [activeKind, setActiveKind] = useState<"movie" | "series">("movie");
  const { data: movieCategories } = useSuspenseQuery(kindCategoriesQuery(["movie"]));
  const { data: seriesCategories } = useSuspenseQuery(kindCategoriesQuery(["series"]));
  const data = activeKind === "movie" ? movieCategories : seriesCategories;
  return (
    <SiteShell>
      <PageTitle title="Categorias" subtitle="Encontre exatamente o que você quer assistir." />
      <div className="mx-auto mb-6 flex w-full max-w-md gap-3 px-4" role="tablist" aria-label="Tipo de conteúdo">
        <button type="button" role="tab" aria-selected={activeKind === "movie"} onClick={() => setActiveKind("movie")} className={`min-h-11 flex-1 rounded-xl border px-5 py-3 text-sm font-semibold transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#00DDFA] ${activeKind === "movie" ? "border-[#00DDFA] bg-[#00DDFA] text-black shadow-[0_0_18px_rgba(0,221,250,0.2)]" : "border-white/20 bg-white/5 text-white hover:border-[#00DDFA]/60 hover:text-[#00DDFA]"}`}>
          Filmes
        </button>
        <button type="button" role="tab" aria-selected={activeKind === "series"} onClick={() => setActiveKind("series")} className={`min-h-11 flex-1 rounded-xl border px-5 py-3 text-sm font-semibold transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#00DDFA] ${activeKind === "series" ? "border-[#00DDFA] bg-[#00DDFA] text-black shadow-[0_0_18px_rgba(0,221,250,0.2)]" : "border-white/20 bg-white/5 text-white hover:border-[#00DDFA]/60 hover:text-[#00DDFA]"}`}>
          Séries
        </button>
      </div>
      {data.length === 0 ? <EmptyState icon={<Tags />} title={activeKind === "movie" ? "Nenhuma categoria de filme publicada" : "Nenhuma categoria de série publicada"} /> : (
        <ul className="mx-auto grid max-w-[1600px] grid-cols-2 gap-3 px-4 md:grid-cols-3 md:px-10 lg:grid-cols-4">
          {data.map((c) => (
            <li key={c.id}>
              <Link to="/categoria/$slug" params={{ slug: c.slug }} search={{ tipo: activeKind }} className="group relative flex aspect-[16/9] items-end overflow-hidden rounded-2xl border border-border bg-gradient-to-br from-accent to-card p-4 transition hover:border-primary/50 hover:shadow-glow">
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
