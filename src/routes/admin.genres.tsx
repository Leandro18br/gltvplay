import { createFileRoute } from "@tanstack/react-router";
import { ResourceManager } from "@/components/admin/ResourceManager";
import { genresConfig } from "@/lib/admin/configs";

export const Route = createFileRoute("/admin/genres")({ component: () => <ResourceManager config={genresConfig} /> });
