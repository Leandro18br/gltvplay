import { useEffect, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { Check, DownloadCloud, FlaskConical, Loader2, Pause, Play, RefreshCw, RotateCcw, Tv } from "lucide-react";
import { db, errMsg } from "@/lib/admin/db";
import { liveCategories, liveChannels, liveCreateJob, liveOverview, livePauseJob, liveRetryFailed, liveRunJob, liveSync, liveTest } from "@/lib/integrations/live.functions";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Progress } from "@/components/ui/progress";
import { fmtDate } from "./shared";

type Job = Awaited<ReturnType<typeof liveRunJob>>;
type LiveInteg = { id: string; name: string; is_active: boolean; last_synced_at: string | null };

export function LiveChannelsCard() {
  const list = useQuery({ queryKey: ["admin", "integrations", "live"], queryFn: async () => { const r = await db.from("api_integrations").select("id,name,is_active,last_synced_at").eq("kind", "live").order("priority"); if (r.error) throw r.error; return r.data as LiveInteg[]; } });
  if (!list.data?.length) return null;
  return <>{list.data.map(i => <LiveIntegration key={i.id} i={i} />)}</>;
}

function LiveIntegration({ i }: { i: LiveInteg }) {
  const qc = useQueryClient();
  const test = useServerFn(liveTest); const sync = useServerFn(liveSync); const overviewFn = useServerFn(liveOverview);
  const [busy, setBusy] = useState<"" | "test" | "sync">(""); const [open, setOpen] = useState(false);
  const [testRes, setTestRes] = useState<Awaited<ReturnType<typeof liveTest>> | null>(null);
  const ov = useQuery({ queryKey: ["admin", "live-overview", i.id], queryFn: () => overviewFn({ data: { integrationId: i.id } }) });
  const refresh = () => { qc.invalidateQueries({ queryKey: ["admin", "live-overview", i.id] }); qc.invalidateQueries({ queryKey: ["admin", "integrations"] }); qc.invalidateQueries({ queryKey: ["admin", "api-logs"] }); };
  async function doTest() { setBusy("test"); try { setTestRes(await test({ data: { integrationId: i.id } })); toast.success("Conexão OK"); } catch (e) { toast.error(errMsg(e)); } finally { setBusy(""); refresh(); } }
  async function doSync() { setBusy("sync"); try { const r = await sync({ data: { integrationId: i.id } }); toast.success(`Sincronizado: ${r.categories} categorias, ${r.channels} canais (${r.missingLink} sem link).`); } catch (e) { toast.error(errMsg(e)); } finally { setBusy(""); refresh(); } }
  const o = ov.data;
  return (
    <div className="rounded-2xl border border-primary/30 bg-card p-4">
      <div className="flex flex-wrap items-start gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2"><Tv className="size-4 text-primary" /><h2 className="font-semibold">{i.name}</h2><Badge variant="secondary">Canais ao vivo</Badge>{!i.is_active && <Badge variant="outline">Inativa</Badge>}</div>
          <p className="mt-1 text-xs text-muted-foreground">Última sincronização: {fmtDate(i.last_synced_at)}{o && <> · {o.indexed} canais na API · {o.imported} importados · {o.noLink} sem link</>}</p>
        </div>
        <div className="flex flex-wrap gap-1">
          <Button size="sm" variant="outline" disabled={!!busy} onClick={doTest}>{busy === "test" ? <Loader2 className="animate-spin" /> : <FlaskConical />} Testar conexão</Button>
          <Button size="sm" variant="outline" disabled={!!busy || !i.is_active} onClick={doSync}>{busy === "sync" ? <Loader2 className="animate-spin" /> : <RefreshCw />} Sincronizar</Button>
          <Button size="sm" disabled={!i.is_active || !i.last_synced_at} onClick={() => setOpen(true)}><DownloadCloud /> Importar canais</Button>
        </div>
      </div>
      {testRes && <p className="mt-3 rounded-xl bg-muted/40 p-3 text-xs">HTTP {testRes.status} em {testRes.ms} ms · {testRes.categories} categorias · {testRes.received} registros recebidos · {testRes.valid} válidos · {testRes.withLink} com link de reprodução · {testRes.missingLink} sem link · {testRes.duplicates} repetidos · {testRes.invalid} inválidos</p>}
      {o && <div className="mt-3 grid grid-cols-2 gap-2 text-xs md:grid-cols-4">
        <Metric l="Consultas com sucesso" v={o.requests ? `${o.requestOk}/${o.requests} (${Math.round(o.requestOk / o.requests * 100)}%)` : "—"} />
        <Metric l="Tempo médio da consulta" v={o.avgFetchMs != null ? `${o.avgFetchMs} ms` : "—"} />
        <Metric l="Importações OK / falhas" v={`${o.importOk} / ${o.importFailed}`} />
        <Metric l="Duplicações evitadas" v={String(o.duplicatesAvoided)} />
        <Metric l="Falhas: timeout / credencial" v={`${o.errors.timeout} / ${o.errors.auth}`} />
        <Metric l="Falhas: formato / limite" v={`${o.errors.format} / ${o.errors.limit}`} />
      </div>}
      {!!o?.jobs.length && <div className="mt-3 space-y-1">
        <p className="text-xs font-medium text-muted-foreground">Histórico de importações</p>
        {o.jobs.map(j => <JobLine key={j.id} j={j} onChange={refresh} />)}
      </div>}
      <ImportDialog open={open} onOpenChange={setOpen} integ={i} onDone={refresh} />
    </div>
  );
}
const Metric = ({ l, v }: { l: string; v: string }) => <div className="rounded-xl border border-border p-2"><p className="text-muted-foreground">{l}</p><p className="font-semibold">{v}</p></div>;

