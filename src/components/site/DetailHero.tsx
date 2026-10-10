import { useState } from "react";
import { Clapperboard } from "lucide-react";
import { formatDuration, type Item } from "@/lib/catalog";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { WatchlistButton } from "./ContentCard";
import type { ReactNode } from "react";

function trailerEmbed(url: string) {
  const yt = url.match(/(?:youtube\.com\/(?:watch\?v=|embed\/|shorts\/)|youtu\.be\/)([\w-]{6,})/);
  if (yt) return `https://www.youtube-nocookie.com/embed/${yt[1]}?autoplay=1&rel=0`;
  const vm = url.match(/vimeo\.com\/(\d+)/);
  if (vm) return `https://player.vimeo.com/video/${vm[1]}?autoplay=1`;
  return null;
}

/** Player first, followed by the existing poster and details (no separate banner). */
export function DetailHero({ item, extraMeta, player, flushPlayer = false }: { item: Item; extraMeta?: ReactNode; player?: ReactNode; flushPlayer?: boolean }) {
  const [trailer, setTrailer] = useState(false);
  const meta = [item.release_year, item.kind === "movie" ? formatDuration(item.duration_minutes) : null, item.quality, item.language, item.country].filter(Boolean);
  const embed = item.trailer_url ? trailerEmbed(item.trailer_url) : null;
  return (
    <section className="relative w-full overflow-hidden">
      {flushPlayer && player}
      <div className={`mx-auto flex max-w-[1600px] flex-col gap-8 px-4 pb-10 md:px-10 ${flushPlayer ? "pt-8" : "pt-20"}`}>
        {!flushPlayer && player && <div className="w-full min-w-0 max-w-5xl">{player}</div>}
        <div className="flex min-w-0 flex-col gap-8 md:flex-row md:items-start">
        {item.poster_url && <img src={item.poster_url} alt={`Pôster de ${item.title}`} className="aspect-[2/3] w-32 shrink-0 animate-rise rounded-2xl object-cover shadow-glow ring-1 ring-primary/30 md:w-44" />}
        <div className="flex min-w-0 max-w-3xl animate-rise flex-1 flex-col gap-4">
          <p className="text-xs font-semibold uppercase tracking-widest text-primary">{item.kind === "movie" ? "Filme" : "Série"}</p>
          <h1 className="text-3xl font-bold leading-tight md:text-5xl">{item.title}</h1>
          <div className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
            {item.age_rating && <span className="rounded border border-muted-foreground/60 px-1.5 text-xs">{item.age_rating}</span>}
            {meta.map((m, i) => <span key={i}>{i > 0 || item.age_rating ? "· " : ""}{m}</span>)}
            {extraMeta}
          </div>
          {item.genres.length > 0 && (
            <ul className="flex flex-wrap gap-2">
              {item.genres.map((g) => <li key={g.id} className="rounded-full border border-primary/30 bg-accent/50 px-3 py-1 text-xs text-accent-foreground">{g.name}</li>)}
            </ul>
          )}
          {item.description && <p className="text-muted-foreground md:text-lg">{item.description}</p>}
          <div className="flex flex-wrap items-center gap-3">
            {item.trailer_url && (
              <Button size="lg" variant="secondary" className="rounded-full" onClick={() => setTrailer(true)}><Clapperboard /> Trailer</Button>
            )}
            <WatchlistButton item={item} className="size-11" />
          </div>
        </div>
        </div>
      </div>
      {item.trailer_url && (
        <Dialog open={trailer} onOpenChange={setTrailer}>
          <DialogContent className="max-w-5xl overflow-hidden border-border bg-background p-0">
            <DialogTitle className="sr-only">Trailer de {item.title}</DialogTitle>
            <div className="aspect-video w-full">
              {trailer && (embed ? (
                <iframe src={embed} title={`Trailer de ${item.title}`} allow="autoplay; encrypted-media; fullscreen" allowFullScreen className="h-full w-full" />
              ) : (
                <video src={item.trailer_url} controls autoPlay className="h-full w-full" />
              ))}
            </div>
          </DialogContent>
        </Dialog>
      )}
    </section>
  );
}
