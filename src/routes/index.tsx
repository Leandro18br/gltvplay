import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery, useSuspenseQuery } from "@tanstack/react-query";
import { Tv } from "lucide-react";
import { homeCatalogQuery, siteSettingsQuery, type Item } from "@/lib/catalog";
import { RetryState, SiteShell, EmptyState } from "@/components/site/SiteShell";
import { Hero, type HeroSlide } from "@/components/site/Hero";
import { Row, RowSkeleton } from "@/components/site/ContentCard";
import { ContinueWatchingRow, MyListRow } from "@/components/site/UserRows";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Streaming — Filmes, séries e canais ao vivo" },
      { name: "description", content: "Assista filmes, séries e canais ao vivo em uma experiência premium, onde e quando quiser." },
      { property: "og:title", content: "Streaming — Filmes, séries e canais ao vivo" },
      { property: "og:description", content: "Assista filmes, séries e canais ao vivo em uma experiência premium." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
    links: [{ rel: "canonical", href: "/" }],
  }),
  loader: ({ context }) => context.queryClient.ensureQueryData(homeCatalogQuery),
  pendingComponent: () => (
    <SiteShell padTop={false}><div className="h-[70vh] animate-pulse bg-card" /><div className="space-y-10 py-10"><RowSkeleton /><RowSkeleton /></div></SiteShell>
  ),
  errorComponent: () => <RetryState title="Não foi possível carregar o catálogo" />,
  notFoundComponent: () => <SiteShell><EmptyState title="Página não encontrada" /></SiteShell>,
  component: Home,
});

function Home() {
  const { data } = useSuspenseQuery(homeCatalogQuery);
  const { data: settings } = useQuery(siteSettingsQuery);
  const texts = (settings?.texts ?? {}) as { tagline?: string; empty_catalog?: string };
  const defBanner = (settings?.banner ?? {}) as { title?: string; subtitle?: string; image_url?: string };

  const all: Item[] = [...data.movies, ...data.series, ...data.channels];
  const slides: HeroSlide[] = data.banners.map((b) => {
    const item = b.content_id ? all.find((i) => i.id === b.content_id) ?? null : null;
    return { key: `b-${b.id}`, item, title: b.title, description: b.subtitle ?? item?.description ?? null, backdrop: b.image_url || item?.backdrop_url || null, cta: b.button_label, href: b.button_url };
  });
  if (!slides.length) {
    const featured = [...data.featuredMovies, ...data.featuredSeries].slice(0, 5);
    const first = data.movies[0] ?? data.series[0];
    const pool: Item[] = featured.length ? featured : first ? [first] : [];
    pool.forEach((i) => slides.push({ key: `i-${i.id}`, item: i, title: i.title, description: i.description, backdrop: i.backdrop_url || i.poster_url }));
  }
  if (!slides.length && defBanner.title) slides.push({ key: "default", item: null, title: defBanner.title, description: defBanner.subtitle ?? null, backdrop: defBanner.image_url ?? null });

  const empty = !all.length;

  return (
    <SiteShell padTop={false}>
      <Hero slides={slides} tagline={texts.tagline} />
      <div className="relative z-10 -mt-14 space-y-6 pb-10 md:space-y-8">
        {empty && <EmptyState icon={<Tv />} title="O catálogo está sendo preparado" text={texts.empty_catalog || "Os conteúdos publicados pelo painel administrativo aparecerão aqui automaticamente."} />}
        <ContinueWatchingRow />
        <Row title="Filmes em destaque" items={data.featuredMovies} action={<Link to="/filmes" className="text-sm text-primary hover:underline">Ver todos</Link>} />
        <Row title="Séries em destaque" items={data.featuredSeries} action={<Link to="/series" className="text-sm text-primary hover:underline">Ver todas</Link>} />
        <Row title="Lançamentos" items={data.releases} />
        <Row title="Populares" items={data.popular} />
        {!data.featuredMovies.length && <Row title="Filmes" items={data.movies} />}
        {!data.featuredSeries.length && <Row title="Séries" items={data.series} />}
        {data.moviesByGenre.map((g) => (
          <Row key={`m-${g.genre.id}`} title={`Filmes de ${g.genre.name}`} items={g.items}
            action={<Link to="/filmes" search={{ genero: g.genre.slug }} className="text-sm text-primary hover:underline">Ver mais</Link>} />
        ))}
        {data.seriesByGenre.map((g) => (
          <Row key={`s-${g.genre.id}`} title={`Séries de ${g.genre.name}`} items={g.items}
            action={<Link to="/series" search={{ genero: g.genre.slug }} className="text-sm text-primary hover:underline">Ver mais</Link>} />
        ))}
        <Row title="Canais ao vivo" items={data.channels} action={<Link to="/canais" className="text-sm text-primary hover:underline">Ver todos</Link>} />
        <MyListRow />
      </div>
    </SiteShell>
  );
}
