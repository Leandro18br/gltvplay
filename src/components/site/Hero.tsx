import { Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { Play, Info } from "lucide-react";
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

export function Hero({ slides, tagline }: { slides: HeroSlide[]; tagline?: string }) {
  const [idx, setIdx] = useState(0);
  useEffect(() => {
    if (slides.length < 2) return;
    const t = setInterval(() => setIdx((i) => (i + 1) % slides.length), 9000);
    return () => clearInterval(t);
  }, [slides.length]);
  const s = slides[idx] ?? slides[0];
  if (!s) return <div className="h-24" />;
  const it = s.item;
  const meta = it ? [it.release_year, it.age_rating, it.kind === "movie" ? formatDuration(it.duration_minutes) : it.kind === "series" ? "Série" : null, it.quality].filter(Boolean) : [];

  return (
    <section aria-label="Destaque" className="relative h-[82vh] min-h-[560px] w-full overflow-hidden md:h-[88vh]">
      {slides.map((x, i) => (
        x.backdrop ? (
          <img key={x.key} src={x.backdrop} alt="" fetchPriority={i === 0 ? "high" : "low"} loading={i === 0 ? "eager" : "lazy"}
            className={`absolute inset-0 h-full w-full object-cover transition-opacity duration-1000 ${i === idx ? "opacity-100" : "opacity-0"}`} />
        ) : null
      ))}
      {!s.backdrop && <div className="absolute inset-0 bg-gradient-to-br from-accent via-background to-background" />}
      <div className="absolute inset-0 bg-side-fade" />
      <div className="absolute inset-0 bg-fade" />
      <div key={s.key} className="relative mx-auto flex h-full max-w-[1600px] items-end gap-8 px-4 pb-24 md:px-10 md:pb-28">
        {it?.poster_url && (
          <img src={it.poster_url} alt={it.title} className="hidden aspect-[2/3] w-52 shrink-0 animate-rise rounded-2xl object-cover shadow-glow ring-1 ring-primary/30 xl:block" />
        )}
        <div className="flex min-w-0 max-w-2xl animate-rise flex-col gap-4">
          <span className="w-fit rounded-full border border-primary/40 bg-accent/60 px-3 py-1 text-xs font-medium text-accent-foreground backdrop-blur">{tagline || "Em destaque"}</span>
          <h1 className="text-4xl font-bold leading-[1.05] md:text-6xl">{s.title}</h1>
          {meta.length > 0 && (
            <p className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
              {meta.map((m, i) => <span key={i} className={i === 1 && it?.age_rating ? "rounded border border-muted-foreground/50 px-1.5 text-xs" : ""}>{m}</span>)}
            </p>
          )}
          {it && it.genres.length > 0 && <p className="text-sm text-primary">{it.genres.map((g) => g.name).join(" • ")}</p>}
          {s.description && <p className="line-clamp-3 text-muted-foreground md:text-lg">{s.description}</p>}
          <div className="flex flex-wrap items-center gap-3 pt-1">
            {it ? <WatchButton item={it} label={s.cta || "Assistir"} /> : s.href ? (
              <Button asChild size="lg" className="rounded-full px-7"><a href={s.href}><Play className="fill-current" /> {s.cta || "Assistir"}</a></Button>
            ) : null}
            {it && (
              <Button asChild size="lg" variant="secondary" className="rounded-full">
                <DetailLink item={it}><Info /> Mais informações</DetailLink>
              </Button>
            )}
            {it && <WatchlistButton item={it} className="size-11" />}
          </div>
        </div>
      </div>
      {slides.length > 1 && (
        <div className="absolute bottom-10 right-4 flex gap-1.5 md:right-10">
          {slides.map((x, i) => (
            <button key={x.key} aria-label={`Destaque ${i + 1}`} onClick={() => setIdx(i)} className={`h-1.5 rounded-full transition-all ${i === idx ? "w-8 bg-primary" : "w-3 bg-foreground/30"}`} />
          ))}
        </div>
      )}
    </section>
  );
}