function useJobRunner(onDone: () => void) {
  const run = useServerFn(liveRunJob); const retry = useServerFn(liveRetryFailed); const pause = useServerFn(livePauseJob);
  const [job, setJob] = useState<Job | null>(null); const stop = useRef(false);
  async function drive(id: string) {
    stop.current = false;
    try {
      for (let n = 0; n < 500 && !stop.current; n++) {
        const j = await run({ data: { jobId: id } }); setJob(j);
        if (j.status === "done" || j.status === "paused") break;
        if (j.busy) await new Promise(r => setTimeout(r, 3000));
      }
    } catch (e) { toast.error(errMsg(e)); } finally { onDone(); }
  }
  return { job, setJob, drive, stop: async (id: string) => { stop.current = true; setJob(await pause({ data: { jobId: id } })); }, retry: async (id: string) => { setJob(await retry({ data: { jobId: id } })); await drive(id); } };
}

function JobLine({ j, onChange }: { j: Job | Awaited<ReturnType<typeof liveOverview>>["jobs"][number]; onChange: () => void }) {
  const r = useJobRunner(onChange); const cur = r.job ?? j; const [show, setShow] = useState(false);
  return <div className="rounded-xl border border-border p-2 text-xs">
    <div className="flex flex-wrap items-center gap-2">
      <span className="font-medium">{cur.label}</span><Badge variant="outline">{statusLabel(cur.status)}</Badge>
      <span className="text-muted-foreground">{fmtDate(cur.created_at)} · {cur.stats.created ?? 0} novos · {cur.stats.updated ?? 0} atualizados · {cur.stats.skipped ?? 0} já existiam · {cur.failed} falhas · {cur.pending} pendentes</span>
      <span className="ml-auto flex gap-1">
        {cur.pending > 0 && cur.status !== "done" && <Button size="sm" variant="ghost" onClick={() => r.drive(cur.id)}><Play /> Retomar</Button>}
        {cur.failed > 0 && <Button size="sm" variant="ghost" onClick={() => r.retry(cur.id)}><RotateCcw /> Repetir falhas</Button>}
        {cur.failed > 0 && <Button size="sm" variant="ghost" onClick={() => setShow(s => !s)}>Motivos</Button>}
      </span>
    </div>
    {show && <ul className="mt-1 space-y-0.5 text-destructive">{cur.failures.map(f => <li key={f.ext_id}>{f.title ?? f.ext_id}: {f.error}</li>)}</ul>}
  </div>;
}
const statusLabel = (s: string) => ({ queued: "Na fila", running: "Em andamento", done: "Concluída", paused: "Pausada", cancelled: "Cancelada" } as Record<string, string>)[s] ?? s;

