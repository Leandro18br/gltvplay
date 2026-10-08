import type { HomeBanner } from "@/lib/home/model";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { ImageField } from "@/components/admin/ImageField";
import { ContentPicker } from "./ContentPicker";

export function BannerEditor({value,onChange}:{value:HomeBanner;onChange:(b:HomeBanner)=>void}) {
  const set=(patch:Partial<HomeBanner>)=>onChange({...value,...patch});
  return <div className="space-y-5">
    <div className="space-y-2"><Label htmlFor="banner-title">Título</Label><Input id="banner-title" maxLength={120} value={value.title} onChange={e=>set({title:e.target.value})} /></div>
    <div className="space-y-2"><Label>Imagem desktop</Label><ImageField value={value.desktop} onChange={v=>set({desktop:v??""})} folder="home/desktop" /></div>
    <div className="space-y-2"><Label>Imagem celular</Label><ImageField value={value.mobile} onChange={v=>set({mobile:v??""})} folder="home/mobile" aspect="aspect-[3/4]" /></div>
    <div className="space-y-2"><Label htmlFor="banner-subtitle">Subtítulo</Label><Input id="banner-subtitle" value={value.subtitle} onChange={e=>set({subtitle:e.target.value})} /></div>
    <div className="space-y-2"><Label htmlFor="banner-description">Descrição</Label><Textarea id="banner-description" value={value.description} onChange={e=>set({description:e.target.value})} /></div>
    <div className="space-y-2"><Label>Conteúdo relacionado</Label><ContentPicker value={value.content?[value.content]:[]} onChange={refs=>set({content:refs[0]??null})} single kind="mixed" /></div>
    <div className="space-y-2"><Label htmlFor="banner-cta">Texto do botão Assistir</Label><Input id="banner-cta" value={value.cta} onChange={e=>set({cta:e.target.value})} /></div>
    {!value.content && <div className="space-y-2"><Label htmlFor="banner-link">Link do botão</Label><Input id="banner-link" value={value.href} onChange={e=>set({href:e.target.value})} placeholder="https://…" /></div>}
    {([['active','Banner ativo'],['watch','Mostrar Assistir'],['info','Mostrar Mais informações']] as const).map(([key,label])=><div key={key} className="flex items-center justify-between gap-3"><Label htmlFor={`banner-${key}`}>{label}</Label><Switch id={`banner-${key}`} checked={value[key]} onCheckedChange={v=>set({[key]:v})} /></div>)}
  </div>;
}