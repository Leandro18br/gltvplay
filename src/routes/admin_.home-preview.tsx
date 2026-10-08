import { createFileRoute, redirect } from "@tanstack/react-router";
import { useSuspenseQuery, queryOptions } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { previewHomeDraft } from "@/lib/home/home.functions";
import { SiteShell, RetryState, EmptyState } from "@/components/site/SiteShell";
import { HomeContent } from "@/components/site/HomeContent";
const previewQuery=queryOptions({queryKey:["admin","home-preview"],queryFn:()=>previewHomeDraft(),staleTime:0});
export const Route=createFileRoute("/admin_/home-preview")({
  ssr:false,
  beforeLoad:async()=>{const {data}=await supabase.auth.getUser();if(!data.user)throw redirect({to:"/admin/login"});const role=await supabase.rpc("is_staff",{_user_id:data.user.id});if(!role.data)throw redirect({to:"/admin/login"});},
  loader:({context})=>context.queryClient.ensureQueryData(previewQuery),
  head:()=>({meta:[{title:"Prévia da Home — Painel ADM"},{name:"description",content:"Visualização privada do rascunho da Home."},{property:"og:title",content:"Prévia da Home — Painel ADM"},{property:"og:description",content:"Visualização privada da página inicial."},{property:"og:type",content:"website"},{name:"twitter:card",content:"summary"},{name:"robots",content:"noindex"}]}),
  pendingComponent:()=> <div className="p-10 text-muted-foreground">Carregando prévia…</div>,
  errorComponent:()=> <RetryState title="Não foi possível carregar a prévia" />,
  notFoundComponent:()=> <EmptyState title="Prévia indisponível" />,
  component:Preview,
});
function Preview(){const {data}=useSuspenseQuery(previewQuery);return <SiteShell padTop={false}><HomeContent data={data} /></SiteShell>;}