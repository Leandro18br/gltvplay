import { createFileRoute } from "@tanstack/react-router";
import { ResourceManager } from "@/components/admin/ResourceManager";
import { channelCategoriesConfig } from "@/lib/admin/configs";
import { adminHead } from "@/lib/admin/head";

export const Route = createFileRoute("/admin/channel-categories")({ head: () => adminHead("Categorias de canais", "Gerencie as categorias dos canais ao vivo."), component: () => <ResourceManager config={channelCategoriesConfig} /> });
