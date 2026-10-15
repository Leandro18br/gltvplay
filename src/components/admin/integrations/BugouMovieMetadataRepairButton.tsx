import { useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { CheckCircle2, Loader2, RefreshCw, Wrench } from "lucide-react";
import { toast } from "sonner";
import { errMsg } from "@/lib/admin/db";
import { bugouRepairMovieMetadataBatch } from "@/lib/integrations/bugoumods.functions";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";

type Totals = { scanned: number; corrected: number; descriptionsAdded: number; genresAdded: number; unavailable: number; failed: number };
const zero: Totals = { scanned: 0, corrected: 0, descriptionsAdded: 0, genresAdded: 0, unavailable: 0, failed: 0 };

export function BugouMovieMetadataRepairButton() {
  const repair = useServerFn(bugouRepairMovieMetadataBatch);
  const [open, setOpen] = useState(false);
  const [running, setRunning] = useState(false);
  const [cursor, setCursor] = useState<string | null>(null);
  const [totals, setTotals] = useState<Totals>(zero);
  const [done, setDone] = useState(false);
  const [message, setMessage] = useState("");

  async function runBatch(reset = false) {
    setRunning(true);
    setMessage("");
    try {
      const r = await repair({ data: { after: reset ? null : cursor, limit: 5 } });
      setCursor(r.nextCursor);
      setDone(r.done);
      setTotals((prev) => ({
        scanned: (reset ? 0 : prev.scanned) + r.scanned,
        corrected: (reset ? 0 : prev.corrected) + r.corrected,
        descriptionsAdded: (reset ? 0 : prev.descriptionsAdded) + r.descriptionsAdded,
        genresAdded: (reset ? 0 : prev.genresAdded) + r.genresAdded,
        unavailable: (reset ? 0 : prev.unavailable) + r.unavailable,
        failed: (reset ? 0 : prev.failed) + r.failed,
      }));
      setMessage(r.done ? "Verificação concluída para os filmes incompletos encontrados nesta execução." : "Lote concluído. Você pode continuar quando quiser.");
      if (r.done) toast.success("Verificação de metadados BugouMods concluída.");
    } catch (error) {
      setMessage(errMsg(error));
      toast.error(errMsg(error));
    } finally {
      setRunning(false);
    }
  }

  return <>
    <Button type="button" variant="outline" className="rounded-full" onClick={() => setOpen(true)}><Wrench /> Corrigir metadados BugouMods</Button>
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent className="max-h-[90vh] max-w-xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Recuperar sinopses e gêneros — BugouMods VIP</DialogTitle>
          <DialogDescription>Consulta somente a API BugouMods VIP. Processa cinco filmes por lote, preserva sinopses existentes e não remove gêneros nem categorias editoriais. Não usa TMDB nem outra API externa.</DialogDescription>
        </DialogHeader>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          {[
            ["Verificados", totals.scanned],
            ["Filmes corrigidos", totals.corrected],
            ["Sinopses adicionadas", totals.descriptionsAdded],
            ["Gêneros associados", totals.genresAdded],
            ["Sem metadados completos", totals.unavailable],
            ["Falhas", totals.failed],
          ].map(([label, value]) => <div key={String(label)} className="rounded-lg border p-3">
            <p className="text-xs text-muted-foreground">{label}</p><p className="text-xl font-semibold">{value}</p>
          </div>)}
        </div>
        {message && <p role="status" className="rounded-lg bg-muted p-3 text-sm">{message}</p>}
        <div className="flex flex-wrap gap-2">
          <Button disabled={running || done} onClick={() => void runBatch()}>{running ? <Loader2 className="animate-spin" /> : done ? <CheckCircle2 /> : <RefreshCw />} {done ? "Concluído" : cursor ? "Continuar próximo lote" : "Iniciar correção"}</Button>
          <Button disabled={running} variant="outline" onClick={() => { setCursor(null); setTotals(zero); setDone(false); setMessage(""); void runBatch(true); }}>Reiniciar verificação</Button>
        </div>
      </DialogContent>
    </Dialog>
  </>;
}
