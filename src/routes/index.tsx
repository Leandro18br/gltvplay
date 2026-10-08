import { createFileRoute } from "@tanstack/react-router";
import { useSuspenseQuery } from "@tanstack/react-query";
import { publishedHomeQuery } from "@/lib/home/queries";
import { RetryState, SiteShell, EmptyState } from "@/components/site/SiteShell";
import { RowSkeleton } from "@/components/site/ContentCard";
import { HomeContent } from "@/components/site/HomeContent";

export const Route = createFileRoute("/")({
  head: ({ loaderData }) => ({
    meta: [
      { title: `${loaderData?.platformName ?? "Streaming"} — Filmes, séries e canais ao vivo` },
      { name: "description", content: "Assista filmes, séries e canais ao vivo em uma experiência premium, onde e quando quiser." },
      { property: "og:title", content: `${loaderData?.platformName ?? "Streaming"} — Filmes, séries e canais ao vivo` },
      { property: "og:description", content: "Assista filmes, séries e canais ao vivo em uma experiência premium." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
      ...(loaderData?.slides[0]?.backdrop?.startsWith("https://") ? [{ property: "og:image", content: loaderData.slides[0].backdrop }, { name: "twitter:image", content: loaderData.slides[0].backdrop }] : []),
    ],
    links: [{ rel: "canonical", href: "/" }],
  }),
  loader: ({ context }) => context.queryClient.ensureQueryData(publishedHomeQuery),
  pendingComponent: () => (
    <SiteShell padTop={false}><div className="h-[70vh] animate-pulse bg-card" /><div className="space-y-10 py-10"><RowSkeleton /><RowSkeleton /></div></SiteShell>
  ),
  errorComponent: () => <RetryState title="Não foi possível carregar o catálogo" />,
  notFoundComponent: () => <SiteShell><EmptyState title="Página não encontrada" /></SiteShell>,
  component: Home,
});

function Home() {
  const { data } = useSuspenseQuery(publishedHomeQuery);
  return <SiteShell padTop={false}><HomeContent data={data} /></SiteShell>;
}
