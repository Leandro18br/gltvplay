import { createFileRoute, Link } from "@tanstack/react-router";
import { z } from "zod";
import { BugouMoviesButton } from "@/components/admin/integrations/BugouMoviesButton";
import { ResourceManager } from "@/components/admin/ResourceManager";
import { TmdbSearchButton } from "@/components/admin/tmdb/TmdbTools";
import { TmdbMovieRepairBatch } from "@/components/admin/tmdb/TmdbMovieRepairBatch";
import { moviesConfig } from "@/lib/admin/configs";
import { adminHead } from "@/lib/admin/head";
import { Button } from "@/components/ui/button";

export const Route = createFileRoute("/admin/movies")({ validateSearch: z.object({ edit: z.string().optional() }), head: () => adminHead("Filmes", "Gerencie filmes e fontes de reprodução autorizadas."), component: MoviesPage });

function MoviesPage() {
  const { edit } = Route.useSearch();
  return <div className="space-y-3"><div className="flex flex-wrap justify-end gap-2"><BugouMoviesButton /><TmdbSearchButton kind="movie" /></div><TmdbMovieRepairBatch /><ResourceManager config={moviesConfig} editId={edit} /></div>;
}
