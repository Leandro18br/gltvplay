import { createFileRoute } from "@tanstack/react-router";
import { ResourceManager } from "@/components/admin/ResourceManager";
import { categoriesConfig } from "@/lib/admin/configs";
import { adminHead } from "@/lib/admin/head";

export const Route = createFileRoute("/admin/categories")({ head:()=>adminHead("Categorias de filmes e séries","Gerencie as categorias de filmes e séries."), component: () => <ResourceManager config={categoriesConfig} /> });
