import { requireSiteAccess } from "@/lib/access/gate";
import { createFileRoute, notFound } from "@tanstack/react-router";
import { useSuspenseQuery } from "@tanstack/react-query";
import { publishedHomeQuery } from "@/lib/home/queries";
import { SiteShell, PageTitle, RetryState, EmptyState } from "@/components/site/SiteShell";
import { CardGrid } from "@/components/site/ContentCard";
export const Route=createFileRoute("/home/secoes/$id")({
  ssr: false,
  beforeLoad: requireSiteAccess,
  loader:async({context,params})=>{const home=await context.queryClient.ensureQueryData(publishedHomeQuery);const section=home.sections.find(s=>s.section.id===params.id);if(!section)throw notFound();return {title:section.section.title,name:home.platformName};},
  head:({loaderData})=>({meta:[{title:loaderData?`${loaderData.title} — ${loaderData.name}`:"Seção indisponível"},{name:"description",content:`Explore ${loaderData?.title??"os conteúdos"} da plataforma.`},{property:"og:title",content:loaderData?.title??"Seção indisponível"},{property:"og:description",content:"Seleção de filmes, séries e canais."},{property:"og:type",content:"website"},{name:"twitter:card",content:"summary_large_image"}]}),
  errorComponent:()=> <RetryState title="Não foi possível carregar a seção" />,
  notFoundComponent:()=> <SiteShell><EmptyState title="Seção indisponível" /></SiteShell>,
  component:SectionPage,
});
function SectionPage(){const {id}=Route.useParams();const {data}=useSuspenseQuery(publishedHomeQuery);const section=data.sections.find(s=>s.section.id===id);return <SiteShell>{section?<><PageTitle title={section.section.title} /><CardGrid items={section.items} />{!section.items.length&&<EmptyState title="Nenhum conteúdo disponível" />}</>:<EmptyState title="Seção indisponível" />}</SiteShell>;}