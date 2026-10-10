import { safeImageUrl } from "@/lib/tmdb/completion";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { Search, Loader2, X } from "lucide-react";
import { pagedListQuery, searchQuery } from "@/lib/catalog";
import { SiteShell, EmptyState } from "@/components/site/SiteShell";
import { CardGrid, GridSkeleton } from "@/components/site/ContentCard";
import { PagedGridSection } from "@/components/site/Pager";

export const Route = createFileRoute("/buscar")({
  validateSearch: (s: Record<string, unknown>): { q: string; pf?: number | undefined; ps?: number | undefined } => ({
    q: typeof s["q"] === "string" ? s["q"] : "",
    pf: Number.isInteger(Number(s["pf"])) && Number(s["pf"]) > 1 ? Number(s["pf"]) : undefined,
    ps: Number.isInteger(Number(s["ps"])) && Number(s["ps"]) > 1 ? Number(s["ps"]) : undefined,
  }),
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
  const { q, pf, ps } = Route.useSearch();
  const navigate = useNavigate({ from: "/buscar" });
  const [value, setValue] = useState(q);
  const [term, setTerm] = useState(q);
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => { input.current?.focus(); }, []);
  useEffect(() => {
    const t = setTimeout(() => {
      if (value === term) return;
      setTerm(value);
      navigate({ search: { q: value }, replace: true }); // new term → back to page 1
    }, 200);
    return () => clearTimeout(t);
  }, [value, term, navigate]);
  const go = (key: "pf" | "ps") => (n: number) => navigate({ search: (prev) => ({ ...prev, [key]: n > 1 ? n : undefined }), replace: true });

  const res = useQuery({ ...searchQuery(term), placeholderData: keepPreviousData });
  const d = res.data;
  const fm = useQuery({ ...pagedListQuery("movie", { term, sort: "title" }, pf ?? 1), enabled: term.trim().length >= 2, placeholderData: keepPreviousData });
  const fs = useQuery({ ...pagedListQuery("series", { term, sort: "title" }, ps ?? 1), enabled: term.trim().length >= 2, placeholderData: keepPreviousData });
  const total = (d ? d.episodes.length + d.channels.length : 0) + (fm.data?.total ?? 0) + (fs.data?.total ?? 0);
  const pending = res.isPending || fm.isPending || fs.isPending;
  const active = term.trim().length >= 2;

  return (
    <SiteShell>
      <div className="mx-auto max-w-[1600px] px-4 pb-8 md:px-10">
        <h1 className="sr-only">Buscar</h1>
        <label className="flex items-center gap-3 rounded-2xl border border-border bg-card px-4 focus-within:border-primary focus-within:shadow-glow">
          <Search className="size-5 shrink-0 text-muted-foreground" />
          <input ref={input} value={value} onChange={(e) => setValue(e.target.value)} placeholder="Filmes, séries, episódios ou canais"
            aria-label="Buscar" className="h-14 min-w-0 flex-1 bg-transparent text-lg outline-none placeholder:text-muted-foreground" />
          {(res.isFetching || fm.isFetching || fs.isFetching) && <Loader2 className="size-5 animate-spin text-primary" />}
          {value && <button aria-label="Limpar" onClick={() => setValue("")}><X className="size-5 text-muted-foreground" /></button>}
        </label>
      </div>
      {!active ? (
        <EmptyState icon={<Search />} title="O que você quer assistir?" text="Digite pelo menos 2 letras para ver resultados instantâneos." />
      ) : pending && total === 0 ? <GridSkeleton count={12} /> : res.isError && fm.isError ? (
        <EmptyState title="Erro na busca" text="Tente novamente." />
      ) : total === 0 && !pending ? (
        <EmptyState title={`Nenhum resultado para “${term}”`} text="Tente outro título ou palavra-chave." />
      ) : (
        <div className="space-y-10">
          <PagedGridSection title="Filmes" kind="movie" filter={{ term, sort: "title" }} page={pf ?? 1} onChange={go("pf")} />
          <PagedGridSection title="Séries" kind="series" filter={{ term, sort: "title" }} page={ps ?? 1} onChange={go("ps")} />
          {d && d.episodes.length > 0 && (
            <section className="mx-auto max-w-[1600px] px-4 md:px-10">
              <h2 className="mb-4 text-lg font-semibold">Episódios</h2>
              <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {d.episodes.map((e) => (
                  <li key={e.id}>
                    <Link to="/assistir/$kind/$id" params={{ kind: "episode", id: e.id }} className="flex items-center gap-3 rounded-xl border border-border bg-card p-2 transition hover:border-primary/50">
                      <div className="aspect-video w-32 shrink-0 overflow-hidden rounded-lg bg-accent">
                        {(safeImageUrl(e.thumbnail_url) || e.series.backdrop_url) && <img src={safeImageUrl(e.thumbnail_url) || e.series.backdrop_url!} alt="" loading="lazy" className="h-full w-full object-cover" />}
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
          {d && d.channels.length > 0 && <section><h2 className="mx-auto mb-4 max-w-[1600px] px-4 text-lg font-semibold md:px-10">Canais</h2><CardGrid items={d.channels} /></section>}
        </div>
      )}
    </SiteShell>
  );
}
