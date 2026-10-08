import { createFileRoute, notFound } from "@tanstack/react-router";
import { useSuspenseQuery } from "@tanstack/react-query";
import { useState } from "react";
import { Play } from "lucide-react";
import { formatDuration, seriesDetailQuery } from "@/lib/catalog";
import { RetryState, SiteShell, EmptyState } from "@/components/site/SiteShell";
import { DetailHero } from "@/components/site/DetailHero";
import { InlinePlayer } from "@/components/site/InlinePlayer";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

export const Route = createFileRoute("/serie/$slug")({
  loader: async ({ context, params }) => {
    const data = await context.queryClient.ensureQueryData(seriesDetailQuery(params.slug));
    if (!data) throw notFound();
    return { title: data.item.title, description: data.item.description, image: data.item.backdrop_url || data.item.poster_url, seasons: data.seasons.length };
  },
  head: ({ loaderData, params }) => {
    if (!loaderData) return { meta: [{ title: "Indisponível — Streaming" }, { name: "robots", content: "noindex" }] };
    const title = `${loaderData.title} — Assistir série`;
    const desc = (loaderData.description ?? `Assista ${loaderData.title} online.`).slice(0, 160);
    const img = loaderData.image?.startsWith("https://") ? loaderData.image : null;
    return {
      meta: [
        { title }, { name: "description", content: desc },
        { property: "og:title", content: title }, { property: "og:description", content: desc },
        { property: "og:type", content: "video.tv_show" }, { property: "og:url", content: `/serie/${params.slug}` },
        { name: "twitter:card", content: "summary_large_image" },
        ...(img ? [{ property: "og:image", content: img }, { name: "twitter:image", content: img }] : []),
      ],
      links: [{ rel: "canonical", href: `/serie/${params.slug}` }],
      scripts: [{ type: "application/ld+json", children: JSON.stringify({ "@context": "https://schema.org", "@type": "TVSeries", name: loaderData.title, description: loaderData.description, image: img ?? undefined, numberOfSeasons: loaderData.seasons }) }],
    };
  },
  errorComponent: () => <RetryState title="Não foi possível carregar esta série" />,
  notFoundComponent: () => <SiteShell><EmptyState title="Série não encontrada" text="Ela pode ter sido removida ou ainda não foi publicada." /></SiteShell>,
  component: SeriesPage,
});

function SeriesPage() {
  const { slug } = Route.useParams();
  const { data } = useSuspenseQuery(seriesDetailQuery(slug));
  const [seasonId, setSeasonId] = useState(data?.seasons[0]?.id ?? "");
  if (!data) return null;
  const season = data.seasons.find((s) => s.id === seasonId) ?? data.seasons[0];
  const first = data.seasons.flatMap((s) => s.episodes)[0];

  return (
    <SiteShell padTop={false}>
      <article>
        <DetailHero
          item={data.item}
          extraMeta={<span>· {data.seasons.length} temporada{data.seasons.length === 1 ? "" : "s"}</span>}
          watch={first ? (
            <Button asChild size="lg" className="rounded-full px-7"><Link to="/assistir/$kind/$id" params={{ kind: "episode", id: first.id }}><Play className="fill-current" /> Assistir</Link></Button>
          ) : undefined}
        />
        <section id="episodios" aria-label="Episódios" className="mx-auto max-w-[1600px] scroll-mt-20 px-4 py-10 md:px-10">
          <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
            <h2 className="text-2xl font-semibold">Episódios</h2>
            {data.seasons.length > 0 && (
              <Select value={season?.id ?? ""} onValueChange={setSeasonId}>
                <SelectTrigger className="w-48 rounded-full"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {data.seasons.map((s) => <SelectItem key={s.id} value={s.id}>{s.title || `Temporada ${s.season_number}`}</SelectItem>)}
                </SelectContent>
              </Select>
            )}
          </div>
          {!season || season.episodes.length === 0 ? (
            <p className="text-muted-foreground">Nenhum episódio disponível nesta temporada ainda.</p>
          ) : (
            <ol className="grid gap-3">
              {season.episodes.map((e) => (
                <li key={e.id}>
                  <Link to="/assistir/$kind/$id" params={{ kind: "episode", id: e.id }}
                    className="group grid grid-cols-[minmax(0,9rem)_minmax(0,1fr)] items-center gap-4 rounded-xl p-2 transition hover:bg-card md:grid-cols-[3rem_14rem_minmax(0,1fr)_auto]">
                    <span className="hidden text-center font-display text-2xl text-muted-foreground md:block">{e.episode_number}</span>
                    <div className="relative aspect-video overflow-hidden rounded-lg bg-card">
                      {e.thumbnail_url ? <img src={e.thumbnail_url} alt="" loading="lazy" className="h-full w-full object-cover" /> : <div className="h-full bg-accent" />}
                      <span className="absolute inset-0 flex items-center justify-center bg-background/40 opacity-0 transition group-hover:opacity-100"><Play className="fill-current text-primary" /></span>
                    </div>
                    <div className="min-w-0">
                      <p className="truncate font-semibold"><span className="md:hidden">{e.episode_number}. </span>{e.title}</p>
                      {e.description && <p className="mt-1 line-clamp-2 text-sm text-muted-foreground">{e.description}</p>}
                    </div>
                    <span className="hidden text-sm text-muted-foreground md:block">{formatDuration(e.duration_minutes)}</span>
                  </Link>
                </li>
              ))}
            </ol>
          )}
        </section>
      </article>
    </SiteShell>
  );
}
