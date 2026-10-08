import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { ChevronRight } from "lucide-react";
import { ResourceManager } from "@/components/admin/ResourceManager";
import { TmdbEpisodesButton } from "@/components/admin/tmdb/TmdbTools";
import { episodesConfig } from "@/lib/admin/configs";
import { adminHead } from "@/lib/admin/head";
import { db, type Row } from "@/lib/admin/db";

export const Route = createFileRoute("/admin/series_/$id_/temporada/$seasonId")({
  head: () => adminHead("Episódios da temporada", "Episódios e players de uma temporada."),
  component: SeasonManage,
});

function SeasonManage() {
  const { id, seasonId } = Route.useParams();
  const season = useQuery({
    queryKey: ["admin", "seasons", "info", seasonId],
    queryFn: async () => {
      const { data, error } = await db.from("seasons").select("season_number, title, series(title, tmdb_id)").eq("id", seasonId).maybeSingle();
      if (error) throw error;
      return data as Row | null;
    },
  });
  const s = season.data;
  const label = s ? `Temporada ${s.season_number}${s.title ? ` — ${s.title}` : ""}` : "Temporada";
  return (
    <div className="space-y-5">
      <nav className="flex flex-wrap items-center gap-1 text-sm text-muted-foreground">
        <Link to="/admin/series" className="hover:text-primary">Séries</Link><ChevronRight className="h-4 w-4" />
        <Link to="/admin/series/$id" params={{ id }} className="hover:text-primary">{s?.series?.title ?? "Série"}</Link><ChevronRight className="h-4 w-4" />
        <span className="text-foreground">{label}</span>
      </nav>
      {s?.series?.tmdb_id && <div className="flex justify-end"><TmdbEpisodesButton seasonId={seasonId} /></div>}
      <ResourceManager config={episodesConfig} initialScope={seasonId} lockScope title={`Episódios · ${label}`} />
    </div>
  );
}
