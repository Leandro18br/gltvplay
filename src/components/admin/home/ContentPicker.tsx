import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Plus, X, Search } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { searchHomeContent, getHomeReferences } from "@/lib/home/home.functions";
import type { ContentRef } from "@/lib/home/model";
import { SortableList } from "./SortableList";

export function ContentPicker({value,onChange,kind="mixed",single=false}:{value:ContentRef[];onChange:(refs:ContentRef[])=>void;kind?:"mixed"|"movie"|"series"|"channel"|"category";single?:boolean}) {
  const [term,setTerm] = useState(""); const [debounced,setDebounced] = useState("");
  useEffect(()=>{const t=setTimeout(()=>setDebounced(term),250);return ()=>clearTimeout(t);},[term]);
  const results = useQuery({queryKey:["admin","home-search",kind,debounced],queryFn:()=>searchHomeContent({data:{kind,term:debounced}})});
  const selected = useQuery({queryKey:["admin","home-refs",value],queryFn:()=>getHomeReferences({data:value}),enabled:value.length>0});
  return <div className="space-y-3">
    {value.length>0 && <SortableList items={value} getId={r=>`${r.kind}:${r.id}`} onChange={onChange} render={ref=>{const row=selected.data?.find(r=>r.id===ref.id&&r.kind===ref.kind);return <div className="flex min-w-0 items-center justify-between gap-2"><div className="min-w-0"><p className="truncate text-sm">{row?.title ?? (selected.isPending ? "Carregando…" : "Conteúdo excluído")}</p><span className="text-xs text-muted-foreground">{ref.kind === "movie" ? "Filme" : ref.kind === "series" ? "Série" : ref.kind === "channel" ? "Canal" : "Categoria"}{row?.status !== "published" && " · Indisponível no site"}</span></div><Button variant="ghost" size="icon" aria-label="Remover conteúdo" onClick={()=>onChange(value.filter(r=>r.id!==ref.id||r.kind!==ref.kind))}><X className="size-4" /></Button></div>;}} />}
    <div className="relative"><Search className="absolute left-3 top-3 size-4 text-muted-foreground" /><Input aria-label="Buscar conteúdo" placeholder="Buscar conteúdo…" value={term} onChange={e=>setTerm(e.target.value)} className="pl-9" /></div>
    <div className="max-h-60 overflow-y-auto divide-y divide-border rounded-lg border border-border">
      {results.isPending && <p className="p-3 text-sm text-muted-foreground">Carregando…</p>}
      {results.isError && <p className="p-3 text-sm text-destructive">Não foi possível buscar conteúdo.</p>}
      {results.data?.filter(r=>!value.some(v=>v.kind===r.kind&&v.id===r.id)).map(r=><div key={`${r.kind}:${r.id}`} className="flex min-w-0 items-center gap-2 p-2"><div className="min-w-0 flex-1"><p className="truncate text-sm">{r.title}</p><span className="text-xs text-muted-foreground">{r.kind === "movie" ? "Filme" : r.kind === "series" ? "Série" : r.kind === "channel" ? "Canal" : "Categoria"} · {r.status === "published" ? "Publicado" : "Não publicado"}</span></div><Button variant="ghost" size="icon" aria-label={`Adicionar ${r.title}`} disabled={!single && value.length>=100} onClick={()=>onChange(single ? [{id:r.id,kind:r.kind}] : [...value,{id:r.id,kind:r.kind}])}><Plus className="size-4" /></Button></div>)}
      {results.data?.length===0 && <p className="p-3 text-sm text-muted-foreground">Nenhum conteúdo encontrado.</p>}
    </div>
  </div>;
}