import { Link } from "@tanstack/react-router";
import { useRef, type ReactNode } from "react";
import { ChevronLeft, ChevronRight, Play, Plus, Check, Radio } from "lucide-react";
import { toast } from "sonner";
import { formatDuration, itemParam, type Item } from "@/lib/catalog";
import { useWatchlist } from "@/lib/user-data";
import { Skeleton } from "@/components/ui/skeleton";

export function DetailLink({ item, children, className }: { item: Item; children: ReactNode; className?: string }) {
  const p = { slug: itemParam(item) };
  if (item.kind === "movie") return <Link to="/filme/$slug" params={p} className={className}>{children}</Link>;
  if (item.kind === "series") return <Link to="/serie/$slug" params={p} className={className}>{children}</Link>;
  return <Link to="/canal/$slug" params={p} className={className}>{children}</Link>;
}

export function WatchlistButton({ item, className = "" }: { item: Item; className?: string }) {
  const wl = useWatchlist();
  if (item.kind === "channel") return null;
  const inList = wl.has(item.id);
  return (
    <button
      type="button"
      aria-label={inList ? "Remover da minha lista" : "Adicionar à minha lista"}
      onClick={(e) => {
        e.preventDefault();
        e.stopPropagation();
        if (!wl.user) { toast.info("Entre na sua conta para usar a Minha lista."); return; }
        wl.toggle.mutate(
          { id: item.id, kind: item.kind as "movie" | "series" },
          {
            onSuccess: (added) => toast.success(added ? "Adicionado à Minha lista" : "Removido da Minha lista"),
            onError: (err) => toast.error(err instanceof Error ? err.message : "Não foi possível atualizar a lista"),
          },
        );
      }}
      className={`flex size-8 items-center justify-center rounded-full border border-foreground/40 bg-background/60 backdrop-blur transition hover:border-primary hover:text-primary ${className}`}
    >
      {inList ? <Check className="size-4" /> : <Plus className="size-4" />}
    </button>
  );
}

export function ContentCard({ item, size = "md" }: { item: Item; size?: "md" | "fluid" }) {
  const w = size === "fluid" ? "w-full" : "w-[38vw] max-w-44 sm:w-40 md:w-44";
  if (item.kind === "channel") {
    return (
      <DetailLink item={item} className={`group relative flex aspect-video shrink-0 flex-col items-center justify-center gap-2 rounded-xl border border-border bg-card p-4 transition duration-300 hover:-translate-y-1 hover:border-primary/50 hover:shadow-glow ${size === "fluid" ? "w-full" : "w-44 md:w-56"}`}>
        <span className="absolute left-2 top-2 flex items-center gap-1 rounded-full bg-destructive/90 px-2 py-0.5 text-[10px] font-semibold uppercase text-destructive-foreground"><Radio className="size-3" /> Ao vivo</span>
        {item.poster_url ? <img src={item.poster_url} alt={item.title} loading="lazy" decoding="async" className="max-h-14 max-w-[70%] object-contain" /> : <span className="font-display font-semibold">{item.title}</span>}
        {item.poster_url && <span className="truncate text-xs text-muted-foreground">{item.title}</span>}
      </DetailLink>
    );
  }
  const meta = [item.release_year, item.kind === "movie" ? formatDuration(item.duration_minutes) : "Série", item.age_rating].filter(Boolean);
  return (
    <DetailLink item={item} className={`group/card relative block shrink-0 ${w}`}>
      <div className="relative aspect-[2/3] overflow-hidden rounded-xl bg-card ring-1 ring-border transition-all duration-300 ease-out md:group-hover/card:z-10 md:group-hover/card:scale-[1.06] md:group-hover/card:shadow-glow md:group-hover/card:ring-primary/50">
        {item.poster_url ? (
          <img src={item.poster_url} alt={item.title} loading="lazy" decoding="async" className="h-full w-full object-cover" />
        ) : (
          <div className="flex h-full items-end bg-gradient-to-br from-accent to-card p-3 font-display text-sm font-semibold">{item.title}</div>
        )}
        {item.quality && <span className="absolute right-2 top-2 rounded-md bg-background/70 px-1.5 py-0.5 text-[10px] font-bold text-primary backdrop-blur">{item.quality}</span>}
        <div className="pointer-events-none absolute inset-x-0 bottom-0 translate-y-3 bg-fade p-3 pt-16 opacity-0 transition-all duration-300 md:group-hover/card:pointer-events-auto md:group-hover/card:translate-y-0 md:group-hover/card:opacity-100">
          <div className="mb-2 flex items-center gap-2">
            <span className="flex size-8 items-center justify-center rounded-full bg-primary text-primary-foreground"><Play className="size-4 fill-current" /></span>
            <WatchlistButton item={item} />
          </div>
          <p className="line-clamp-1 text-sm font-semibold">{item.title}</p>
          <p className="text-[11px] text-muted-foreground">{meta.join(" · ")}</p>
          {item.genres.length > 0 && <p className="mt-0.5 line-clamp-1 text-[11px] text-primary/90">{item.genres.slice(0, 3).map((g) => g.name).join(" • ")}</p>}
        </div>
      </div>
      <p className="mt-2 line-clamp-1 text-sm text-muted-foreground md:hidden">{item.title}</p>
    </DetailLink>
  );
}

