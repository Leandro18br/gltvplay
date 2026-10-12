import { requireSiteAccess } from "@/lib/access/gate";
import { createFileRoute, notFound, useNavigate } from "@tanstack/react-router";
import { useSuspenseQuery } from "@tanstack/react-query";
import { MonitorPlay } from "lucide-react";
import { channelCategoryMetaQuery } from "@/lib/catalog";
import { RetryState, SiteShell, PageTitle, EmptyState } from "@/components/site/SiteShell";
import { PagedGridSection } from "@/components/site/Pager";

const pageParam = (v: unknown) => (Number.isInteger(Number(v)) && Number(v) > 1 ? Number(v) : undefined);

export const Route = createFileRoute("/canais-categorias/$slug")({
  ssr: false,
  beforeLoad: requireSiteAccess,
  validateSearch: (s: Record<string, unknown>): { p?: number | undefined } => ({ p: pageParam(s["p"]) }),
  loader: async ({ context, params }) => {
    const d = await context.queryClient.ensureQueryData(channelCategoryMetaQuery(params.slug));
    if (!d) throw notFound();
    return { name: d.category.name, description: d.category.description };
  },
  head: ({ loaderData, params }) => {
    if (!loaderData) return { meta: [{ title: "Categoria indisponível" }, { name: "robots", content: "noindex" }] };
    const title = `${loaderData.name} — Streaming`;
    const desc = loaderData.description ?? `Canais ao vivo de ${loaderData.name}.`;
    return {
      meta: [
        { title }, { name: "description", content: desc },
        { property: "og:title", content: title }, { property: "og:description", content: desc },
        { property: "og:type", content: "website" }, { property: "og:url", content: `/canais-categorias/${params.slug}` },
        { name: "twitter:card", content: "summary" },
      ],
      links: [{ rel: "canonical", href: `/canais-categorias/${params.slug}` }],
    };
  },
  errorComponent: () => <RetryState title="Não foi possível carregar a categoria de canais" />,
  notFoundComponent: () => <SiteShell><EmptyState title="Categoria não encontrada" /></SiteShell>,
  component: Page,
});

function Page() {
  const { slug } = Route.useParams();
  const { p } = Route.useSearch();
  const navigate = useNavigate({ from: "/canais-categorias/$slug" });
  const go = (n: number) => navigate({ search: (prev) => ({ ...prev, p: n > 1 ? n : undefined }), replace: true });
  const { data } = useSuspenseQuery(channelCategoryMetaQuery(slug));
  if (!data) return <SiteShell><EmptyState icon={<MonitorPlay />} title="Nenhum canal nesta categoria" /></SiteShell>;
  return (
    <SiteShell>
      <PageTitle title={data.category.name} subtitle={data.category.description} />
      <PagedGridSection title="Canais" kind="channel" filter={{ categoryId: data.category.id }} page={p ?? 1} onChange={go} />
    </SiteShell>
  );
}
