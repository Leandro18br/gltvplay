import { requireSiteAccess } from "@/lib/access/gate";
import { createFileRoute, notFound, useNavigate } from "@tanstack/react-router";
import { useSuspenseQuery } from "@tanstack/react-query";
import { Film } from "lucide-react";
import { categoryQuery } from "@/lib/catalog";
import { RetryState, SiteShell, PageTitle, EmptyState } from "@/components/site/SiteShell";
import { PagedGridSection } from "@/components/site/Pager";

const pageParam = (v: unknown) => (Number.isInteger(Number(v)) && Number(v) > 1 ? Number(v) : undefined);

export const Route = createFileRoute("/categoria/$slug")({
  ssr: false,
  beforeLoad: requireSiteAccess,
  validateSearch: (s: Record<string, unknown>): { pf?: number | undefined; ps?: number | undefined } => ({ pf: pageParam(s["pf"]), ps: pageParam(s["ps"]) }),
  loader: async ({ context, params }) => {
    const d = await context.queryClient.ensureQueryData(categoryQuery(params.slug));
    if (!d) throw notFound();
    return { name: d.category.name, description: d.category.description };
  },
  head: ({ loaderData, params }) => {
    if (!loaderData) return { meta: [{ title: "Categoria indisponível" }, { name: "robots", content: "noindex" }] };
    const title = `${loaderData.name} — Streaming`;
    const desc = loaderData.description ?? `Filmes, séries e canais de ${loaderData.name}.`;
    return {
      meta: [
        { title }, { name: "description", content: desc },
        { property: "og:title", content: title }, { property: "og:description", content: desc },
        { property: "og:type", content: "website" }, { property: "og:url", content: `/categoria/${params.slug}` },
        { name: "twitter:card", content: "summary" },
      ],
      links: [{ rel: "canonical", href: `/categoria/${params.slug}` }],
    };
  },
  errorComponent: () => <RetryState title="Não foi possível carregar a categoria" />,
  notFoundComponent: () => <SiteShell><EmptyState title="Categoria não encontrada" /></SiteShell>,
  component: Page,
});

function Page() {
  const { slug } = Route.useParams();
  const { pf, ps } = Route.useSearch();
  const navigate = useNavigate({ from: "/categoria/$slug" });
  const go = (key: "pf" | "ps") => (n: number) => navigate({ search: (prev) => ({ ...prev, [key]: n > 1 ? n : undefined }), replace: true });
  const { data } = useSuspenseQuery(categoryQuery(slug));
  if (!data) return null;
  const empty = !data.movies.length && !data.series.length;
  return (
    <SiteShell>
      <PageTitle title={data.category.name} subtitle={data.category.description} />
      {empty ? <EmptyState icon={<Film />} title="Ainda não há conteúdos nesta categoria" /> : (
        <div className="space-y-4">
          <PagedGridSection title="Filmes" kind="movie" filter={{ categoryId: data.category.id }} page={pf ?? 1} onChange={go("pf")} />
          <PagedGridSection title="Séries" kind="series" filter={{ categoryId: data.category.id }} page={ps ?? 1} onChange={go("ps")} />
        </div>
      )}
    </SiteShell>
  );
}
