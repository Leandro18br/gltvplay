import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Trash2, Plus } from "lucide-react";
import { db } from "@/lib/admin/db";
import { domainSchema } from "@/lib/playback/embed";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { ConfirmDelete } from "./ConfirmDelete";

export function EmbedSettings() {
  const qc=useQueryClient();
  const [hostname,setHostname]=useState("");const [busy,setBusy]=useState(false);const [remove,setRemove]=useState<{id:string;hostname:string}|null>(null);
  const query=useQuery({queryKey:["admin","embed-domains"],queryFn:async()=>{const [d,s]=await Promise.all([db.from("embed_domains").select("id,hostname").order("hostname"),db.from("site_settings").select("embed_allow_iframe").eq("id",1).single()]);if(d.error||s.error)throw new Error("Não foi possível carregar as regras");return {domains:d.data as {id:string;hostname:string}[],allowIframe:!!s.data.embed_allow_iframe};}});
  const refresh=()=>{qc.invalidateQueries({queryKey:["admin","embed-domains"]});qc.invalidateQueries({queryKey:["admin","settings"]});qc.invalidateQueries({queryKey:["player"]});};
  const add=async()=>{setBusy(true);try{const host=domainSchema.parse(hostname);if(host===window.location.hostname)throw new Error("Não incorpore a própria plataforma");const r=await db.from("embed_domains").insert({hostname:host});if(r.error)throw new Error("Não foi possível adicionar: verifique se o domínio já existe");setHostname("");refresh();toast.success("Domínio autorizado");}catch(e){toast.error(e instanceof Error?e.message:"Domínio inválido");}finally{setBusy(false);}};
  const toggle=async(value:boolean)=>{setBusy(true);const r=await db.from("site_settings").update({embed_allow_iframe:value}).eq("id",1);setBusy(false);if(r.error)toast.error("Não foi possível salvar a regra");else{refresh();toast.success("Regra atualizada");}};
  return <section className="space-y-4 border-t border-border pt-6"><h2 className="font-semibold">Domínios autorizados para Embed</h2>
    {query.isPending?<p className="text-muted-foreground">Carregando…</p>:query.isError?<Button variant="outline" onClick={()=>query.refetch()}>Tentar novamente</Button>:<>
      <div className="flex gap-2"><Input aria-label="Domínio autorizado para Embed" placeholder="player.provedor.com" maxLength={253} value={hostname} onChange={e=>setHostname(e.target.value)} /><Button disabled={busy||!hostname.trim()} onClick={add}><Plus /> Adicionar</Button></div>
      <p className="text-xs text-muted-foreground">Informe o domínio exato usado pelo player, incluindo subdomínio. Apenas fontes HTTPS autorizadas.</p>
      <ul className="space-y-2">{query.data.domains.map(d=><li key={d.id} className="flex items-center justify-between gap-3 border-b border-border py-2"><span className="min-w-0 break-all text-sm">{d.hostname}</span><Button variant="ghost" size="icon" aria-label={`Remover domínio ${d.hostname}`} onClick={()=>setRemove(d)}><Trash2 /></Button></li>)}</ul>
      <label className="flex items-center gap-3 text-sm"><Switch checked={query.data.allowIframe} disabled={busy} onCheckedChange={toggle} /> Permitir entrada de código iframe autorizado</label>
    </>}
    <ConfirmDelete open={!!remove} onOpenChange={o=>{if(!o)setRemove(null);}} title={`Remover autorização de ${remove?.hostname}?`} description="Embeds desse domínio deixarão de ser autorizados. Os conteúdos serão preservados." onConfirm={async()=>{if(!remove)return;const r=await db.from("embed_domains").delete().eq("id",remove.id);if(r.error){toast.error("Não foi possível remover");return;}setRemove(null);refresh();toast.success("Autorização removida");}} />
  </section>;
}