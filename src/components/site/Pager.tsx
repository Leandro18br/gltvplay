import { ChevronLeft, ChevronRight } from "lucide-react";
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

import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { Loader2 } from "lucide-react";
import { pagedListQuery, type Kind, type PagedFilter } from "@/lib/catalog";
import { CardGrid } from "./ContentCard";

/** Titled grid that fetches exactly one page from the database and shows Anterior/Próximo. Hidden when the filtered list is empty. */
export function PagedGridSection({ title, kind, filter, page, onChange }: { title: string; kind: Kind; filter: PagedFilter; page: number; onChange: (page: number) => void }) {
  const q = useQuery({ ...pagedListQuery(kind, filter, page), placeholderData: keepPreviousData });
  if (q.isPending) return <div className="flex justify-center py-10"><Loader2 className="animate-spin text-primary" /></div>;
  if (q.isError || !q.data || q.data.total === 0) return null;
  return (
    <section className="animate-rise" aria-label={title}>
      <h2 className="mx-auto mb-5 max-w-[1600px] break-words px-4 text-lg font-semibold md:px-10 md:text-xl">{title}</h2>
      <CardGrid items={q.data.items} />
      <Pager label={`Paginação de ${title}`} page={q.data.page} pages={q.data.pages} total={q.data.total} onChange={onChange} />
    </section>
  );
}
