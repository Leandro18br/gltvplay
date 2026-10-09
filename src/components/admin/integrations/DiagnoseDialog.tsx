import { useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { Loader2, Sparkles } from "lucide-react";
import { diagnoseSyncFailures } from "@/lib/integrations/diagnose.functions";
import { errMsg } from "@/lib/admin/db";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";

export function DiagnoseDialog({ listId, name, onClose }: { listId: string; name: string; onClose: () => void }) {
  const run = useServerFn(diagnoseSyncFailures);
  const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState(false);
  const [out, setOut] = useState<{ text: string; error?: boolean } | null>(null);
  async function go() {
    setBusy(true); setOut(null);
    try { const r = await run({ data: { listId, notes } }); setOut({ text: r.count ? `${r.count} registro(s) de falha analisado(s).\n\n${r.text}` : r.text }); }
    catch (e) { setOut({ text: errMsg(e), error: true }); }
    finally { setBusy(false); }
  }
  return (
    <Dialog open onOpenChange={(o) => !o && !busy && onClose()}>
      <DialogContent className="max-h-[90dvh] max-w-2xl overflow-y-auto">
        <DialogHeader><DialogTitle>Diagnóstico de falhas com IA · {name}</DialogTitle>
          <DialogDescription>A IA analisa as falhas registradas desta lista e sugere causas e correções. Links e credenciais são ocultados antes do envio. Nada é alterado automaticamente.</DialogDescription></DialogHeader>
        <Textarea rows={5} placeholder="Opcional: cole aqui registros ou itens com falha adicionais" value={notes} onChange={(e) => setNotes(e.target.value)} />
        <div className="flex justify-end"><Button type="button" disabled={busy} onClick={go}>{busy ? <Loader2 className="animate-spin" /> : <Sparkles />}{busy ? "Analisando…" : "Analisar falhas"}</Button></div>
        {out && <div role={out.error ? "alert" : "status"} className={`whitespace-pre-wrap break-words rounded-lg border border-border p-3 text-sm ${out.error ? "text-destructive" : ""}`}>{out.text}</div>}
      </DialogContent>
    </Dialog>
  );
}
