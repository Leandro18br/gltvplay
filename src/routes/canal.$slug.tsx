import { createFileRoute, Link, notFound } from "@tanstack/react-router";
import { useSuspenseQuery } from "@tanstack/react-query";
import { Play, Radio } from "lucide-react";
import { channelDetailQuery } from "@/lib/catalog";
import { RetryState, SiteShell, EmptyState } from "@/components/site/SiteShell";
import { Row } from "@/components/site/ContentCard";
import { Button } from "@/components/ui/button";

export const Route = createFileRoute("/canal/$slug")({
  loader: async ({ context, params }) => {
    const data = await context.queryClient.ensureQueryData(channelDetailQuery(params.slug));
    if (!data) throw notFound();
    return { title: data.item.title, description: data.item.description };
  },
  head: ({ loaderData, params }) => {
    if (!loaderData) return { meta: [{ title: "Indisponível — Streaming" }, { name: "robots", content: "noindex" }] };
    const title = `${loaderData.title} ao vivo — Streaming`;
    const desc = (loaderData.description ?? `Assista ${loaderData.title} ao vivo.`).slice(0, 160);
    return {
      meta: [
        { title }, { name: "description", content: desc },
        { property: "og:title", content: title }, { property: "og:description", content: desc },
        { property: "og:type", content: "website" }, { property: "og:url", content: `/canal/${params.slug}` },
        { name: "twitter:card", content: "summary" },
      ],
      links: [{ rel: "canonical", href: `/canal/${params.slug}` }],
    };
  },
  errorComponent: () => <RetryState title="Não foi possível carregar este canal" />,
  notFoundComponent: () => <SiteShell><EmptyState title="Canal não encontrado" /></SiteShell>,
  component: ChannelPage,
});

function ChannelPage() {
  const { slug } = Route.useParams();
  const { data } = useSuspenseQuery(channelDetailQuery(slug));
  if (!data) return null;
  const c = data.item;
  return (
    <SiteShell>
      <article className="mx-auto max-w-[1600px] px-4 md:px-10">
        <div className="flex flex-col items-start gap-8 rounded-3xl border border-border bg-gradient-to-br from-accent/60 to-card p-6 md:flex-row md:items-center md:p-10">
          <div className="flex size-36 shrink-0 items-center justify-center rounded-2xl bg-background/60 p-5 ring-1 ring-primary/30">
            {c.poster_url ? <img src={c.poster_url} alt={c.title} className="max-h-full object-contain" /> : <Radio className="size-10 text-primary" />}
          </div>
          <div className="min-w-0 space-y-3">
            <span className="inline-flex items-center gap-1 rounded-full bg-destructive/90 px-2.5 py-0.5 text-xs font-semibold uppercase text-destructive-foreground"><Radio className="size-3" /> Ao vivo</span>
            <h1 className="text-3xl font-bold md:text-5xl">{c.title}</h1>
            {c.description && <p className="max-w-2xl text-muted-foreground">{c.description}</p>}
            <Button asChild size="lg" className="rounded-full px-7"><Link to="/assistir/$kind/$id" params={{ kind: "channel", id: c.id }}><Play className="fill-current" /> Assistir ao vivo</Link></Button>
          </div>
        </div>
      </article>
      <div className="py-10"><Row title="Outros canais" items={data.others} /></div>
    </SiteShell>
  );
}
