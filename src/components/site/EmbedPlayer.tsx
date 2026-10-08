import { useEffect, useState, useRef } from "react";
import { Loader2, RotateCcw, Maximize, AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";

export function EmbedPlayer({url,title,onFailure,onLoaded,preview=false}:{url:string;title:string;onFailure?:(event:"timeout"|"frame_error"|"user_report")=>void;onLoaded?:()=>void;preview?:boolean}) {
  const [attempt,setAttempt]=useState(0);
  const [state,setState]=useState<"loading"|"loaded"|"failed">("loading");
  const [safe,setSafe]=useState(false);
  const wrap=useRef<HTMLDivElement>(null);
  const callbacks=useRef({onFailure,onLoaded}); callbacks.current={onFailure,onLoaded};
  useEffect(()=>{
    try { const candidate=new URL(url); const allowed=candidate.protocol==="https:" && candidate.origin!==window.location.origin && !candidate.username && !candidate.password;setSafe(allowed);if(!allowed){setState("failed");return;} } catch {setSafe(false);setState("failed");return;}
    setState("loading");
    const timer=setTimeout(()=>{setState(s=>{if(s==="loading"){callbacks.current.onFailure?.("timeout");return "failed";}return s;});},20000);
    return ()=>clearTimeout(timer);
  },[url,attempt]);
  const fail=(event:"frame_error"|"user_report")=>{setState("failed");callbacks.current.onFailure?.(event);};
  return <div className="w-full space-y-3">
    <div ref={wrap} className="relative aspect-video w-full overflow-hidden rounded-xl bg-background ring-1 ring-border">
      {safe && state!=="failed" && <iframe key={`${url}:${attempt}`} src={url} title={title} sandbox="allow-scripts allow-same-origin allow-presentation" allow="autoplay; fullscreen; encrypted-media; picture-in-picture" allowFullScreen referrerPolicy="strict-origin-when-cross-origin" className="h-full w-full border-0" onLoad={()=>{setState("loaded");callbacks.current.onLoaded?.();}} onError={()=>fail("frame_error")} />}
      {state==="loading" && <div className="pointer-events-none absolute inset-0 flex items-center justify-center bg-background"><Loader2 className="size-10 animate-spin text-primary" /></div>}
      {state==="failed" && <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 px-4 text-center"><AlertTriangle className="size-7 text-muted-foreground" /><p className="text-sm md:text-base">Não foi possível carregar este conteúdo no momento.</p><Button size="sm" variant="secondary" onClick={()=>{setState("loading");setAttempt(v=>v+1);}}><RotateCcw /> Tentar novamente</Button></div>}
    </div>
    <div className="flex flex-wrap items-center justify-end gap-2">
      {preview && <p role="status" className="mr-auto text-xs text-muted-foreground">{state==="loaded"?"Iframe carregado — confirme a reprodução na prévia.":state==="failed"?"Não foi possível carregar o Embed. Você ainda pode salvar uma fonte autorizada.":"Carregando Embed…"}</p>}
      {state==="loaded" && <Button variant="ghost" size="sm" onClick={()=>fail("user_report")}>O player não abriu?</Button>}
      <Button size="sm" variant="outline" onClick={()=>wrap.current?.requestFullscreen?.().catch(()=>{})}><Maximize /> Tela cheia</Button>
    </div>
  </div>;
}