import { useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Loader2, Pause, RefreshCw } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { errMsg } from "@/lib/admin/db";
import { tmdbRepairMoviesBatch } from "@/lib/tmdb/tmdb.functions";

type Totals = { scanned: number; corrected: number; alreadyComplete: number; unavailable: number; failed: number };
const empty: Totals = { scanned: 0, corrected: 0, alreadyComplete: 0, unavailable: 0, failed: 0 };

export function TmdbMovieRepairBatch() {
  const repair = useServerFn(tmdbRepairMoviesBatch);
  const qc = useQueryClient();
  const stop = useRef(false);
  const [running, setRunning] = useState(false);
  const [offset, setOffset] = useState(0);
  const [totals, setTotals] = useState<Totals>(empty);
  const [message, setMessage] = useState("");
  const [finished, setFinished] = useState(false);

  async function run() {
    stop.current = false;
    setRunning(true);
    setMessage("");
    if (finished) { setOffset(0); setTotals(empty); setFinished(false); }
    let cursor = finished ? 0 : offset;
    let done = false;
    try {
      while (!done && !stop.current) {
        const r = await repair({ data: { offset: cursor, limit: 5 } });
        cursor = r.nextOffset;
        done = r.done;
        setOffset(cursor);
        setTotals((old) => ({
          scanned: old.scanned + r.scanned,
          corrected: old.corrected + r.corrected,
          alreadyComplete: old.alreadyComplete + r.alreadyComplete,
          unavailable: old.unavailable + r.unavailable,
          failed: old.failed + r.failed,
        }));
        setMessage(`Verificados nesta etapa: ${r.scanned}. Total analisado nesta execução: ${cursor} de ${r.total}.`);
        await qc.invalidateQueries({ queryKey: ["admin", "movies"] });
        await qc.invalidateQueries({ queryKey: ["catalog"] });
        if (!r.scanned) done = true;
      }
      if (done) {
        setFinished(true);
        setMessage("Correção concluída. Os filmes sem correspondência confiável foram preservados sem metadados inventados.");
        toast.success("Verificação de metadados dos filmes concluída.");
      } else if (stop.current) {
        setMessage("Processamento pausado. Clique em continuar para retomar do próximo lote.");
        toast.message("Correção pausada; o progresso desta sessão foi mantido.");
      }
    } catch (e) {
      setMessage(`Falha no lote. ${errMsg(e)} Você pode continuar para tentar novamente a partir do último lote concluído.`);
      toast.error(errMsg(e));
    } finally {
      setRunning(false);
    }
  }

  return <section className="mb-4 space-y-3 rounded-2xl border border-primary/30 bg-card p-4">
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div className="min-w-0 flex-1">
        <h2 className="font-semibold">Corrigir descrições e gêneros via TMDB</h2>
        <p className="mt-1 text-sm text-muted-foreground">Verifica filmes em lotes de 10. Só preenche metadados ausentes, preserva sinopses válidas, categorias e fontes de reprodução. Correspondências automáticas exigem identificação confiável.</p>
      </div>
      {running
        ? <Button size="sm" variant="outline" onClick={() => { stop.current = true; }}><Pause /> Pausar após o lote</Button>
        : <Button size="sm" onClick={run}><RefreshCw /> {finished ? "Executar nova verificação" : offset ? "Continuar correção" : "Iniciar correção em lote"}</Button>}
    </div>
    {(running || offset > 0 || message) && <div className="space-y-1 text-sm">
      <p role="status" className="text-muted-foreground">{running && <Loader2 className="mr-1 inline size-4 animate-spin" />}{message}</p>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
        {([["Verificados", totals.scanned], ["Corrigidos", totals.corrected], ["Já completos", totals.alreadyComplete], ["Sem correspondência/dados", totals.unavailable], ["Falhas", totals.failed]] as const).map(([label, value]) =>
          <div key={label} className="rounded-lg bg-muted/40 p-2"><p className="text-xs text-muted-foreground">{label}</p><p className="font-semibold tabular-nums">{value.toLocaleString("pt-BR")}</p></div>)}
      </div>
    </div>}
  </section>;
}
