import { useEffect, useRef, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { CheckCircle2, CircleAlert, Clapperboard, Loader2, Pause, Play, RefreshCw } from "lucide-react";
import { streamBetterImportStep, streamBetterTest } from "@/lib/integrations/streambetter.functions";
import { errMsg } from "@/lib/admin/db";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { db } from "@/lib/admin/db";

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
  const [publicKey, setPublicKey] = useState("");
  const [savingKey, setSavingKey] = useState(false);
  const [keyLoaded, setKeyLoaded] = useState(false);
  const [job, setJob] = useState<Job | null>(null);
  const [running, setRunning] = useState(false);
  const stop = useRef(false);
  const key = "streambetter-import-progress-v1";

  useEffect(() => {
    void db.from("site_settings").select("streambetter_public_key").eq("id", 1).maybeSingle().then((r: any) => { if (!r.error) setPublicKey(typeof r.data?.streambetter_public_key === "string" ? r.data.streambetter_public_key : ""); setKeyLoaded(true); });
    try {
      const saved = localStorage.getItem(key);
      if (saved) setJob(JSON.parse(saved) as Job);
    } catch { /* Ignore malformed local progress and let the user start a new run. */ }
  }, []);

  function saveJob(next: Job | null) {
    setJob(next);
    try { if (next) localStorage.setItem(key, JSON.stringify(next)); else localStorage.removeItem(key); } catch { /* Storage may be disabled. */ }
  }

  async function run(kind: "movie" | "series", resume: boolean, mode: "sync" | "new_only" = "sync", sampleOnly = false) {
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
        if (sampleOnly) {
          toast.success(`Amostra StreamBetter concluída: ${current.processed} processados, ${current.imported} novos, ${current.updated} atualizados e ${current.errors} erros. O restante do catálogo não foi iniciado.`);
          break;
        }
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

  async function savePublicKey() {
    const cleaned = publicKey.trim();
    if (cleaned && !/^sb_pk_[A-Za-z0-9_-]{8,200}$/.test(cleaned)) { toast.error("A chave pública deve começar com sb_pk_."); return; }
    setSavingKey(true);
    try {
      const r = await db.from("site_settings").update({ streambetter_public_key: cleaned || null }).eq("id", 1);
      if (r.error) throw r.error;
      setPublicKey(cleaned); toast.success("Chave pública StreamBetter salva. Sincronize os filmes para atualizar as URLs de reprodução.");
    } catch (e) { toast.error(errMsg(e)); } finally { setSavingKey(false); }
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
      <p className="text-sm text-muted-foreground">Importa filmes e séries do catálogo público em lotes de 10. Os embeds oficiais são adicionados sem substituir outras fontes e são vinculados aos episódios que já existem no GLTV Play.</p>
      <div className="grid gap-2 rounded-xl border border-border p-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-end">
        <div className="space-y-1.5"><Label htmlFor="streambetter-public-key">Chave pública Creator (opcional)</Label><Input id="streambetter-public-key" value={publicKey} onChange={e => setPublicKey(e.target.value)} placeholder="sb_pk_..." autoComplete="off" disabled={!keyLoaded || savingKey} /><p className="text-xs text-muted-foreground">Use somente a chave pública do plano Creator, nunca uma chave secreta sb_sk_. Cadastre também o domínio público do GLTV Play no perfil StreamBetter. A chave pública aparece na URL do iframe por projeto do provedor.</p></div>
        <Button type="button" variant="outline" disabled={!keyLoaded || savingKey} onClick={savePublicKey}>{savingKey ? <Loader2 className="animate-spin" /> : null} Salvar chave</Button>
      </div>
      <div className="flex flex-wrap gap-2">
        <Button type="button" variant="outline" disabled={testing || running} onClick={testConnection}>{testing ? <Loader2 className="animate-spin" /> : <RefreshCw />} Testar conexão</Button>
        <Button type="button" variant="outline" disabled={running} onClick={() => run("movie", false, "sync", true)}><Play /> Testar 10 filmes</Button>
        <Button type="button" variant="outline" disabled={running} onClick={() => run("series", false, "sync", true)}><Play /> Testar 10 séries</Button>
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
        <p className="mt-2 flex items-start gap-2"><CircleAlert className="mt-0.5 size-4 shrink-0" /> A API pública de títulos não lista todas as temporadas e episódios. Não são criados episódios fictícios; o embed de série é vinculado apenas a episódios já cadastrados no GLTV Play.</p>
      </div>
    </section>
  );
}
