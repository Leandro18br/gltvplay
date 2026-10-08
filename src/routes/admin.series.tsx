import { createFileRoute, Link } from "@tanstack/react-router";
import { z } from "zod";
import { DownloadCloud } from "lucide-react";
import { ResourceManager } from "@/components/admin/ResourceManager";
import { seriesConfig } from "@/lib/admin/configs";
import { adminHead } from "@/lib/admin/head";
import { Button } from "@/components/ui/button";

export const Route = createFileRoute("/admin/series")({ validateSearch: z.object({ edit: z.string().optional() }), head: () => adminHead("Séries", "Gerencie séries, temporadas e episódios."), component: SeriesPage });

function SeriesPage() {
  const { edit } = Route.useSearch();
  return <div className="space-y-3"><div className="flex justify-end"><Button asChild variant="outline" size="sm" className="rounded-full"><Link to="/admin/import" hash="api"><DownloadCloud /> Importar pela API</Link></Button></div><ResourceManager config={seriesConfig} editId={edit} /></div>;
}
