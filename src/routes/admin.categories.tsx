import { createFileRoute } from "@tanstack/react-router";
import { ResourceManager } from "@/components/admin/ResourceManager";
import { categoriesConfig } from "@/lib/admin/configs";

export const Route = createFileRoute("/admin/categories")({ component: () => <ResourceManager config={categoriesConfig} /> });
