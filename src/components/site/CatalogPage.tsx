import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { Loader2, Film } from "lucide-react";
import { genresQuery, pagedListQuery, type Kind, type SortKey } from "@/lib/catalog";
import { Pager } from "./Pager";
import { CardGrid } from "./ContentCard";
import { EmptyState, PageTitle } from "./SiteShell";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

export type CatalogSearch = { genero?: string | undefined; ordem?: SortKey | undefined; pagina?: number | undefined };
export const catalogPagedQuery = (kind: Kind, s: CatalogSearch) => pagedListQuery(kind, { genre: s.genero, sort: s.ordem ?? "recent" }, s.pagina ?? 1);

export function CatalogPage({ kind, title, subtitle, search }: { kind: Kind; title: string; subtitle: string; search: CatalogSearch }) {
  const navigate = useNavigate();
  const sort = search.ordem ?? "recent";
  const q = useQuery({ ...catalogPagedQuery(kind, search), placeholderData: keepPreviousData });
  const { data: genres = [] } = useQuery({ ...genresQuery, enabled: kind !== "channel" });
  const items = q.data?.items ?? [];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const set = (patch: Partial<CatalogSearch>) => navigate({ to: ".", search: (prev: any) => ({ ...prev, pagina: undefined, ...patch }), replace: true });
  const goTo = (pagina: number) => { set({ pagina: pagina > 1 ? pagina : undefined }); window.scrollTo({ top: 0, behavior: "smooth" }); };

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
      {q.isPending ? (
        <div className="flex justify-center py-16"><Loader2 className="animate-spin text-primary" /></div>
      ) : q.isError ? (
        <EmptyState title="Não foi possível carregar" text="Verifique sua conexão e tente novamente." />
      ) : items.length === 0 ? (
        <EmptyState icon={<Film />} title="Nada por aqui ainda" text="Assim que novos conteúdos forem publicados eles aparecerão aqui." />
      ) : (
        <CardGrid items={items} />
      )}
      {q.data && <Pager page={q.data.page} pages={q.data.pages} total={q.data.total} onChange={goTo} />}
    </>
  );
}

export const validateCatalogSearch = (s: Record<string, unknown>): CatalogSearch => ({
  genero: typeof s["genero"] === "string" && s["genero"] ? s["genero"] : undefined,
  ordem: s["ordem"] === "year" || s["ordem"] === "title" ? s["ordem"] : undefined,
  pagina: Number.isInteger(Number(s["pagina"])) && Number(s["pagina"]) > 1 ? Number(s["pagina"]) : undefined,
});