export function Row({ title, items, action }: { title: string; items: Item[]; action?: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  if (!items.length) return null;
  const scroll = (dir: number) => ref.current?.scrollBy({ left: dir * ref.current.clientWidth * 0.8, behavior: "smooth" });
  return (
    <section className="group/row relative animate-rise" aria-label={title}>
      <div className="mx-auto flex max-w-[1600px] items-center justify-between px-4 md:px-10">
        <h2 className="text-lg font-semibold md:text-xl">{title}</h2>
        {action}
      </div>
      <div className="relative">
        <button aria-label="Anterior" onClick={() => scroll(-1)} className="absolute left-0 top-0 z-20 hidden h-full w-10 items-center justify-center bg-gradient-to-r from-background to-transparent opacity-0 transition group-hover/row:opacity-100 md:flex"><ChevronLeft /></button>
        <div ref={ref} className="flex snap-x gap-3 overflow-x-auto scroll-smooth px-4 py-5 [scrollbar-width:none] md:px-10 [&::-webkit-scrollbar]:hidden">
          {items.map((i) => <div key={`${i.kind}-${i.id}`} className="snap-start">{<ContentCard item={i} />}</div>)}
        </div>
        <button aria-label="Próximo" onClick={() => scroll(1)} className="absolute right-0 top-0 z-20 hidden h-full w-10 items-center justify-center bg-gradient-to-l from-background to-transparent opacity-0 transition group-hover/row:opacity-100 md:flex"><ChevronRight /></button>
      </div>
    </section>
  );
}

export function CardGrid({ items }: { items: Item[] }) {
  const channels = items[0]?.kind === "channel";
  return (
    <div className={`mx-auto grid max-w-[1600px] gap-x-3 gap-y-6 px-4 md:px-10 ${channels ? "grid-cols-2 sm:grid-cols-3 lg:grid-cols-5" : "grid-cols-3 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-6 2xl:grid-cols-8"}`}>
      {items.map((i) => <ContentCard key={`${i.kind}-${i.id}`} item={i} size="fluid" />)}
    </div>
  );
}

export function GridSkeleton({ count = 12 }: { count?: number }) {
  return (
    <div className="mx-auto grid max-w-[1600px] grid-cols-3 gap-3 px-4 sm:grid-cols-4 md:grid-cols-5 md:px-10 lg:grid-cols-6 2xl:grid-cols-8">
      {Array.from({ length: count }).map((_, i) => <Skeleton key={i} className="aspect-[2/3] rounded-xl" />)}
    </div>
  );
}

export function RowSkeleton() {
  return (
    <div className="mx-auto max-w-[1600px] space-y-3 px-4 md:px-10">
      <Skeleton className="h-6 w-48" />
      <div className="flex gap-3 overflow-hidden">
        {Array.from({ length: 8 }).map((_, i) => <Skeleton key={i} className="aspect-[2/3] w-40 shrink-0 rounded-xl md:w-44" />)}
      </div>
    </div>
  );
}
