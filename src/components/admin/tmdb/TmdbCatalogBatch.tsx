import { useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { DownloadCloud, Loader2, Pause, Play, RefreshCw } from "lucide-react";
import { tmdbCatalogStart, tmdbCatalogStatus, tmdbCatalogStep, tmdbCatalogRetry } from "@/lib/tmdb/catalog.functions";
import { Button } from "@/components/ui/button";
import { errMsg } from "@/lib/admin/db";

export function TmdbCatalogBatch() {
  const status = useServerFn(tmdbCatalogStatus), start = useServerFn(tmdbCatalogStart), step = useServerFn(tmdbCatalogStep), retry = useServerFn(tmdbCatalogRetry);
  const qc = useQueryClient();
  const query = useQuery({queryKey:["admin","tmdb-catalog-2026"],queryFn:()=>status(),refetchInterval:5000});
  const [running,setRunning]=useState(false),[error,setError]=useState<string|null>(null);
  const stop=useRef(false);
  async function run(retryErrors=false) {
    stop.current=false;setRunning(true);setError(null);
    try {
      let job=query.data;
      if(retryErrors&&job) {await retry({data:{id:job.id}});job=await status();}
      if(!job||job.phase==="done") job=await start();
      while(job&&job.phase!=="done"&&!stop.current) {
        job=await step({data:{id:job.id}});
        qc.setQueryData(["admin","tmdb-catalog-2026"],job);
         if(job.phase==="discover"&&!stop.current) {
           job=await step({data:{id:job.id,work:"import"}});
           qc.setQueryData(["admin","tmdb-catalog-2026"],job);
         }
        await new Promise(resolve=>setTimeout(resolve,150));
      }
      await qc.invalidateQueries({queryKey:["admin"]});await qc.invalidateQueries({queryKey:["catalog"]});
    } catch(e) {setError(errMsg(e));} finally {setRunning(false);}
  }
  const job=query.data,t=job?.totals;
  return <div className="mt-4 space-y-3 border-t border-border pt-4">
    <div className="flex flex-wrap items-center justify-between gap-3">
      <h3 className="text-sm font-semibold">Atualização do catálogo · Filmes de 2026</h3>
      <div className="flex flex-wrap gap-2">
        {running?<Button size="sm" variant="outline" onClick={()=>{stop.current=true;}}><Pause/> Pausar após o lote</Button>:<Button size="sm" onClick={()=>run()} disabled={query.isPending}><DownloadCloud/>{job&&job.phase!=="done"?"Continuar atualização":"Atualizar catálogo 2026"}</Button>}
        {!running&&!!t?.errors&&<Button size="sm" variant="outline" onClick={()=>run(true)}><RefreshCw/> Tentar erros novamente</Button>}
      </div>
    </div>
    {job&&<div role="status" className="space-y-1 text-xs text-muted-foreground">
      <p className="flex items-center gap-2">{running?<Loader2 className="h-4 w-4 animate-spin"/>:<Play className="h-3 w-3"/>}{job.phase==="discover"?"Buscando filmes no TMDB...":job.phase==="import"?"Atualização em lotes — andamento salvo":"Processamento encerrado"}</p>
      <p>Encontrados: {job.discovered} · Novos: {t?.created??0} · Completados: {t?.completed??0} · Já existentes: {t?.exists??0}</p>
      <p>Pendentes: {t?.pending??0} · Revisão de correspondência: {t?.ambiguous??0} · Erros: {t?.errors??0}</p>
      {(job.errors??[]).length>0&&<details><summary className="cursor-pointer">Ver ocorrências</summary><ul className="mt-2 space-y-1 break-words">{job.errors.map(e=><li key={e.item_key}>{e.item_key}: {e.error}</li>)}</ul></details>}
    </div>}
    {(error||job?.lastError||query.error)&&<p role="alert" className="break-words text-sm text-destructive">{error??job?.lastError??errMsg(query.error)}</p>}
  </div>;
}