import { useEffect, useState, useRef } from "react";
import { Loader2, AlertTriangle } from "lucide-react";

/**
 * Renders an authorized embed directly in a cross-origin iframe (no sandbox: providers
 * may need features it blocks; isolation comes from the browser same-origin policy).
 * Cross-origin iframes expose no reliable status, so the player never declares
 * the content unavailable on its own: no fetch/HEAD checks, no onError or timeout
 * verdicts. Only a URL that is structurally unsafe is refused before rendering.
 */
export function EmbedPlayer({url,title,onLoaded}:{url:string;title:string;onFailure?:(event:"timeout"|"frame_error"|"user_report")=>void;onLoaded?:()=>void;preview?:boolean}) {
  const [loading,setLoading]=useState(true);
  const [safe,setSafe]=useState<boolean|null>(null);
  const callbacks=useRef({onLoaded}); callbacks.current={onLoaded};
  useEffect(()=>{
    try { const c=new URL(url); setSafe(c.protocol==="https:" && c.origin!==window.location.origin && !c.username && !c.password); } catch { setSafe(false); }
  },[url]);
  useEffect(()=>{
    setLoading(true);
    // Hide the spinner after a while even if the provider never fires onLoad; the iframe stays visible.
    const t=setTimeout(()=>setLoading(false),8000);
    return ()=>clearTimeout(t);
  },[url]);
  return <div className="relative aspect-video w-full overflow-hidden rounded-xl bg-background ring-1 ring-border">
      {safe && <iframe key={url} src={url} title={title} width="100%" height="100%" frameBorder="0" allow="autoplay; encrypted-media; picture-in-picture; fullscreen" allowFullScreen referrerPolicy="strict-origin-when-cross-origin" className="absolute inset-0 h-full w-full border-0" onLoad={()=>{setLoading(false);callbacks.current.onLoaded?.();}} />}
      {safe && loading && <div className="pointer-events-none absolute inset-0 flex items-center justify-center"><Loader2 className="size-10 animate-spin text-primary" /></div>}
      {safe===false && <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 px-4 text-center"><AlertTriangle className="size-7 text-muted-foreground" /><p className="text-sm md:text-base">Não foi possível carregar o player. Tente novamente.</p></div>}
  </div>;
}
