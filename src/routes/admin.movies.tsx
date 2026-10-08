import { createFileRoute } from "@tanstack/react-router";
import { ResourceManager } from "@/components/admin/ResourceManager";
import { moviesConfig } from "@/lib/admin/configs";

export const Route = createFileRoute("/admin/movies")({ component: () => <ResourceManager config={moviesConfig} /> });
