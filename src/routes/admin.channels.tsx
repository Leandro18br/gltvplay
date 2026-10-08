import { createFileRoute } from "@tanstack/react-router";
import { ResourceManager } from "@/components/admin/ResourceManager";
import { channelsConfig } from "@/lib/admin/configs";
import { adminHead } from "@/lib/admin/head";

export const Route = createFileRoute("/admin/channels")({ head:()=>adminHead("Canais","Gerencie canais e fontes autorizadas."), component: () => <ResourceManager config={channelsConfig} /> });
