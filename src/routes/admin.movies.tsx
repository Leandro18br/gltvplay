import { createFileRoute } from "@tanstack/react-router";
import { ResourceManager } from "@/components/admin/ResourceManager";
import { moviesConfig } from "@/lib/admin/configs";
import { adminHead } from "@/lib/admin/head";

export const Route = createFileRoute("/admin/movies")({ head:()=>adminHead("Filmes", "Gerencie filmes e fontes de reprodução autorizadas."), component: () => <ResourceManager config={moviesConfig} /> });
