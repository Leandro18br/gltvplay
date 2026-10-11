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
    <div className="rounded-2xl border border-primary/30 bg-card p-4">
      <div className="flex flex-wrap items-start gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2"><Clapperboard className="size-4 text-primary" /><h2 className="font-semibold">{i.name}</h2><Badge variant="secondary">Séries</Badge><StatusBadge i={i} /></div>
          <p className="mt-1 text-xs text-muted-foreground">Última sincronização: {fmtDate(i.last_synced_at ?? o?.synced_at ?? null)} · último teste {fmtDate(i.last_tested_at)}{o && <> · {o.indexTotal} séries na API · {o.imported} importadas</>}</p>
          {i.last_error && <p className="mt-1 text-xs text-destructive">Último erro: {i.last_error}</p>}
        </div>
        <div className="flex flex-wrap gap-1">
          <Button size="sm" variant="outline" disabled={!!busy || !i.is_active} onClick={doTest}>{busy === "test" ? <Loader2 className="animate-spin" /> : <FlaskConical />} Testar conexão</Button>
          <Button size="sm" variant="outline" disabled={!!busy || !i.is_active} onClick={doSync}>{busy === "sync" ? <Loader2 className="animate-spin" /> : <RefreshCw />} Sincronizar</Button>
          <BugouSeriesButton label="Importar séries" disabled={!i.is_active} />
        </div>
      </div>
      {testRes && <p className="mt-3 rounded-xl bg-muted/40 p-3 text-xs">Resposta JSON em {testRes.ms} ms · {testRes.series} séries · {testRes.categories} categorias{testRes.sample && <> · amostra "{testRes.sample.title}": {testRes.sample.seasons} temporadas, {testRes.sample.episodes} episódios{testRes.sample.hasPlot ? ", com sinopse" : ""}</>}</p>}
      {!!o?.jobs.length && <div className="mt-3 space-y-1">
        <p className="text-xs font-medium text-muted-foreground">Histórico de importações</p>
        {o.jobs.map(j => <div key={j.id} className="rounded-lg bg-muted/30 px-3 py-1.5 text-xs">
          <b>{j.label}</b> · {j.status} · {j.done}/{j.total} concluídas · {j.failed} falhas · {j.episodes_created} episódios criados
          {!!j.failures?.length && <ul className="mt-1 text-destructive">{j.failures.slice(0, 5).map(f => <li key={f.ext_id}>{f.title ?? f.ext_id}: {f.error}</li>)}</ul>}
        </div>)}
      </div>}
    </div>
  );
}
