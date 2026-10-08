import { createFileRoute } from "@tanstack/react-router";
import { ResourceManager } from "@/components/admin/ResourceManager";
import { genresConfig } from "@/lib/admin/configs";
import { adminHead } from "@/lib/admin/head";

export const Route = createFileRoute("/admin/genres")({ head:()=>adminHead("Gêneros","Gerencie os gêneros de filmes e séries."), component: () => <ResourceManager config={genresConfig} /> });
