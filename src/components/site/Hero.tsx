import { Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { Play, Info, ChevronLeft, ChevronRight } from "lucide-react";
import { formatDuration, itemParam, type Item } from "@/lib/catalog";
import { Button } from "@/components/ui/button";
import { DetailLink, WatchlistButton } from "./ContentCard";

export type HeroSlide = {
  key: string;
  item: Item | null;
  title: string;
  description: string | null;
  backdrop: string | null;
  cta?: string | null;
  href?: string | null;
  mobile?: string | null;
  showWatch?: boolean;
  showInfo?: boolean;
};

export function WatchButton({ item, label = "Assistir", size = "lg" }: { item: Item; label?: string; size?: "lg" | "default" }) {
  const cls = "rounded-full px-7";
  if (item.kind === "series")
    return <Button asChild size={size} className={cls}><Link to="/serie/$slug" params={{ slug: itemParam(item) }} hash="episodios"><Play className="fill-current" /> {label}</Link></Button>;
  return (
    <Button asChild size={size} className={cls}>
      <Link to="/assistir/$kind/$id" params={{ kind: item.kind, id: item.id }}><Play className="fill-current" /> {label}</Link>
    </Button>
  );
}

export function Hero({ slides, tagline }: { slides: HeroSlide[]; tagline?: string | undefined }) {
  const [idx, setIdx] = useState(0);
  const [paused, setPaused] = useState(false);
  const [touchStart, setTouchStart] = useState<number | null>(null);
  const current = idx < slides.length ? idx : 0;
  const change = (delta: number) => setIdx(i => (i + delta + slides.length) % slides.length);
  useEffect(() => {
    if (slides.length < 2 || paused || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const t = setInterval(() => setIdx((i) => (i + 1) % slides.length), 9000);
    return () => clearInterval(t);
  }, [slides.length, paused]);
  const s = slides[current] ?? slides[0];
  if (!s) return <div className="h-24" />;
  const it = s.item;
  const meta = it ? [it.release_year, it.age_rating, it.kind === "movie" ? formatDuration(it.duration_minutes) : it.kind === "series" ? "Série" : null, it.quality].filter(Boolean) : [];

  return (
    <section aria-label="Destaque" aria-roledescription="carrossel" onMouseEnter={() => setPaused(true)} onMouseLeave={() => setPaused(false)} onFocusCapture={() => setPaused(true)} onBlurCapture={() => setPaused(false)} onTouchStart={e => setTouchStart(e.touches[0]?.clientX ?? null)} onTouchEnd={e => { const end = e.changedTouches[0]?.clientX; if(touchStart !== null && end !== undefined && Math.abs(end-touchStart)>50) change(end<touchStart ? 1 : -1); setTouchStart(null); }} className="relative h-[76svh] min-h-[520px] max-h-[850px] w-full overflow-hidden md:h-[80vh]">
      {slides.map((x, i) => (
        x.backdrop || x.mobile ? (
          <picture key={x.key} className={`absolute inset-0 transition-opacity duration-1000 motion-reduce:transition-none ${i === current ? "opacity-100" : "opacity-0"}`}>
            {x.mobile && <source media="(max-width: 767px)" srcSet={x.mobile} />}
            <img src={x.backdrop || x.mobile || undefined} alt="" fetchPriority={i === 0 ? "high" : "low"} loading={i === 0 ? "eager" : "lazy"} className="h-full w-full object-cover" />
          </picture>
        ) : null
      ))}
      {!s.backdrop && !s.mobile && <div className="absolute inset-0 bg-card" />}
      <div className="absolute inset-0 bg-side-fade" />
      <div className="absolute inset-0 bg-fade" />
      <div key={s.key} className="relative mx-auto flex h-full max-w-[1600px] items-end gap-8 px-4 pb-20 md:px-10 md:pb-24">
        {it?.poster_url && (
          <img src={it.poster_url} alt={it.title} className="hidden aspect-[2/3] w-52 shrink-0 animate-rise rounded-2xl object-cover shadow-glow ring-1 ring-primary/30 xl:block" />
        )}
        <div className="flex min-w-0 max-w-2xl animate-rise flex-col gap-4">
          <span className="w-fit rounded-full border border-primary/40 bg-accent/60 px-3 py-1 text-xs font-medium text-accent-foreground backdrop-blur">{tagline || "Em destaque"}</span>
          <h1 className="break-words text-3xl font-bold leading-tight md:text-5xl">{s.title}</h1>
          {meta.length > 0 && (
            <p className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
              {meta.map((m, i) => <span key={i} className={i === 1 && it?.age_rating ? "rounded border border-muted-foreground/50 px-1.5 text-xs" : ""}>{m}</span>)}
            </p>
          )}
          {it && it.genres.length > 0 && <p className="text-sm text-primary">{it.genres.map((g) => g.name).join(" • ")}</p>}
          {s.description && <p className="line-clamp-3 text-muted-foreground md:text-lg">{s.description}</p>}
          <div className="flex flex-wrap items-center gap-3 pt-1">
             {s.showWatch !== false && (it ? <WatchButton item={it} label={s.cta || "Assistir"} /> : s.href ? (
              <Button asChild size="lg" className="rounded-full px-7"><a href={s.href}><Play className="fill-current" /> {s.cta || "Assistir"}</a></Button>
             ) : null)}
             {it && s.showInfo !== false && (
              <Button asChild size="lg" variant="secondary" className="rounded-full">
                <DetailLink item={it}><Info /> Mais informações</DetailLink>
              </Button>
            )}
            {it && <WatchlistButton item={it} className="size-11" />}
          </div>
        </div>
      </div>
      {slides.length > 1 && (
        <div className="absolute inset-x-4 bottom-5 flex items-center justify-between gap-3 md:inset-x-10">
          <div className="flex gap-2"><Button size="icon" variant="secondary" className="size-8 rounded-full" aria-label="Banner anterior" onClick={() => change(-1)}><ChevronLeft /></Button><Button size="icon" variant="secondary" className="size-8 rounded-full" aria-label="Próximo banner" onClick={() => change(1)}><ChevronRight /></Button></div>
          <div className="flex flex-wrap justify-end gap-1">
          {slides.map((x, i) => (
            <Button key={x.key} variant="ghost" size="icon" aria-label={`Destaque ${i + 1}`} aria-pressed={i === current} onClick={() => setIdx(i)} className="size-6 rounded-full p-0"><span className={`h-1.5 rounded-full transition-all ${i === current ? "w-6 bg-primary" : "w-2 bg-foreground/30"}`} /></Button>
          ))}
          </div>
        </div>
      )}
    </section>
  );
}
