import { useEffect, useRef, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { Loader2, Pause, RefreshCw } from "lucide-react";
import { errMsg } from "@/lib/admin/db";
import { catalogSyncStep, type SyncState } from "@/lib/integrations/catalog-sync.functions";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";

type Step = Awaited<ReturnType<typeof catalogSyncStep>>;

/** Reads the provider's full catalog (every page of every category) in short server steps; resumable after reloads. */
export function CatalogSyncBar({ kind, integrationId, onDone, label = "Ler catálogo completo da API" }: { kind: "series" | "live"; integrationId?: string; onDone?: () => void; label?: string }) {
  const step = useServerFn(catalogSyncStep);
  const key = `catalog-sync:${kind}:${integrationId ?? ""}`;
  const [p, setP] = useState<Step | null>(null); const [running, setRunning] = useState(false); const [saved, setSaved] = useState(false);
  const stop = useRef(false);
  useEffect(() => { try { setSaved(!!localStorage.getItem(key)); } catch { /* ignore */ } }, [key]);

  async function run(resume: boolean) {
    stop.current = false; setRunning(true);
    let state: SyncState | null = null;
    if (resume) try { state = JSON.parse(localStorage.getItem(key) ?? "null"); } catch { state = null; }
    try {
      for (;;) {
        const r = await step({ data: { kind, integrationId, state } });
        setP(r);
        if (r.done) { localStorage.removeItem(key); setSaved(false); toast.success(`Leitura concluída: ${r.rows} item(ns) lidos em ${r.catsTotal} categorias${r.distinct != null ? ` (${r.distinct} únicos)` : ""}.`); onDone?.(); break; }
        if (r.state) { state = r.state; localStorage.setItem(key, JSON.stringify(r.state)); setSaved(true); }
        if (stop.current) break;
        if (r.waitMs) await new Promise(res => setTimeout(res, Math.min(r.waitMs, 120_000)));
      }
    } catch (e) { toast.error(`${errMsg(e)} — use "Continuar leitura" para retomar de onde parou.`); }
    finally { setRunning(false); }
  }

  const pct = p && p.catsTotal ? ((p.catIndex + (p.pages ? (p.page - 1) / p.pages : 0)) / p.catsTotal) * 100 : 0;
  return (
    <div className="space-y-2 rounded-xl border border-border p-3 text-sm">
      <div className="flex flex-wrap items-center gap-2">
        {!running && <Button type="button" size="sm" variant="outline" onClick={() => run(false)}><RefreshCw /> {label}</Button>}
        {!running && saved && <Button type="button" size="sm" onClick={() => run(true)}>Continuar leitura</Button>}
        {running && <Button type="button" size="sm" variant="outline" onClick={() => { stop.current = true; }}><Pause /> Pausar leitura</Button>}
        {running && <Loader2 className="size-4 animate-spin text-primary" />}
        <span className="text-xs text-muted-foreground">
          {running && p ? (p.done ? "Leitura concluída." : `Lendo categoria ${Math.min(p.catIndex + 1, p.catsTotal)} de ${p.catsTotal}: ${p.catName}${p.pages ? ` · página ${p.page} de ${p.pages}` : ""} · ${p.rows} item(ns) lidos — ainda carregando outras páginas`)
            : p?.done ? `Leitura concluída: ${p.rows} item(ns) em ${p.catsTotal} categorias. As contagens abaixo já refletem o catálogo completo.`
            : running ? "Buscando a lista de categorias…" : "A lista simples da API só traz 50 itens por categoria; esta leitura percorre todas as páginas."}
        </span>
      </div>
      {running && <Progress value={pct} />}
      {p?.error && <p className="text-xs text-primary">{p.error}</p>}
      {!!p?.skipped.length && <p className="text-xs text-destructive">Categorias não lidas: {p.skipped.slice(0, 5).join(" · ")}</p>}
    </div>
  );
}
