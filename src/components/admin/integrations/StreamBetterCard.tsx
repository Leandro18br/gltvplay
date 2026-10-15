import { useEffect, useRef, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { CheckCircle2, CircleAlert, Clapperboard, Loader2, Pause, Play, RefreshCw } from "lucide-react";
import { streamBetterImportStep, streamBetterTest } from "@/lib/integrations/streambetter.functions";
import { errMsg } from "@/lib/admin/db";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Badge } from "@/components/ui/badge";

type TestResult = Awaited<ReturnType<typeof streamBetterTest>>;
type StepResult = Awaited<ReturnType<typeof streamBetterImportStep>>;
type Job = { kind: "movie" | "series"; mode: "sync" | "new_only"; page: number; totalPages: number | null; processed: number; imported: number; updated: number; skipped: number; errors: number; totalItems: number | null };

const initial = (kind: "movie" | "series", mode: "sync" | "new_only" = "sync"): Job => ({ kind, mode, page: 1, totalPages: null, processed: 0, imported: 0, updated: 0, skipped: 0, errors: 0, totalItems: null });
const wait = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

export function StreamBetterCard() {
  const testFn = useServerFn(streamBetterTest);
  const stepFn = useServerFn(streamBetterImportStep);
  const [testing, setTesting] = useState(false);
  const [test, setTest] = useState<TestResult | null>(null);
  const [job, setJob] = useState<Job | null>(null);
  const [running, setRunning] = useState(false);
  const stop = useRef(false);
  const key = "streambetter-import-progress-v1";

  useEffect(() => {
    try {
      const saved = localStorage.getItem(key);
      if (saved) setJob(JSON.parse(saved) as Job);
    } catch { /* Ignore malformed local progress and let the user start a new run. */ }
  }, []);

  function saveJob(next: Job | null) {
    setJob(next);
    try { if (next) localStorage.setItem(key, JSON.stringify(next)); else localStorage.removeItem(key); } catch { /* Storage may be disabled. */ }
  }

  async function run(kind: "movie" | "series", resume: boolean, mode: "sync" | "new_only" = "sync") {
    stop.current = false;
    setRunning(true);
    let current = resume && job?.kind === kind ? job : initial(kind, mode);
    saveJob(current);
    try {
      for (;;) {
        if (stop.current) break;
        const r = await stepFn({ data: { kind, page: current.page, limit: 10, mode: current.mode } }) as StepResult;
        if (r.retry) {
          toast.message("StreamBetter limitou as requisições. A importação aguardará o tempo indicado e tentará novamente.");
          await wait(r.retryMs);
          continue;
        }
        current = {
          ...current,
          page: r.done ? r.page : r.nextPage,
          totalPages: r.totalPages,
          processed: current.processed + r.processed,
          imported: current.imported + r.imported,
          updated: current.updated + r.updated,
          skipped: current.skipped + r.skipped,
          errors: current.errors + r.errors,
          totalItems: r.totalItems,
        };
        saveJob(current);
        if (stop.current) break;
        if (r.done) {
          toast.success(`StreamBetter: ${current.imported} novos, ${current.updated} atualizados, ${current.skipped} ignorados e ${current.errors} erros.`);
          saveJob(null);
          break;
        }
        // Keep request rate comfortably below the documented 120 requests/minute public limit.
        await wait(1100);
      }
    } catch (e) {
      toast.error(`${errMsg(e)}. O progresso foi salvo; use Retomar para continuar.`);
    } finally {
      setRunning(false);
    }
  }

  async function testConnection() {
    setTesting(true);
    try {
      const result = await testFn({ data: {} });
      setTest(result);
      if (result.ok) toast.success("StreamBetter respondeu corretamente.");
      else toast.warning(result.message);
    } catch (e) { toast.error(errMsg(e)); }
    finally { setTesting(false); }
  }

  const pct = job?.totalPages ? Math.min(100, ((job.page - 1) / job.totalPages) * 100) : 0;
  return (
    <section className="space-y-4 rounded-2xl border border-primary/30 bg-card p-4">
      <div className="flex flex-wrap items-center gap-2">
        <Clapperboard className="size-5 text-primary" />
        <h2 className="font-semibold">StreamBetter</h2>
        <Badge variant={test?.ok ? "default" : "secondary"}>{test?.ok ? "Conectado" : "Catálogo público"}</Badge>
      </div>
      <p className="text-sm text-muted-foreground">Importa filmes e séries do catálogo público em lotes de 10. O player de filmes usa o iframe oficial do StreamBetter e não substitui as fontes já cadastradas.</p>
      <div className="flex flex-wrap gap-2">
        <Button type="button" variant="outline" disabled={testing || running} onClick={testConnection}>{testing ? <Loader2 className="animate-spin" /> : <RefreshCw />} Testar conexão</Button>
        <Button type="button" disabled={running} onClick={() => run("movie", false, "sync")}><RefreshCw /> Sincronizar filmes</Button>
        <Button type="button" disabled={running} onClick={() => run("series", false, "sync")}><RefreshCw /> Sincronizar séries</Button>
        <Button type="button" variant="outline" disabled={running} onClick={() => run("movie", false, "new_only")}><Play /> Apenas novos filmes</Button>
        <Button type="button" variant="outline" disabled={running} onClick={() => run("series", false, "new_only")}><Play /> Apenas novas séries</Button>
        {job && !running && <Button type="button" variant="outline" onClick={() => run(job.kind, true, job.mode)}><RefreshCw /> Retomar importação</Button>}
        {running && <Button type="button" variant="outline" onClick={() => { stop.current = true; }}><Pause /> Pausar</Button>}
        {job && !running && <Button type="button" variant="ghost" onClick={() => { if (confirm("Apagar somente o marcador local de progresso? Os títulos já importados serão mantidos.")) saveJob(null); }}>Limpar progresso</Button>}
      </div>
      {test?.ok && <div className="grid gap-2 text-sm sm:grid-cols-2">
        <div className="rounded-lg bg-muted/40 p-3"><p className="text-muted-foreground">Filmes no provedor</p><p className="text-lg font-semibold">{test.movieCount.toLocaleString("pt-BR")}</p><p className="text-xs text-muted-foreground">{test.moviePages} páginas{test.sampleMovie ? ` · Ex.: ${test.sampleMovie}` : ""}</p></div>
        <div className="rounded-lg bg-muted/40 p-3"><p className="text-muted-foreground">Séries no provedor</p><p className="text-lg font-semibold">{test.seriesCount.toLocaleString("pt-BR")}</p><p className="text-xs text-muted-foreground">{test.seriesPages} páginas{test.sampleSeries ? ` · Ex.: ${test.sampleSeries}` : ""}</p></div>
      </div>}
      {job && <div className="space-y-2 rounded-xl border border-border p-3">
        <div className="flex items-center justify-between gap-2 text-sm"><span>{job.kind === "movie" ? "Importação de filmes" : "Importação de séries"}{job.mode === "new_only" ? " · somente novos" : " · sincronização"}</span><span>{job.totalPages ? `Página ${Math.min(job.page, job.totalPages)} de ${job.totalPages}` : `Página ${job.page}`}</span></div>
        <Progress value={pct} />
        <div className="grid grid-cols-2 gap-2 text-xs sm:grid-cols-5">
          <div>Processados: <b>{job.processed}</b></div><div>Novos: <b>{job.imported}</b></div><div>Atualizados: <b>{job.updated}</b></div><div>Ignorados: <b>{job.skipped}</b></div><div>Erros: <b>{job.errors}</b></div>
        </div>
      </div>}
      <div className="rounded-lg bg-muted/30 p-3 text-xs text-muted-foreground">
        <p className="flex items-start gap-2"><CheckCircle2 className="mt-0.5 size-4 shrink-0" /> A importação é manual, idempotente e retomável no mesmo navegador. Não apaga conteúdos antigos nem sobrescreve descrições/capas já preenchidas.</p>
        <p className="mt-2 flex items-start gap-2"><CircleAlert className="mt-0.5 size-4 shrink-0" /> A documentação pública não oferece uma listagem completa de temporadas e episódios. Esta versão importa os títulos de séries, mas não inventa episódios; o player de episódios precisa dessa fonte documentada.</p>
      </div>
    </section>
  );
}
