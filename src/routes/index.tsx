import { createFileRoute } from "@tanstack/react-router";
import { useSuspenseQuery } from "@tanstack/react-query";
import { Play, Info, Tv } from "lucide-react";
import { homeCatalogQuery } from "@/lib/catalog";
import { SiteHeader } from "@/components/site/SiteHeader";
import { Button } from "@/components/ui/button";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Streaming — Filmes, séries e canais" },
      { name: "description", content: "Assista filmes, séries e canais ao vivo em uma experiência premium." },
      { property: "og:title", content: "Streaming — Filmes, séries e canais" },
      { property: "og:description", content: "Assista filmes, séries e canais ao vivo em uma experiência premium." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  loader: ({ context }) => context.queryClient.ensureQueryData(homeCatalogQuery),
  errorComponent: () => <div className="p-10 text-muted-foreground">Não foi possível carregar o catálogo.</div>,
  notFoundComponent: () => <div className="p-10">Não encontrado</div>,
  component: Home,
});

type Card = { id: string; title: string; poster_url: string | null; release_year?: number | null };

function Row({ title, items }: { title: string; items: Card[] }) {
  if (!items.length) return null;
  return (
    <section className="animate-rise space-y-3">
      <h2 className="px-5 text-lg font-semibold md:px-10 md:text-xl">{title}</h2>
      <div className="flex gap-3 overflow-x-auto px-5 pb-4 md:px-10 [scrollbar-width:none]">
        {items.map((m) => (
          <article
            key={m.id}
            className="group relative aspect-[2/3] w-36 shrink-0 overflow-hidden rounded-xl bg-card transition-all duration-300 hover:-translate-y-1 hover:shadow-glow md:w-44"
          >
            {m.poster_url ? (
              <img src={m.poster_url} alt={m.title} loading="lazy" className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-105" />
            ) : (
              <div className="flex h-full items-end p-3 text-sm font-medium">{m.title}</div>
            )}
            <div className="absolute inset-x-0 bottom-0 bg-fade p-3 pt-10 opacity-0 transition-opacity group-hover:opacity-100">
              <p className="truncate text-sm font-semibold">{m.title}</p>
              {m.release_year && <p className="text-xs text-muted-foreground">{m.release_year}</p>}
            </div>
          </article>
        ))}
      </div>
    </section>
  );
}

function Home() {
  const { data } = useSuspenseQuery(homeCatalogQuery);
  const hero = data.movies.find((m) => m.featured) ?? data.series.find((s) => s.featured) ?? data.movies[0] ?? data.series[0];
  const empty = !data.movies.length && !data.series.length && !data.channels.length;

  return (
    <div className="min-h-screen bg-background">
      <SiteHeader />

      {hero ? (
        <section className="relative h-[78vh] min-h-[520px] w-full overflow-hidden">
          {hero.backdrop_url && <img src={hero.backdrop_url} alt="" className="absolute inset-0 h-full w-full object-cover" />}
          <div className="absolute inset-0 bg-side-fade" />
          <div className="absolute inset-0 bg-fade" />
          <div className="relative mx-auto flex h-full max-w-[1600px] flex-col justify-end gap-5 px-5 pb-20 md:px-10">
            <span className="w-fit rounded-full border border-primary/40 bg-accent/60 px-3 py-1 text-xs font-medium text-accent-foreground">Em destaque</span>
            <h1 className="animate-rise max-w-2xl text-4xl font-bold md:text-6xl">{hero.title}</h1>
            {hero.description && <p className="max-w-xl text-muted-foreground line-clamp-3">{hero.description}</p>}
            <div className="flex gap-3">
              <Button size="lg" className="rounded-full"><Play className="fill-current" /> Assistir</Button>
              <Button size="lg" variant="secondary" className="rounded-full"><Info /> Detalhes</Button>
            </div>
          </div>
        </section>
      ) : (
        <div className="h-24" />
      )}

      <main className="relative z-10 -mt-10 space-y-10 pb-20">
        {empty && (
          <div className="mx-auto mt-32 max-w-md px-5 text-center">
            <div className="mx-auto mb-5 flex h-14 w-14 items-center justify-center rounded-2xl bg-accent text-primary shadow-glow">
              <Tv />
            </div>
            <h1 className="text-2xl font-semibold">O catálogo está sendo preparado</h1>
            <p className="mt-2 text-muted-foreground">Os conteúdos publicados pelo painel administrativo aparecerão aqui automaticamente.</p>
          </div>
        )}
        <Row title="Filmes" items={data.movies} />
        <Row title="Séries" items={data.series} />
        {data.channels.length > 0 && (
          <section className="space-y-3">
            <h2 className="px-5 text-lg font-semibold md:px-10 md:text-xl">Canais ao vivo</h2>
            <div className="flex gap-3 overflow-x-auto px-5 pb-4 md:px-10">
              {data.channels.map((c) => (
                <div key={c.id} className="flex h-24 w-40 shrink-0 items-center justify-center rounded-xl border border-border bg-card p-4 transition hover:shadow-glow">
                  {c.logo_url ? <img src={c.logo_url} alt={c.name} className="max-h-full object-contain" /> : <span className="font-medium">{c.name}</span>}
                </div>
              ))}
            </div>
          </section>
        )}
      </main>
    </div>
  );
}
