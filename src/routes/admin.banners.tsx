import { createFileRoute } from "@tanstack/react-router";
import { ResourceManager } from "@/components/admin/ResourceManager";
import { bannersConfig } from "@/lib/admin/configs";

export const Route = createFileRoute("/admin/banners")({ component: () => <ResourceManager config={bannersConfig} /> });
