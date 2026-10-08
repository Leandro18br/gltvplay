import { useMemo, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Play, ShieldCheck, AlertTriangle } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { validatePlayback } from "@/lib/playback/playback.functions";
import { emptyPlayback, embedHost, looksLikePlayerPage, type PlaybackValue } from "@/lib/playback/embed";
import { EmbedPlayer } from "@/components/site/EmbedPlayer";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

export function PlaybackField({value,onChange}:{value:PlaybackValue|undefined;onChange:(v:PlaybackValue)=>void}) {
  const v=value ?? emptyPlayback;
  const qc=useQueryClient();
  const validate=useServerFn(validatePlayback);
  const [testing,setTesting]=useState(false);
  const [preview,setPreview]=useState<string|null>(null);
  const domains=useQuery({queryKey:["admin","embed-domains","list"],enabled:v.type==="embed",queryFn:async()=>{const r=await supabase.from("embed_domains").select("hostname");if(r.error)throw r.error;return r.data.map(d=>d.hostname);}});
  const host=useMemo(()=>v.type==="embed"?embedHost(v.input):null,[v.type,v.input]);
  const unauthorized=!!host && !!domains.data && !domains.data.includes(host);
  const patch=(p:Partial<PlaybackValue>)=>{setPreview(null);onChange({...v,...p});};
  const authorize=async()=>{if(!host)return;const r=await supabase.from("embed_domains").insert({hostname:host});if(r.error&&r.error.code!=="23505"){toast.error("Somente administradores podem autorizar domínios");return;}toast.success(`Domínio ${host} autorizado`);qc.invalidateQueries({queryKey:["admin","embed-domains"]});};
  // Only checks the platform's own rules (format + authorized domain); never contacts the external server.
  const test=async()=>{setTesting(true);try{const r=await validate({data:v});if(!r.url)return;setPreview(r.url);}catch(e){toast.error(e instanceof Error?e.message:"Fonte inválida");}finally{setTesting(false);}};
  return <div className="space-y-4">
    <div className="space-y-2"><Label htmlFor="playback-type">Tipo de reprodução</Label><Select value={v.type} onValueChange={type=>patch({type:type as PlaybackValue["type"]})}><SelectTrigger id="playback-type"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="url">Vídeo/URL</SelectItem><SelectItem value="embed">Embed</SelectItem><SelectItem value="hls">HLS/M3U8</SelectItem><SelectItem value="none">Sem reprodução</SelectItem></SelectContent></Select></div>
    {v.type!=="none" && <>
      <div className="space-y-2"><Label htmlFor="playback-input">{v.type==="embed"?"Código ou URL do Embed":"URL de reprodução autorizada"}</Label><Textarea id="playback-input" rows={3} maxLength={8192} value={v.input} onChange={e=>patch({input:e.target.value})} placeholder={v.type==="embed"?"https://dominio-autorizado.com/embed/123 ou <iframe src=…></iframe>":"https://…/video.mp4"} required /></div>
      {v.type==="url" && looksLikePlayerPage(v.input) && <p className="flex items-start gap-2 rounded-md border border-border bg-muted/40 p-3 text-sm"><AlertTriangle className="mt-0.5 size-4 shrink-0 text-primary" />Esta URL parece ser uma página de player, não um arquivo de vídeo. Para páginas de player, selecione o tipo "Embed".</p>}
      {unauthorized && <div className="flex flex-wrap items-center gap-3 rounded-md border border-border bg-muted/40 p-3 text-sm"><span className="flex-1">O domínio <b>{host}</b> ainda não está autorizado para Embed.</span><Button type="button" size="sm" variant="secondary" onClick={authorize}><ShieldCheck /> Autorizar domínio</Button></div>}
      <div className="flex flex-wrap gap-5"><label className="flex items-center gap-2 text-sm"><Switch checked={v.active} onCheckedChange={active=>patch({active})} /> Fonte ativa</label><label className="flex items-center gap-2 text-sm"><Switch checked={v.primary} onCheckedChange={primary=>patch({primary})} /> Fonte principal</label></div>
      {v.type==="embed" && <Button type="button" variant="outline" disabled={testing||!v.input.trim()} onClick={test}><Play />{testing?"Abrindo…":"Testar Embed"}</Button>}
      {preview && <EmbedPlayer key={preview} url={preview} title="Teste do Embed" preview />}
    </>}
  </div>;
}
