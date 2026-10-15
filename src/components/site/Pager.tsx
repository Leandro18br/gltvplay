import { ChevronLeft, ChevronRight, Loader2 } from "lucide-react";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { pagedListQuery, type Kind, type PagedFilter } from "@/lib/catalog";
import { CardGrid } from "./ContentCard";
import { EmptyState } from "./SiteShell";
import { Button } from "@/components/ui/button";

/** Anterior / Próximo controls placed after a card grid. Pages are 1-based. */
export function Pager({ page, pages, total, onChange, label = "Paginação" }: { page: number; pages: number; total: number; onChange: (page: number) => void; label?: string }) {
  if (total === 0) return null;
  return (
    <nav aria-label={label} className="mx-auto flex max-w-[1600px] flex-wrap items-center justify-center gap-3 px-4 py-8 md:px-10">
      <Button type="button" variant="secondary" className="rounded-full" disabled={page <= 1} onClick={() => onChange(page - 1)}><ChevronLeft /> Anterior</Button>
      <span className="text-sm text-muted-foreground" aria-live="polite">Página {page} de {pages} · {total} {total === 1 ? "título" : "títulos"}</span>
      <Button type="button" variant="secondary" className="rounded-full" disabled={page >= pages} onClick={() => onChange(page + 1)}>Próximo <ChevronRight /></Button>
    </nav>
  );
}

/** Titled grid that fetches exactly one page from the database and shows Anterior/Próximo. */
export function PagedGridSection({ title, kind, filter, page, onChange }: { title: string; kind: Kind; filter: PagedFilter; page: number; onChange: (page: number) => void }) {
  const q = useQuery({ ...pagedListQuery(kind, filter, page), placeholderData: keepPreviousData });
  if (q.isPending) return <div className="flex justify-center py-10" role="status" aria-label="Carregando canais"><Loader2 className="animate-spin text-primary" /></div>;

  // Never leave the category destination looking blank when its channel query fails.
  if (q.isError || !q.data) {
    return (
      <section className="py-4" aria-live="polite">
        <EmptyState title={kind === "channel" ? "Não foi possível carregar os canais desta categoria" : "Não foi possível carregar os conteúdos"} text="Verifique sua conexão e tente novamente." />
        <div className="flex justify-center">
          <Button type="button" onClick={() => { void q.refetch(); }} variant="secondary" className="rounded-full">Tentar novamente</Button>
        </div>
      </section>
    );
  }

  if (q.data.total === 0) {
    return (
      <EmptyState
        title={kind === "channel" ? "Nenhum canal publicado nesta categoria" : "Nenhum conteúdo publicado nesta categoria"}
        text="Volte à lista de categorias ou escolha outra categoria."
      />
    );
  }

  return (
    <section className="animate-rise" aria-label={title}>
      <h2 className="mx-auto mb-5 max-w-[1600px] break-words px-4 text-lg font-semibold md:px-10 md:text-xl">{title}</h2>
      <CardGrid items={q.data.items} />
      <Pager label={`Paginação de ${title}`} page={q.data.page} pages={q.data.pages} total={q.data.total} onChange={onChange} />
    </section>
  );
}
