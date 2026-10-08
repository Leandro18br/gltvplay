import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { ResourceManager } from "@/components/admin/ResourceManager";
import { seasonsConfig } from "@/lib/admin/configs";

export const Route = createFileRoute("/admin/seasons")({
  validateSearch: z.object({ series: z.string().optional() }),
  component: Page,
});

function Page() {
  const { series } = Route.useSearch();
  return <ResourceManager key={series ?? "all"} config={seasonsConfig} initialScope={series} />;
}
