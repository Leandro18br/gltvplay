import { createFileRoute } from "@tanstack/react-router";
import { ResourceManager } from "@/components/admin/ResourceManager";
import { channelsConfig } from "@/lib/admin/configs";

export const Route = createFileRoute("/admin/channels")({ component: () => <ResourceManager config={channelsConfig} /> });
