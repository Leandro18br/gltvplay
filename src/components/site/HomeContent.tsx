import { Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import type { ResolvedHome, ResolvedSection } from "@/lib/home/model";
import { genresQuery, categoriesQuery } from "@/lib/catalog";
import { Hero } from "./Hero";
import { Row } from "./ContentCard";
import { ContinueWatchingRow, MyListRow } from "./UserRows";
import { EmptyState } from "./SiteShell";

function SectionAction({ data }: { data: ResolvedSection }) {
  const {section} = data;
  const { data: genres = [] } = useQuery(genresQuery);
  const { data: categories = [] } = useQuery(categoriesQuery);
  if (!section.showAll) return null;
  const cls = "shrink-0 text-xs text-primary hover:underline md:text-sm";
  const category = categories.find(c => c.id === section.filters.category);
  if (category) return <Link to="/categoria/$slug" params={{slug:category.slug}} className={cls}>Ver todos ›</Link>;
  const genre = genres.find(g => g.id === section.filters.genre);
  if(section.type === "series") return <Link to="/series" search={{genero:genre?.slug}} className={cls}>Ver todos ›</Link>;
  if(section.type === "channels") return <Link to="/canais" className={cls}>Ver todos ›</Link>;
  if(section.type === "categories") return <Link to="/categorias" className={cls}>Ver todos ›</Link>;
  return <Link to="/home/secoes/$id" params={{id:section.id}} className={cls}>Ver todos ›</Link>;
}
export function HomeContent({data}: {data:ResolvedHome}) {
  if(!data.sections.length) return <div className="pt-24"><EmptyState title="A programação está sendo preparada" /></div>;
  return <div className="space-y-6 pb-10 md:space-y-8">
    {data.sections.map(resolved => {
      const s = resolved.section;
      if(s.type === "hero") return data.slides.length ? <Hero key={s.id} slides={data.slides} /> : null;
      if(s.type === "continue") return <ContinueWatchingRow key={s.id} title={s.title} limit={s.limit} showAll={s.showAll} />;
      if(s.type === "watchlist") return <MyListRow key={s.id} title={s.title} limit={s.limit} showAll={s.showAll} />;
      if(s.type === "categories") return resolved.categories.length ? <section key={s.id} aria-label={s.title}>
        <div className="mx-auto grid max-w-[1600px] grid-cols-[minmax(0,1fr)_auto] items-center gap-3 px-4 md:px-10"><h2 className="min-w-0 text-lg font-semibold md:text-xl">{s.title}</h2><SectionAction data={resolved} /></div>
        <div className="flex snap-x gap-3 overflow-x-auto px-4 py-5 [scrollbar-width:none] md:px-10">{resolved.categories.map(c=><Link key={c.id} to="/categoria/$slug" params={{slug:c.slug}} className="relative aspect-video w-[38vw] max-w-64 shrink-0 snap-start overflow-hidden rounded-xl bg-card ring-1 ring-border transition hover:ring-primary">
          {c.image_url && <img src={c.image_url} alt="" loading="lazy" className="h-full w-full object-cover" />}<div className="absolute inset-0 bg-fade" /><span className="absolute inset-x-3 bottom-3 break-words font-semibold">{c.name}</span>
        </Link>)}</div>
      </section> : null;
      return <Row key={s.id} title={s.title} items={resolved.items} action={<SectionAction data={resolved} />} />;
    })}
  </div>;
}