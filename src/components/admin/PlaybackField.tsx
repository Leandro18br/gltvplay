import { useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { Play } from "lucide-react";
import { validatePlayback } from "@/lib/playback/playback.functions";
import { emptyPlayback, type PlaybackValue } from "@/lib/playback/embed";
import { EmbedPlayer } from "@/components/site/EmbedPlayer";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

export function PlaybackField({value,onChange}:{value:PlaybackValue|undefined;onChange:(v:PlaybackValue)=>void}) {
  const v=value ?? emptyPlayback;
  const validate=useServerFn(validatePlayback);
  const [testing,setTesting]=useState(false);
  const [preview,setPreview]=useState<string|null>(null);
  const patch=(p:Partial<PlaybackValue>)=>{setPreview(null);onChange({...v,...p});};
  const test=async()=>{setTesting(true);try{const r=await validate({data:v});if(!r.url)return;if(new URL(r.url).origin===window.location.origin)throw new Error("Não incorpore a própria plataforma");setPreview(r.url);}catch(e){toast.error(e instanceof Error?e.message:"Fonte inválida");}finally{setTesting(false);}};
  return <div className="space-y-4">
    <div className="space-y-2"><Label htmlFor="playback-type">Tipo de reprodução</Label><Select value={v.type} onValueChange={type=>patch({type:type as PlaybackValue["type"]})}><SelectTrigger id="playback-type"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="url">Vídeo/URL</SelectItem><SelectItem value="embed">Embed</SelectItem><SelectItem value="hls">HLS/M3U8</SelectItem><SelectItem value="none">Sem reprodução</SelectItem></SelectContent></Select></div>
    {v.type!=="none" && <>
      <div className="space-y-2"><Label htmlFor="playback-input">{v.type==="embed"?"Código ou URL do Embed":"URL de reprodução autorizada"}</Label><Textarea id="playback-input" rows={3} maxLength={8192} value={v.input} onChange={e=>patch({input:e.target.value})} placeholder="https://…" required /></div>
      <div className="flex flex-wrap gap-5"><label className="flex items-center gap-2 text-sm"><Switch checked={v.active} onCheckedChange={active=>patch({active})} /> Fonte ativa</label><label className="flex items-center gap-2 text-sm"><Switch checked={v.primary} onCheckedChange={primary=>patch({primary})} /> Fonte principal</label></div>
      {v.type==="embed" && <Button type="button" variant="outline" disabled={testing||!v.input.trim()} onClick={test}><Play />{testing?"Validando…":"Testar Embed"}</Button>}
      {preview && <EmbedPlayer key={preview} url={preview} title="Teste do Embed" preview />}
    </>}
  </div>;
}