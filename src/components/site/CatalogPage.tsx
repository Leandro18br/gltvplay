import { useSuspenseInfiniteQuery, useQuery } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { useEffect, useRef } from "react";
import { Loader2, Film } from "lucide-react";
import { catalogListQuery, genresQuery, type Kind, type SortKey } from "@/lib/catalog";
import { CardGrid } from "./ContentCard";
import { EmptyState, PageTitle } from "./SiteShell";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

export type CatalogSearch = { genero?: string | undefined; ordem?: SortKey | undefined };

export function CatalogPage({ kind, title, subtitle, search }: { kind: Kind; title: string; subtitle: string; search: CatalogSearch }) {
  const navigate = useNavigate();
  const sort = search.ordem ?? "recent";
  const q = useSuspenseInfiniteQuery(catalogListQuery(kind, search.genero, sort));
  const { data: genres = [] } = useQuery({ ...genresQuery, enabled: kind !== "channel" });
  const sentinel = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = sentinel.current;
    if (!el) return;
    const io = new IntersectionObserver((e) => {
      if (e[0]?.isIntersecting && q.hasNextPage && !q.isFetchingNextPage) q.fetchNextPage();
    }, { rootMargin: "600px" });
    io.observe(el);
    return () => io.disconnect();
  }, [q.hasNextPage, q.isFetchingNextPage, q]);

  const items = q.data?.pages.flatMap((p) => p.items) ?? [];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const set = (patch: Partial<CatalogSearch>) => navigate({ to: ".", search: (prev: any) => ({ ...prev, ...patch }), replace: true });

  return (
    <>
      <PageTitle title={title} subtitle={subtitle}>
        <div className={kind === "channel" ? "flex gap-2" : "grid min-w-0 grid-cols-2 gap-2 sm:flex sm:shrink-0"}>
          {kind !== "channel" && (
            <Select value={search.genero ?? "all"} onValueChange={(v) => set({ genero: v === "all" ? undefined : v })}>
              <SelectTrigger className="min-w-0 w-full rounded-full sm:w-40 [&>span]:truncate"><SelectValue placeholder="Gênero" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todos os gêneros</SelectItem>
                {genres.map((g) => <SelectItem key={g.id} value={g.slug}>{g.name}</SelectItem>)}
              </SelectContent>
            </Select>
          )}
          <Select value={sort} onValueChange={(v) => set({ ordem: v as SortKey })}>
            <SelectTrigger className={kind === "channel" ? "w-40 rounded-full" : "min-w-0 w-full rounded-full sm:w-40 [&>span]:truncate"}><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="recent">Mais recentes</SelectItem>
              {kind !== "channel" && <SelectItem value="year">Ano de lançamento</SelectItem>}
              <SelectItem value="title">Ordem alfabética</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </PageTitle>
      {q.isError ? (
        <EmptyState title="Não foi possível carregar" text="Verifique sua conexão e tente novamente." />
      ) : items.length === 0 ? (
        <EmptyState icon={<Film />} title="Nada por aqui ainda" text="Assim que novos conteúdos forem publicados eles aparecerão aqui." />
      ) : (
        <CardGrid items={items} />
      )}
      <div ref={sentinel} className="flex justify-center py-10">
        {q.isFetchingNextPage ? <Loader2 className="animate-spin text-primary" /> : q.hasNextPage ? <Button variant="secondary" onClick={() => q.fetchNextPage()}>Carregar mais</Button> : null}
      </div>
    </>
  );
}

export const validateCatalogSearch = (s: Record<string, unknown>): CatalogSearch => ({
  genero: typeof s["genero"] === "string" && s["genero"] ? s["genero"] : undefined,
  ordem: s["ordem"] === "year" || s["ordem"] === "title" ? s["ordem"] : undefined,
});