function ImportDialog({ open, onOpenChange, integ, onDone }: { open: boolean; onOpenChange: (o: boolean) => void; integ: LiveInteg; onDone: () => void }) {
  const catsFn = useServerFn(liveCategories); const chFn = useServerFn(liveChannels); const create = useServerFn(liveCreateJob);
  const cats = useQuery({ queryKey: ["admin", "live-cats", integ.id], queryFn: () => catsFn({ data: { integrationId: integ.id } }), enabled: open });
  const [cat, setCat] = useState<string | null>(null); const [page, setPage] = useState(0);
  const [items, setItems] = useState<Awaited<ReturnType<typeof liveChannels>>["items"]>([]); const [total, setTotal] = useState(0); const [loading, setLoading] = useState(false);
  const [sel, setSel] = useState<Set<string>>(new Set());
  const r = useJobRunner(() => { onDone(); cats.refetch(); if (cat) load(cat, 0, true); });
  async function load(c: string, p: number, reset: boolean) {
    setLoading(true);
    try { const res = await chFn({ data: { integrationId: integ.id, category: c, page: p } }); setItems(prev => reset ? res.items : [...prev, ...res.items]); setTotal(res.total); setPage(p); } catch (e) { toast.error(errMsg(e)); } finally { setLoading(false); }
  }
  useEffect(() => { if (cat) { setSel(new Set()); load(cat, 0, true); } }, [cat]); // eslint-disable-line react-hooks/exhaustive-deps
  const info = cats.data?.find(c => c.name === cat);
  async function start(all: boolean) {
    if (!cat) return;
    const n = all ? info?.total ?? 0 : sel.size; const exist = all ? info?.imported ?? 0 : items.filter(i => sel.has(i.ext_id) && i.imported).length;
    if (!confirm(`Importar ${n} canal(is) de "${cat}"? ${exist} já existem no catálogo e serão apenas atualizados.`)) return;
    try { const j = await create({ data: { integrationId: integ.id, category: cat, ids: all ? [] : [...sel] } }); r.setJob(j); setSel(new Set()); await r.drive(j.id); } catch (e) { toast.error(errMsg(e)); }
  }
  const job = r.job; const running = job && job.status !== "done" && job.status !== "paused";
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[92vh] max-w-5xl flex-col overflow-hidden">
        <DialogHeader><DialogTitle>Importar canais — {integ.name}</DialogTitle></DialogHeader>
        <div className="grid min-h-0 flex-1 gap-3 md:grid-cols-[240px_1fr]">
          <div className="min-h-0 overflow-y-auto rounded-xl border border-border p-1">
            {cats.isPending && <Loader2 className="m-3 animate-spin text-primary" />}
            {cats.data?.map(c => <button key={c.name} type="button" onClick={() => setCat(c.name)} className={`flex w-full items-center justify-between gap-2 rounded-lg px-2 py-1.5 text-left text-sm ${cat === c.name ? "bg-primary/15 text-primary" : "hover:bg-muted"}`}><span className="truncate">{c.name}</span><span className="shrink-0 text-xs text-muted-foreground">{c.imported}/{c.total}</span></button>)}
          </div>
          <div className="flex min-h-0 flex-col">
            {!cat ? <p className="p-6 text-sm text-muted-foreground">Escolha uma categoria para ver os canais.</p> : <>
              <div className="mb-2 flex flex-wrap items-center gap-2 text-sm">
                <b>{cat}</b><span className="text-muted-foreground">{total} canais · {info?.imported ?? 0} já no catálogo · {info?.noLink ?? 0} sem link</span>
                <Button size="sm" variant="ghost" className="ml-auto" onClick={() => setSel(s => s.size === items.length ? new Set() : new Set(items.map(i => i.ext_id)))}>{sel.size === items.length && items.length ? "Limpar seleção" : "Selecionar carregados"}</Button>
              </div>
              <div className="min-h-0 flex-1 overflow-y-auto">
                <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4">
                  {items.map(c => { const on = sel.has(c.ext_id); return (
                    <button key={c.ext_id} type="button" onClick={() => setSel(s => { const x = new Set(s); if (x.has(c.ext_id)) x.delete(c.ext_id); else x.add(c.ext_id); return x; })} className={`relative flex items-center gap-2 rounded-xl border p-2 text-left ${on ? "border-primary shadow-glow" : "border-border"}`}>
                      <div className="flex size-12 shrink-0 items-center justify-center overflow-hidden rounded-lg bg-muted">{c.logo_url ? <img src={c.logo_url} alt="" loading="lazy" className="max-h-full object-contain" /> : <Tv className="size-5 text-muted-foreground" />}</div>
                      <div className="min-w-0 text-xs"><p className="truncate text-sm font-medium">{c.name}</p><p className="truncate text-muted-foreground">ID {c.ext_id}</p>
                        <p>{c.imported ? <span className="text-primary">Importado</span> : "Não importado"} · {c.has_play ? "Link OK" : <span className="text-destructive">Sem link</span>}</p></div>
                      {on && <span className="absolute right-1 top-1 rounded-full bg-primary p-0.5 text-primary-foreground"><Check className="size-3" /></span>}
                    </button>); })}
                </div>
                {items.length < total && <Button variant="ghost" className="mt-2 w-full" disabled={loading} onClick={() => load(cat, page + 1, false)}>{loading && <Loader2 className="animate-spin" />} Carregar mais</Button>}
                {loading && !items.length && <Loader2 className="m-3 animate-spin text-primary" />}
              </div>
            </>}
          </div>
        </div>
        {job && <div className="space-y-1 rounded-xl border border-border p-3 text-sm">
          <div className="flex flex-wrap items-center gap-2"><b>{job.label}</b><Badge variant="outline">{statusLabel(job.status)}</Badge>
            {running && <Button size="sm" variant="ghost" onClick={() => r.stop(job.id)}><Pause /> Pausar</Button>}
            {job.status === "paused" && job.pending > 0 && <Button size="sm" variant="ghost" onClick={() => r.drive(job.id)}><Play /> Retomar</Button>}
            {job.failed > 0 && !running && <Button size="sm" variant="ghost" onClick={() => r.retry(job.id)}><RotateCcw /> Tentar novamente só as falhas</Button>}</div>
          <Progress value={job.total ? ((job.done + job.failed) / job.total) * 100 : 0} />
          <p className="text-xs text-muted-foreground">{job.done + job.failed}/{job.total} · {job.stats.created ?? 0} importados · {job.stats.updated ?? 0} atualizados · {job.stats.skipped ?? 0} ignorados (já existiam) · {job.failed} falharam</p>
          {job.failures.length > 0 && <ul className="max-h-24 overflow-y-auto text-xs text-destructive">{job.failures.map(f => <li key={f.ext_id}>{f.title ?? f.ext_id}: {f.error}</li>)}</ul>}
        </div>}
        {cat && <div className="flex flex-wrap items-center gap-2 border-t border-border pt-3">
          <Button variant="outline" disabled={!!running || !info?.total} onClick={() => start(true)}>Importar todos da categoria ({info?.total ?? 0})</Button>
          <Button className="ml-auto rounded-full" disabled={!sel.size || !!running} onClick={() => start(false)}>{running ? <Loader2 className="animate-spin" /> : <DownloadCloud />} Importar {sel.size || ""}</Button>
        </div>}
      </DialogContent>
    </Dialog>
  );
}
