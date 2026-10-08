import { Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { Play } from "lucide-react";
import { continueWatchingQuery, useActiveProfile, useWatchlist } from "@/lib/user-data";
import { Row } from "./ContentCard";

export function ContinueWatchingRow({ title = "Continue assistindo", limit = 20, showAll = false }: { title?: string; limit?: number; showAll?: boolean } = {}) {
  const { user, profileId, loading } = useActiveProfile();
  const { data = [] } = useQuery({ ...continueWatchingQuery(user?.id ?? "none", profileId), enabled: !!user && !loading });
  if (!user || !data.length) return null;
  return (
    <section aria-label={title} className="animate-rise">
      <div className="mx-auto grid max-w-[1600px] grid-cols-[minmax(0,1fr)_auto] items-center gap-3 px-4 md:px-10"><h2 className="min-w-0 text-lg font-semibold md:text-xl">{title}</h2>{showAll && <Link to="/perfil" className="text-sm text-primary">Ver todos ›</Link>}</div>
      <div className="flex gap-3 overflow-x-auto px-4 py-5 [scrollbar-width:none] md:px-10">
        {data.slice(0, limit).map((c) => (
          <Link key={c.contentId} to="/assistir/$kind/$id" params={{ kind: c.kind, id: c.contentId }}
            className="group relative w-64 shrink-0 overflow-hidden rounded-xl bg-card ring-1 ring-border transition hover:ring-primary/50 md:w-80">
            <div className="relative aspect-video">
              {c.image ? <img src={c.image} alt="" loading="lazy" className="h-full w-full object-cover transition duration-500 group-hover:scale-105" /> : <div className="h-full bg-accent" />}
              <div className="absolute inset-0 flex items-center justify-center bg-background/30 opacity-0 transition group-hover:opacity-100">
                <span className="flex size-12 items-center justify-center rounded-full bg-primary text-primary-foreground"><Play className="fill-current" /></span>
              </div>
              <div className="absolute inset-x-0 bottom-0 h-1 bg-foreground/20"><div className="h-full bg-primary" style={{ width: `${c.percent}%` }} /></div>
            </div>
            <div className="p-3">
              <p className="truncate text-sm font-semibold">{c.title}</p>
              {c.subtitle && <p className="truncate text-xs text-muted-foreground">{c.subtitle}</p>}
            </div>
          </Link>
        ))}
      </div>
    </section>
  );
}

export function MyListRow({ title = "Minha lista", limit = 20, showAll = true }: { title?: string; limit?: number; showAll?: boolean } = {}) {
  const wl = useWatchlist();
  if (!wl.user) return null;
  return <Row title={title} items={wl.items.slice(0, limit)} action={showAll ? <Link to="/minha-lista" className="text-sm text-primary hover:underline">Ver todos ›</Link> : undefined} />;
}
