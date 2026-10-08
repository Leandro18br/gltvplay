import { useQuery } from "@tanstack/react-query";
import { genresQuery, categoriesQuery } from "@/lib/catalog";
import { sectionTypes, sortTypes, type HomeSection } from "@/lib/home/model";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ContentPicker } from "./ContentPicker";

export function Options({value,onChange,options,label}:{value:string;onChange:(v:string)=>void;options:Record<string,string>;label:string}) {
  return <Select value={value} onValueChange={onChange}><SelectTrigger aria-label={label}><SelectValue /></SelectTrigger><SelectContent>{Object.entries(options).map(([v,title])=><SelectItem key={v} value={v}>{title}</SelectItem>)}</SelectContent></Select>;
}
export function SectionEditor({value,onChange}:{value:HomeSection;onChange:(s:HomeSection)=>void}) {
  const {data:genres=[]}=useQuery(genresQuery);const {data:categories=[]}=useQuery(categoriesQuery);
  const set=(patch:Partial<HomeSection>)=>onChange({...value,...patch});
  const personal=["continue","watchlist"].includes(value.type);
  const hero=value.type==="hero";
  return <div className="space-y-5">
    <div className="space-y-2"><Label htmlFor="section-title">Título da seção</Label><Input id="section-title" value={value.title} maxLength={120} onChange={e=>set({title:e.target.value})} /></div>
    <div className="grid gap-4 sm:grid-cols-2"><div className="space-y-2"><Label>Tipo</Label><Options label="Tipo da seção" value={value.type} onChange={type=>set({type:type as HomeSection["type"],items:[],mode:type==="manual"?"manual":"automatic"})} options={sectionTypes} /></div>
      {!personal && !hero && <div className="space-y-2"><Label>Modo</Label><Options label="Modo da seção" value={value.mode} onChange={mode=>set({mode:mode as HomeSection["mode"]})} options={{automatic:"Automático",manual:"Manual"}} /></div>}
    </div>
    {!hero && <div className="space-y-2"><Label htmlFor="section-limit">Quantidade de conteúdos</Label><div className="grid grid-cols-[minmax(0,1fr)_100px] gap-2"><Options label="Quantidade predefinida" value={[5,10,15,20].includes(value.limit)?String(value.limit):"custom"} onChange={v=>{if(v!=="custom")set({limit:Number(v)});else set({limit:25});}} options={{"5":"5 conteúdos","10":"10 conteúdos","15":"15 conteúdos","20":"20 conteúdos",custom:"Personalizado"}} /><Input id="section-limit" type="number" min={1} max={100} value={value.limit} onChange={e=>set({limit:Number(e.target.value)})} /></div></div>}
    {!personal && value.mode==="automatic" && <div className="space-y-4 border-t border-border pt-4">
      <div className="space-y-2"><Label>Regra automática{hero && " dos banners"}</Label><Options label="Regra automática" value={value.filters.sort} onChange={sort=>set({filters:{...value.filters,sort:sort as HomeSection["filters"]["sort"]}})} options={sortTypes} /></div>
      {value.type!=="categories" && <><div className="space-y-2"><Label>Categoria</Label><Options label="Filtro de categoria" value={value.filters.category||"all"} onChange={v=>set({filters:{...value.filters,category:v==="all"?undefined:v}})} options={{all:"Todas as categorias",...Object.fromEntries(categories.map(c=>[c.id,c.name]))}} /></div>
      {value.type!=="channels" && <><div className="space-y-2"><Label>Gênero</Label><Options label="Filtro de gênero" value={value.filters.genre||"all"} onChange={v=>set({filters:{...value.filters,genre:v==="all"?undefined:v}})} options={{all:"Todos os gêneros",...Object.fromEntries(genres.map(c=>[c.id,c.name]))}} /></div><div className="space-y-2"><Label htmlFor="filter-year">Ano</Label><Input id="filter-year" placeholder="Todos os anos" type="number" min={1888} max={2200} value={value.filters.year??""} onChange={e=>set({filters:{...value.filters,year:e.target.value?Number(e.target.value):undefined}})} /></div></>}</>}
    </div>}
    {!personal && !hero && value.mode==="manual" && <ContentPicker value={value.items} onChange={items=>set({items})} kind={value.type==="movies"?"movie":value.type==="series"?"series":value.type==="channels"?"channel":value.type==="categories"?"category":"mixed"} />}
    <div className="flex items-center justify-between border-t border-border pt-4"><Label htmlFor="section-active">Seção ativa</Label><Switch id="section-active" checked={value.active} onCheckedChange={active=>set({active})} /></div>
    {!hero && <div className="flex items-center justify-between"><Label htmlFor="section-all">Mostrar “Ver todos”</Label><Switch id="section-all" checked={value.showAll} onCheckedChange={showAll=>set({showAll})} /></div>}
  </div>;
}