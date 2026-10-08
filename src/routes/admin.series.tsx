import { createFileRoute } from "@tanstack/react-router";
import { ResourceManager } from "@/components/admin/ResourceManager";
import { seriesConfig } from "@/lib/admin/configs";

export const Route = createFileRoute("/admin/series")({ component: () => <ResourceManager config={seriesConfig} /> });
