import { requireSiteAccess } from "@/lib/access/gate";
import { safeImageUrl } from "@/lib/tmdb/completion";
import { createFileRoute, notFound } from "@tanstack/react-router";
import { useSuspenseQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { Play } from "lucide-react";
import { formatDuration, seriesDetailQuery } from "@/lib/catalog";
import { RetryState, SiteShell, EmptyState } from "@/components/site/SiteShell";
import { DetailHero } from "@/components/site/DetailHero";
import { CastSection } from "@/components/site/CastSection";
import { InlinePlayer } from "@/components/site/InlinePlayer";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { requestPlaybackDisplay } from "@/lib/playback/display-mode";

export const Route = createFileRoute("/serie/$slug")({
  ssr: false,
  beforeLoad: requireSiteAccess,
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
  const [episodeId, setEpisodeId] = useState<string | null>(null);
  const season = data?.seasons.find((s) => s.id === seasonId) ?? data?.seasons[0];
  const current = data?.seasons.flatMap((s) => s.episodes).find((e) => e.id === episodeId);
  const currentId = current?.id;
  useEffect(() => {
    if (!currentId) return;
    // Run after the selected player's DOM has committed, not in the click handler.
    const frame = requestAnimationFrame(() => {
      window.scrollTo({ top: 0, behavior: document.documentElement.dataset.remoteNavigation === 'true' || window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "instant" : "smooth" });
      if (document.documentElement.dataset.remoteNavigation === 'true') document.querySelector<HTMLElement>('[data-playback-stage] button')?.focus();
    });
    return () => cancelAnimationFrame(frame);
  }, [currentId]);
  if (!data) return null;

  return (
    <SiteShell padTop={false} hideHeader>
      <article>
        <DetailHero
          item={data.item}
          flushPlayer
          banner
          extraMeta={<span>· {data.seasons.length} temporada{data.seasons.length === 1 ? "" : "s"}</span>}
          player={current ? (
            <InlinePlayer key={current.id} autoStart className="movie-top-player" kind="episode" id={current.id} title={`${data.item.title} — ${current.title}`} poster={safeImageUrl(current.thumbnail_url) || data.item.backdrop_url || data.item.poster_url} />
          ) : undefined}
        />
        <CastSection kind="series" id={data.item.id} />
        <section id="episodios" aria-label="Episódios" className="mx-auto max-w-[1600px] scroll-mt-20 px-4 py-10 md:px-10">
          <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
            <h2 className="text-2xl font-semibold">Episódios</h2>
            {data.seasons.length > 0 && (
              <Select value={season?.id ?? ""} onValueChange={setSeasonId}>
                <SelectTrigger aria-label="Temporada" className="w-48 rounded-full"><SelectValue /></SelectTrigger>
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
              {season.episodes.map((e) => {
                const thumbnail = safeImageUrl(e.thumbnail_url);
                return (
                <li key={e.id}>
                  <Button type="button" variant="ghost" data-remote-id={`episode-${e.id}`} onClick={() => { void requestPlaybackDisplay(document.documentElement); setEpisodeId(e.id); }}
                    aria-current={e.id === current?.id}
                    className={`group grid h-auto w-full grid-cols-[minmax(0,7rem)_minmax(0,1fr)] items-center gap-3 whitespace-normal rounded-lg p-2 text-left transition hover:bg-card md:grid-cols-[3rem_14rem_minmax(0,1fr)_auto] md:gap-4 ${e.id === current?.id ? "bg-card ring-1 ring-primary/40" : ""}`}>
                    <span className="hidden text-center font-display text-2xl text-muted-foreground md:block">{e.episode_number}</span>
                    <div className="relative aspect-video overflow-hidden rounded-lg bg-card">
                      {thumbnail ? <img src={thumbnail} alt="" loading="lazy" className="h-full w-full object-cover" onError={(ev) => { ev.currentTarget.style.display = "none"; }} /> : <div className="h-full bg-accent" />}
                      <span className="absolute inset-0 flex items-center justify-center bg-background/40 opacity-0 transition group-hover:opacity-100"><Play className="fill-current text-primary" /></span>
                    </div>
                    <div className="min-w-0">
                      <p className="break-words font-semibold"><span className="md:hidden">{e.episode_number}. </span>{e.title}</p>
                      {e.description && <p className="mt-1 line-clamp-2 text-sm text-muted-foreground">{e.description}</p>}
                      {e.duration_minutes && <p className="mt-1 text-xs text-muted-foreground md:hidden">{formatDuration(e.duration_minutes)}</p>}
                    </div>
                    <span className="hidden text-sm text-muted-foreground md:block">{formatDuration(e.duration_minutes)}</span>
                  </Button>
                </li>
              ); })}
            </ol>
          )}
        </section>
      </article>
    </SiteShell>
  );
}
