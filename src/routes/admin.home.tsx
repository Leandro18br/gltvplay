import { createFileRoute } from "@tanstack/react-router";
import { HomeManager } from "@/components/admin/home/HomeManager";
export const Route = createFileRoute("/admin/home")({
  head:()=>({meta:[{title:"Home do site — Painel ADM"},{name:"description",content:"Gerencie seções, banners e publicação da página inicial."},{property:"og:title",content:"Home do site — Painel ADM"},{property:"og:description",content:"Construtor da página inicial da plataforma."},{property:"og:type",content:"website"},{name:"twitter:card",content:"summary"},{name:"robots",content:"noindex"}]}),
  component:HomeManager,
});