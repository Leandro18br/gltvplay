import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { Search, Loader2, X } from "lucide-react";
import { searchQuery } from "@/lib/catalog";
import { SiteShell, EmptyState } from "@/components/site/SiteShell";
import { CardGrid, GridSkeleton } from "@/components/site/ContentCard";

export const Route = createFileRoute("/buscar")({
  validateSearch: (s: Record<string, unknown>) => ({ q: typeof s["q"] === "string" ? s["q"] : "" }),
  head: () => ({
    meta: [
      { title: "Buscar — Streaming" },
      { name: "description", content: "Pesquise filmes, séries, episódios e canais." },
      { property: "og:title", content: "Buscar — Streaming" },
      { property: "og:description", content: "Pesquise filmes, séries, episódios e canais." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
      { name: "robots", content: "noindex,follow" },
    ],
  }),
  component: SearchPage,
});

function SearchPage() {
  const { q } = Route.useSearch();
  const navigate = useNavigate({ from: "/buscar" });
  const [value, setValue] = useState(q);
  const [term, setTerm] = useState(q);
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => { input.current?.focus(); }, []);
  useEffect(() => {
    const t = setTimeout(() => {
      setTerm(value);
      navigate({ search: { q: value }, replace: true });
    }, 250);
    return () => clearTimeout(t);
  }, [value, navigate]);

  const res = useQuery({ ...searchQuery(term), placeholderData: keepPreviousData });
  const d = res.data;
  const total = d ? d.movies.length + d.series.length + d.episodes.length + d.channels.length : 0;
  const active = term.trim().length >= 2;

  return (
    <SiteShell>
      <div className="mx-auto max-w-[1600px] px-4 pb-8 md:px-10">
        <h1 className="sr-only">Buscar</h1>
        <label className="flex items-center gap-3 rounded-2xl border border-border bg-card px-4 focus-within:border-primary focus-within:shadow-glow">
          <Search className="size-5 shrink-0 text-muted-foreground" />
          <input ref={input} value={value} onChange={(e) => setValue(e.target.value)} placeholder="Filmes, séries, episódios ou canais"
            aria-label="Buscar" className="h-14 min-w-0 flex-1 bg-transparent text-lg outline-none placeholder:text-muted-foreground" />
          {res.isFetching && <Loader2 className="size-5 animate-spin text-primary" />}
          {value && <button aria-label="Limpar" onClick={() => setValue("")}><X className="size-5 text-muted-foreground" /></button>}
        </label>
      </div>
      {!active ? (
        <EmptyState icon={<Search />} title="O que você quer assistir?" text="Digite pelo menos 2 letras para ver resultados instantâneos." />
      ) : res.isPending ? <GridSkeleton count={12} /> : res.isError ? (
        <EmptyState title="Erro na busca" text="Tente novamente." />
      ) : total === 0 ? (
        <EmptyState title={`Nenhum resultado para “${term}”`} text="Tente outro título ou palavra-chave." />
      ) : d && (
        <div className="space-y-10">
          {d.movies.length > 0 && <section><h2 className="mx-auto mb-4 max-w-[1600px] px-4 text-lg font-semibold md:px-10">Filmes</h2><CardGrid items={d.movies} /></section>}
          {d.series.length > 0 && <section><h2 className="mx-auto mb-4 max-w-[1600px] px-4 text-lg font-semibold md:px-10">Séries</h2><CardGrid items={d.series} /></section>}
          {d.episodes.length > 0 && (
            <section className="mx-auto max-w-[1600px] px-4 md:px-10">
              <h2 className="mb-4 text-lg font-semibold">Episódios</h2>
              <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {d.episodes.map((e) => (
                  <li key={e.id}>
                    <Link to="/assistir/$kind/$id" params={{ kind: "episode", id: e.id }} className="flex items-center gap-3 rounded-xl border border-border bg-card p-2 transition hover:border-primary/50">
                      <div className="aspect-video w-32 shrink-0 overflow-hidden rounded-lg bg-accent">
                        {(e.thumbnail_url || e.series.backdrop_url) && <img src={e.thumbnail_url || e.series.backdrop_url!} alt="" loading="lazy" className="h-full w-full object-cover" />}
                      </div>
                      <div className="min-w-0">
                        <p className="truncate text-sm font-semibold">{e.title}</p>
                        <p className="truncate text-xs text-muted-foreground">{e.series.title} · T{e.season_number}:E{e.episode_number}</p>
                      </div>
                    </Link>
                  </li>
                ))}
              </ul>
            </section>
          )}
          {d.channels.length > 0 && <section><h2 className="mx-auto mb-4 max-w-[1600px] px-4 text-lg font-semibold md:px-10">Canais</h2><CardGrid items={d.channels} /></section>}
        </div>
      )}
    </SiteShell>
  );
}
