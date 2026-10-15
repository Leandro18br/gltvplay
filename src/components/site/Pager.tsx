import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { Loader2 } from "lucide-react";
import { pagedListQuery, type Kind, type PagedFilter } from "@/lib/catalog";
import { CardGrid } from "./ContentCard";
import { EmptyState } from "./SiteShell";
import { Button } from "@/components/ui/button";

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
