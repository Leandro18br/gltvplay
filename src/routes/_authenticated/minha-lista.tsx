import { createFileRoute, Link } from "@tanstack/react-router";
import { ListVideo } from "lucide-react";
import { useWatchlist } from "@/lib/user-data";
import { SiteShell, PageTitle, EmptyState } from "@/components/site/SiteShell";
import { CardGrid, GridSkeleton } from "@/components/site/ContentCard";
import { Button } from "@/components/ui/button";

export const Route = createFileRoute("/_authenticated/minha-lista")({
  head: () => ({
    meta: [
      { title: "Minha lista — Streaming" },
      { name: "description", content: "Os filmes e séries que você salvou para assistir depois." },
      { property: "og:title", content: "Minha lista — Streaming" },
      { property: "og:description", content: "Os filmes e séries que você salvou para assistir depois." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: Page,
});

function Page() {
  const wl = useWatchlist();
  return (
    <SiteShell>
      <PageTitle title="Minha lista" subtitle="Seus filmes e séries salvos para assistir depois." />
      {wl.isLoading || !wl.user ? <GridSkeleton count={6} /> : wl.items.length === 0 ? (
        <div>
          <EmptyState icon={<ListVideo />} title="Sua lista está vazia" text="Toque no + em qualquer filme ou série para salvá-lo aqui." />
          <div className="flex justify-center"><Button asChild className="rounded-full"><Link to="/">Explorar catálogo</Link></Button></div>
        </div>
      ) : <CardGrid items={wl.items} />}
    </SiteShell>
  );
}
