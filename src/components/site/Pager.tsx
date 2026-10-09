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
