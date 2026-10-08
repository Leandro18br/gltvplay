import { createFileRoute, notFound } from "@tanstack/react-router";
import { useSuspenseQuery } from "@tanstack/react-query";
import { Film } from "lucide-react";
import { categoryQuery } from "@/lib/catalog";
import { SiteShell, PageTitle, EmptyState } from "@/components/site/SiteShell";
import { Row } from "@/components/site/ContentCard";

export const Route = createFileRoute("/categoria/$slug")({
  loader: async ({ context, params }) => {
    const d = await context.queryClient.ensureQueryData(categoryQuery(params.slug));
    if (!d) throw notFound();
    return { name: d.category.name, description: d.category.description };
  },
  head: ({ loaderData, params }) => {
    if (!loaderData) return { meta: [{ title: "Categoria indisponível" }, { name: "robots", content: "noindex" }] };
    const title = `${loaderData.name} — Streaming`;
    const desc = loaderData.description ?? `Filmes, séries e canais de ${loaderData.name}.`;
    return {
      meta: [
        { title }, { name: "description", content: desc },
        { property: "og:title", content: title }, { property: "og:description", content: desc },
        { property: "og:type", content: "website" }, { property: "og:url", content: `/categoria/${params.slug}` },
        { name: "twitter:card", content: "summary" },
      ],
      links: [{ rel: "canonical", href: `/categoria/${params.slug}` }],
    };
  },
  errorComponent: () => <SiteShell><EmptyState title="Não foi possível carregar a categoria" /></SiteShell>,
  notFoundComponent: () => <SiteShell><EmptyState title="Categoria não encontrada" /></SiteShell>,
  component: Page,
});

function Page() {
  const { slug } = Route.useParams();
  const { data } = useSuspenseQuery(categoryQuery(slug));
  if (!data) return null;
  const empty = !data.movies.length && !data.series.length && !data.channels.length;
  return (
    <SiteShell>
      <PageTitle title={data.category.name} subtitle={data.category.description} />
      {empty ? <EmptyState icon={<Film />} title="Ainda não há conteúdos nesta categoria" /> : (
        <div className="space-y-4">
          <Row title="Filmes" items={data.movies} />
          <Row title="Séries" items={data.series} />
          <Row title="Canais" items={data.channels} />
        </div>
      )}
    </SiteShell>
  );
}
