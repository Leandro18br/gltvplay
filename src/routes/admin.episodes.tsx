import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { ResourceManager } from "@/components/admin/ResourceManager";
import { episodesConfig } from "@/lib/admin/configs";

export const Route = createFileRoute("/admin/episodes")({
  validateSearch: z.object({ season: z.string().optional() }),
  component: Page,
});

function Page() {
  const { season } = Route.useSearch();
  return <ResourceManager key={season ?? "all"} config={episodesConfig} initialScope={season} />;
}
