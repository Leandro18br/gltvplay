import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { Clapperboard, FlaskConical, Loader2, RefreshCw } from "lucide-react";
import { db, errMsg } from "@/lib/admin/db";
import { bugouJobsOverview, bugouSeriesSync, bugouSeriesTest } from "@/lib/integrations/bugoumods.functions";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { BugouSeriesButton } from "./BugouSeriesButton";
import { StatusBadge, fmtDate } from "./shared";

type SeriesInteg = { id: string; name: string; is_active: boolean; last_synced_at: string | null; last_status: "never" | "ok" | "error"; last_error: string | null; last_tested_at: string | null };

/** Series API card (kind 'series'), same pattern as the live-channel card; reuses the BugouMods series importer. */
export function SeriesApiCard() {
  const list = useQuery({ queryKey: ["admin", "integrations", "series"], queryFn: async () => { const r = await db.from("api_integrations").select("id,name,is_active,last_synced_at,last_status,last_error,last_tested_at").eq("kind", "series").order("priority"); if (r.error) throw r.error; return r.data as SeriesInteg[]; } });
  if (!list.data?.length) return null;
  return <>{list.data.map(i => <SeriesIntegration key={i.id} i={i} />)}</>;
}

function SeriesIntegration({ i }: { i: SeriesInteg }) {
  const qc = useQueryClient();
  const test = useServerFn(bugouSeriesTest); const sync = useServerFn(bugouSeriesSync); const overviewFn = useServerFn(bugouJobsOverview);
  const [busy, setBusy] = useState<"" | "test" | "sync">("");
  const [testRes, setTestRes] = useState<Awaited<ReturnType<typeof bugouSeriesTest>> | null>(null);
  const ov = useQuery({ queryKey: ["admin", "series-overview"], queryFn: () => overviewFn() });
  const refresh = () => { qc.invalidateQueries({ queryKey: ["admin", "series-overview"] }); qc.invalidateQueries({ queryKey: ["admin", "integrations"] }); qc.invalidateQueries({ queryKey: ["admin", "api-logs"] }); };
  async function doTest() { setBusy("test"); try { setTestRes(await test()); toast.success("Conexão OK"); } catch (e) { toast.error(errMsg(e)); } finally { setBusy(""); refresh(); } }
  async function doSync() { setBusy("sync"); try { const r = await sync(); toast.success(`Sincronizado: ${r.total} séries.`); } catch (e) { toast.error(errMsg(e)); } finally { setBusy(""); refresh(); } }
  const o = ov.data;
  return (
    <div className="space-y-3 rounded-2xl border border-primary/30 bg-card p-4">
      <div className="flex min-w-0 flex-wrap items-center gap-2"><Clapperboard className="size-4 shrink-0 text-primary" /><h2 className="min-w-0 truncate font-semibold">{i.name}</h2><Badge variant="secondary">Séries</Badge><StatusBadge i={i} /></div>
      <div className="grid gap-3 md:grid-cols-2">
        <section aria-label="Configuração da API" className="space-y-2 rounded-xl border border-border p-3">
          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Configuração da API</p>
          <dl className="grid grid-cols-2 gap-x-3 gap-y-1 text-xs">
            <dt className="text-muted-foreground">Última sincronização</dt><dd className="truncate text-right">{fmtDate(i.last_synced_at ?? o?.synced_at ?? null)}</dd>
            <dt className="text-muted-foreground">Último teste</dt><dd className="truncate text-right">{fmtDate(i.last_tested_at)}</dd>
            {o && <><dt className="text-muted-foreground">Séries na API</dt><dd className="text-right font-medium">{o.indexTotal}</dd><dt className="text-muted-foreground">Importadas</dt><dd className="text-right font-medium">{o.imported}</dd></>}
          </dl>
          {i.last_error && <p className="break-words text-xs text-destructive">Último erro: {i.last_error}</p>}
          <div className="grid grid-cols-2 gap-2">
            <Button size="sm" variant="outline" disabled={!!busy || !i.is_active} onClick={doTest}>{busy === "test" ? <Loader2 className="animate-spin" /> : <FlaskConical />} Testar</Button>
            <Button size="sm" variant="outline" disabled={!!busy || !i.is_active} onClick={doSync}>{busy === "sync" ? <Loader2 className="animate-spin" /> : <RefreshCw />} Sincronizar</Button>
          </div>
        </section>
        <section aria-label="Pesquisa e importação" className="flex flex-col gap-2 rounded-xl border border-border p-3">
          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Pesquisa e importação</p>
          <p className="flex-1 text-xs text-muted-foreground">Pesquise na API, escolha séries ou categorias inteiras e acompanhe o progresso. É possível pausar, retomar ou cancelar.</p>
          <div className="[&>button]:w-full"><BugouSeriesButton label="Pesquisar e importar séries" disabled={!i.is_active} /></div>
        </section>
      </div>
      {testRes && <p className="break-words rounded-xl bg-muted/40 p-3 text-xs">Resposta JSON em {testRes.ms} ms · {testRes.series} séries · {testRes.categories} categorias{testRes.sample && <> · amostra "{testRes.sample.title}": {testRes.sample.seasons} temporadas, {testRes.sample.episodes} episódios{testRes.sample.hasPlot ? ", com sinopse" : ""}</>}</p>}
      {!!o?.jobs.length && <div className="space-y-1">
        <p className="text-xs font-medium text-muted-foreground">Histórico de importações</p>
        {o.jobs.map(j => <div key={j.id} className="break-words rounded-lg bg-muted/30 px-3 py-1.5 text-xs">
          <b>{j.label}</b> · {({ running: "em andamento", paused: "pausada", cancelled: "cancelada", done: "concluída" } as Record<string, string>)[j.status] ?? j.status} · {j.done}/{j.total} concluídas · {j.failed} falhas · {j.episodes_created} episódios criados
          {!!j.failures?.length && <ul className="mt-1 text-destructive">{j.failures.slice(0, 5).map((f: { ext_id: string; title: string | null; error: string | null }) => <li key={f.ext_id}>{f.title ?? f.ext_id}: {f.error}</li>)}</ul>}
        </div>)}
      </div>}
    </div>
  );
}
