import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { ArrowLeft, Loader2, Pencil } from "lucide-react";
import { ResourceManager } from "@/components/admin/ResourceManager";
import { seasonsConfig } from "@/lib/admin/configs";
import { adminHead } from "@/lib/admin/head";
import { db, STATUS_OPTIONS, type Row } from "@/lib/admin/db";
import { Button } from "@/components/ui/button";

export const Route = createFileRoute("/admin/series_/$id")({
  head: () => adminHead("Gerenciar série", "Informações, temporadas e episódios da série."),
  component: SeriesManage,
});

export function useSeriesInfo(id: string) {
  return useQuery({
    queryKey: ["admin", "series", "info", id],
    queryFn: async () => {
      const { data, error } = await db.from("series").select("*, series_genres(genres(name))").eq("id", id).maybeSingle();
      if (error) throw error;
      return data as Row | null;
    },
  });
}

function SeriesManage() {
  const { id } = Route.useParams();
  const info = useSeriesInfo(id);
  const s = info.data;
  return (
    <div className="space-y-6">
      <Link to="/admin/series" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-primary"><ArrowLeft className="h-4 w-4" /> Séries</Link>
      {info.isLoading ? (
        <div className="flex items-center gap-2 text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" /> Carregando…</div>
      ) : !s ? (
        <p className="text-muted-foreground">Série não encontrada.</p>
      ) : (
        <section className="flex flex-col gap-5 rounded-2xl border border-border bg-card p-4 sm:flex-row md:p-6">
          <div className="mx-auto aspect-[2/3] w-32 shrink-0 overflow-hidden rounded-xl bg-muted sm:mx-0 md:w-40">
            {s.poster_url && <img src={s.poster_url} alt={s.title} className="h-full w-full object-cover" />}
          </div>
          <div className="min-w-0 flex-1 space-y-2">
            <h1 className="text-2xl font-bold md:text-3xl">{s.title}</h1>
            <div className="flex flex-wrap gap-2 text-xs">
              {s.release_year && <span className="rounded-full bg-muted px-2 py-0.5">{s.release_year}</span>}
              <span className="rounded-full border border-primary/40 bg-accent px-2 py-0.5 text-accent-foreground">{STATUS_OPTIONS.find((o) => o.value === s.status)?.label}</span>
              {(s.series_genres ?? []).map((g: Row, i: number) => <span key={i} className="rounded-full bg-muted px-2 py-0.5">{g.genres?.name}</span>)}
            </div>
            <p className="line-clamp-4 text-sm text-muted-foreground">{s.description || "Sem descrição."}</p>
            <Button asChild variant="outline" size="sm" className="rounded-full"><Link to="/admin/series" search={{ edit: s.id }}><Pencil /> Editar série</Link></Button>
          </div>
        </section>
      )}
      <ResourceManager config={seasonsConfig} initialScope={id} lockScope title="Temporadas" />
    </div>
  );
}
