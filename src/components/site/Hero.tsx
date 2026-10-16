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
  logo?: string | null;
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
  const meta = it ? [it.release_year, it.age_rating, it.kind === "movie" ? formatDuration(it.duration_minutes) : it.kind === "series" ? "Série" : null, it.language?.toUpperCase(), it.quality].filter(Boolean) : [];

  return (
    <section aria-label="Destaque" aria-roledescription="carrossel" onMouseEnter={() => setPaused(true)} onMouseLeave={() => { if (document.documentElement.dataset.remoteNavigation !== 'true') setPaused(false); }} onFocusCapture={() => setPaused(true)} onBlurCapture={event => { if (document.documentElement.dataset.remoteNavigation !== 'true' && !event.currentTarget.contains(event.relatedTarget)) setPaused(false); }} onTouchStart={e => setTouchStart(e.touches[0]?.clientX ?? null)} onTouchEnd={e => { const end = e.changedTouches[0]?.clientX; if(touchStart !== null && end !== undefined && Math.abs(end-touchStart)>50) change(end<touchStart ? 1 : -1); setTouchStart(null); }} className="relative h-[78svh] min-h-[480px] max-h-[900px] w-full overflow-hidden bg-background md:h-[85vh]">
      {slides.map((x, i) => (
        x.backdrop || x.mobile ? (
          <picture key={x.key} aria-hidden={i !== current} className={`absolute inset-0 block h-full w-full transition-[opacity,transform] duration-1000 ease-out motion-reduce:transition-none ${i === current ? "scale-100 opacity-100" : "scale-105 opacity-0"}`}>
            {x.mobile && <source media="(max-width: 767px)" srcSet={x.mobile} />}
            <img src={x.backdrop || x.mobile || undefined} alt="" fetchPriority={i === 0 ? "high" : "low"} loading={i === 0 ? "eager" : "lazy"} className="absolute inset-0 h-full w-full object-cover object-[50%_25%] md:object-center" />
          </picture>
        ) : null
      ))}
      {!s.backdrop && !s.mobile && <div className="absolute inset-0 bg-card" />}
      <div className="pointer-events-none absolute inset-0 bg-gradient-to-r from-background/90 via-background/40 to-transparent" />
      <div className="pointer-events-none absolute inset-0 bg-gradient-to-t from-background via-background/30 to-background/10" />
      <div className="relative mx-auto flex h-full max-w-[1600px] items-end px-4 pb-16 md:px-10 md:pb-24">
        <div className="flex min-w-0 max-w-2xl animate-rise flex-col gap-4">
          <span className="w-fit text-xs font-semibold uppercase tracking-[0.2em] text-primary">{tagline || "Em destaque"}</span>
          {s.logo ? <img src={s.logo} alt={s.title} className="max-h-24 w-auto max-w-[80%] object-contain object-left drop-shadow-lg md:max-h-36" /> : <h1 className="break-words text-4xl font-bold leading-tight drop-shadow-lg md:text-6xl">{s.title}</h1>}
          {meta.length > 0 && (
            <p className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
              {meta.map((m, i) => <span key={i} className={i === 1 && it?.age_rating ? "rounded border border-muted-foreground/50 px-1.5 text-xs" : ""}>{m}</span>)}
            </p>
          )}
          {it && it.genres.length > 0 && <p className="text-sm text-primary">{it.genres.map((g) => g.name).join(" • ")}</p>}
          {s.description && <p className="line-clamp-2 text-foreground/80 md:line-clamp-3 md:text-lg">{s.description}</p>}
          <div className="flex flex-wrap items-center gap-3 pt-1">
             {s.showWatch !== false && (it ? <WatchButton item={it} label={s.cta || "Assistir Agora"} /> : s.href ? (
              <Button asChild size="lg" className="rounded-full px-7"><a href={s.href}><Play className="fill-current" /> {s.cta || "Assistir Agora"}</a></Button>
             ) : null)}
             {it && s.showInfo !== false && (
              <Button asChild size="lg" variant="outline" className="rounded-full border-foreground/30 bg-background/30 backdrop-blur hover:bg-background/50">
                <DetailLink item={it}><Info /> Mais Info</DetailLink>
              </Button>
            )}
            {it && <WatchlistButton item={it} className="size-11" />}
          </div>
        </div>
      </div>
      {slides.length > 1 && (
        <div className="absolute inset-x-4 bottom-4 z-10 flex items-center justify-center gap-3 md:inset-x-10 md:justify-between">
          <div className="hidden gap-2 md:flex"><Button size="icon" variant="secondary" className="size-8 rounded-full" aria-label="Banner anterior" onClick={() => change(-1)}><ChevronLeft /></Button><Button size="icon" variant="secondary" className="size-8 rounded-full" aria-label="Próximo banner" onClick={() => change(1)}><ChevronRight /></Button></div>
          <div className="flex flex-wrap justify-center gap-1 md:justify-end">
          {slides.map((x, i) => (
            <Button key={x.key} variant="ghost" size="icon" aria-label={`Destaque ${i + 1}`} aria-pressed={i === current} onClick={() => setIdx(i)} className="size-6 rounded-full p-0"><span className={`h-1.5 rounded-full transition-all ${i === current ? "w-7 bg-primary" : "w-2 bg-muted-foreground/60"}`} /></Button>
          ))}
          </div>
        </div>
      )}
    </section>
  );
}
