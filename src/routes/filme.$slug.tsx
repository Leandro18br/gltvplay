import { requireSiteAccess } from "@/lib/access/gate";
import { createFileRoute, notFound } from "@tanstack/react-router";
import { useSuspenseQuery } from "@tanstack/react-query";
import { movieDetailQuery } from "@/lib/catalog";
import { RetryState, SiteShell, EmptyState } from "@/components/site/SiteShell";
import { DetailHero } from "@/components/site/DetailHero";
import { InlinePlayer } from "@/components/site/InlinePlayer";
import { GridSection } from "@/components/site/ContentCard";

export const Route = createFileRoute("/filme/$slug")({
  ssr: false,
  beforeLoad: requireSiteAccess,
  loader: async ({ context, params }) => {
    const data = await context.queryClient.ensureQueryData(movieDetailQuery(params.slug));
    if (!data) throw notFound();
    return { title: data.item.title, description: data.item.description, image: data.item.backdrop_url || data.item.poster_url, year: data.item.release_year };
  },
  head: ({ loaderData, params }) => {
    if (!loaderData) return { meta: [{ title: "Indisponível — Streaming" }, { name: "robots", content: "noindex" }] };
    const title = `${loaderData.title}${loaderData.year ? ` (${loaderData.year})` : ""} — Assistir filme`;
    const desc = (loaderData.description ?? `Assista ${loaderData.title} online.`).slice(0, 160);
    const img = loaderData.image?.startsWith("https://") ? loaderData.image : null;
    return {
      meta: [
        { title }, { name: "description", content: desc },
        { property: "og:title", content: title }, { property: "og:description", content: desc },
        { property: "og:type", content: "video.movie" }, { property: "og:url", content: `/filme/${params.slug}` },
        { name: "twitter:card", content: "summary_large_image" },
        ...(img ? [{ property: "og:image", content: img }, { name: "twitter:image", content: img }] : []),
      ],
      links: [{ rel: "canonical", href: `/filme/${params.slug}` }],
      scripts: [{ type: "application/ld+json", children: JSON.stringify({ "@context": "https://schema.org", "@type": "Movie", name: loaderData.title, description: loaderData.description, image: img ?? undefined, dateCreated: loaderData.year ? String(loaderData.year) : undefined }) }],
    };
  },
  errorComponent: () => <RetryState title="Não foi possível carregar este filme" />,
  notFoundComponent: () => <SiteShell><EmptyState title="Filme não encontrado" text="Ele pode ter sido removido ou ainda não foi publicado." /></SiteShell>,
  component: MoviePage,
});

function MoviePage() {
  const { slug } = Route.useParams();
  const { data } = useSuspenseQuery(movieDetailQuery(slug));
  if (!data) return null;
  return (
    <SiteShell padTop={false} hideHeader>
      <article>
        <DetailHero item={data.item} flushPlayer player={<InlinePlayer className="movie-top-player" kind="movie" id={data.item.id} title={data.item.title} poster={data.item.backdrop_url || data.item.poster_url} />} />
        <div className="py-8"><GridSection title="Títulos semelhantes" items={data.related} /></div>
      </article>
    </SiteShell>
  );
}
