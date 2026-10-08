import { createFileRoute } from "@tanstack/react-router";
import { HomeManager } from "@/components/admin/home/HomeManager";

export const Route = createFileRoute("/admin/banners")({
  head:()=>({meta:[{title:"Banners da Home — Painel ADM"},{name:"description",content:"Gerencie banners desktop e celular da Home."},{property:"og:title",content:"Banners da Home — Painel ADM"},{property:"og:description",content:"Imagens, ordem e publicação dos banners da Home."},{property:"og:type",content:"website"},{name:"twitter:card",content:"summary"},{name:"robots",content:"noindex"}]}),
  component: () => <HomeManager initialTab="banners" />,
});
