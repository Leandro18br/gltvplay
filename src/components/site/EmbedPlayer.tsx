import { useEffect, useState, useRef } from "react";
import { Loader2, RotateCcw, Maximize, AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";

/**
 * Renders an authorized embed directly in an isolated iframe.
 * Cross-origin iframes expose no reliable status, so the player never declares
 * the content unavailable on its own: no fetch/HEAD checks, no onError or timeout
 * verdicts. Only a URL that is structurally unsafe is refused before rendering.
 */
export function EmbedPlayer({url,title,onFailure,onLoaded,preview=false}:{url:string;title:string;onFailure?:(event:"timeout"|"frame_error"|"user_report")=>void;onLoaded?:()=>void;preview?:boolean}) {
  const [attempt,setAttempt]=useState(0);
  const [loading,setLoading]=useState(true);
  const [safe,setSafe]=useState<boolean|null>(null);
  const [reported,setReported]=useState(false);
  const wrap=useRef<HTMLDivElement>(null);
  const callbacks=useRef({onFailure,onLoaded}); callbacks.current={onFailure,onLoaded};
  useEffect(()=>{
    try { const c=new URL(url); setSafe(c.protocol==="https:" && c.origin!==window.location.origin && !c.username && !c.password); } catch { setSafe(false); }
  },[url]);
  useEffect(()=>{
    setLoading(true);
    // Hide the spinner after a while even if the provider never fires onLoad; the iframe stays visible.
    const t=setTimeout(()=>setLoading(false),8000);
    return ()=>clearTimeout(t);
  },[url,attempt]);
  const retry=()=>{setReported(false);setAttempt(v=>v+1);};
  return <div className="w-full space-y-3">
    <div ref={wrap} className="relative aspect-video w-full overflow-hidden rounded-xl bg-background ring-1 ring-border">
      {safe && <iframe key={`${url}:${attempt}`} src={url} title={title} sandbox="allow-scripts allow-same-origin allow-presentation allow-forms allow-popups allow-orientation-lock" allow="autoplay; fullscreen; encrypted-media; picture-in-picture" allowFullScreen referrerPolicy="strict-origin-when-cross-origin" className="absolute inset-0 h-full w-full border-0" onLoad={()=>{setLoading(false);callbacks.current.onLoaded?.();}} />}
      {safe && loading && <div className="pointer-events-none absolute inset-0 flex items-center justify-center"><Loader2 className="size-10 animate-spin text-primary" /></div>}
      {safe===false && <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 px-4 text-center"><AlertTriangle className="size-7 text-muted-foreground" /><p className="text-sm md:text-base">Não foi possível carregar este conteúdo no momento.</p></div>}
    </div>
    <div className="flex flex-wrap items-center justify-end gap-2">
      <p role="status" className="mr-auto text-xs text-muted-foreground">{preview?"Pré-visualização carregada. A disponibilidade do conteúdo depende do servidor de origem.":"Se o conteúdo não carregar, tente novamente."}</p>
      <Button size="sm" variant="secondary" onClick={retry}><RotateCcw /> Tentar novamente</Button>
      {!preview && safe && <Button variant="ghost" size="sm" disabled={reported} onClick={()=>{setReported(true);callbacks.current.onFailure?.("user_report");}}>{reported?"Problema informado":"O player não abriu?"}</Button>}
      <Button size="sm" variant="outline" onClick={()=>wrap.current?.requestFullscreen?.().catch(()=>{})}><Maximize /> Tela cheia</Button>
    </div>
  </div>;
}
