import { Wrench } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { Check, ChevronLeft, ChevronRight, DownloadCloud, ListVideo, Loader2, Pause, Play, RotateCcw, Search } from "lucide-react";
import { errMsg } from "@/lib/admin/db";
import { bugouSearchSeries, bugouSeriesDetails, bugouImportEpisodes, bugouCreateJob, bugouRunJob, bugouRetryFailed, bugouCancelJob, bugouJobsOverview, bugouCategoryStats, bugouCategoryList } from "@/lib/integrations/bugoumods.functions";
import type { BugouSeries, BugouDetails } from "@/lib/integrations/bugoumods";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { CatalogSyncBar } from "./CatalogSync";
import { ApiSearchBar } from "./ApiSearchBar";
import { apiSearch } from "@/lib/integrations/api-search.functions";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";

type Job = { id: string; label: string; status: string; total: number; done: number; failed: number; pending: number; queued?: number; processing?: number; waiting?: number; next_retry_at?: string | null; throttled?: boolean; requests?: number; http429?: number; seasons?: number; with_player?: number; no_episodes?: number; episodes_created: number; failures: { ext_id: string; title: string | null; error: string | null; rate_limited?: number }[] };

export function BugouSeriesButton({ label = "Buscar séries pela API", disabled = false }: { label?: string; disabled?: boolean } = {}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button size="sm" variant="outline" className="rounded-full" disabled={disabled} onClick={() => setOpen(true)}><Search /> {label}</Button>
      {open && <BugouDialog onClose={() => setOpen(false)} />}
    </>
  );
}

function BugouDialog({ onClose }: { onClose: () => void }) {
  const qc = useQueryClient();
  const search = useServerFn(bugouSearchSeries); const createJob = useServerFn(bugouCreateJob); const runJob = useServerFn(bugouRunJob);
  const retry = useServerFn(bugouRetryFailed); const pause = useServerFn(bugouCancelJob); const overview = useServerFn(bugouJobsOverview); const catStatsFn = useServerFn(bugouCategoryStats); const catListFn = useServerFn(bugouCategoryList);
  const [catStats, setCatStats] = useState<Awaited<ReturnType<typeof bugouCategoryStats>> | null>(null);
  const [catList, setCatList] = useState<Awaited<ReturnType<typeof bugouCategoryList>> | null>(null);
  const loadCats = useCallback(() => { catListFn().then(setCatList).catch(x => toast.error(errMsg(x))); }, [catListFn]); const [confirmCat, setConfirmCat] = useState(false);
  const apiSearchFn = useServerFn(apiSearch);
  const seq = useRef(0); const [apiTerm, setApiTerm] = useState<string | null>(null); const [searchErr, setSearchErr] = useState<string | null>(null);
  const [cat, setCat] = useState(""); const [page, setPage] = useState(0);
  const [cats, setCats] = useState<string[]>([]); const [meta, setMeta] = useState<{ total: number; matches: number; pageSize: number; synced_at: string } | null>(null);
  const [items, setItems] = useState<BugouSeries[]>([]); const [existing, setExisting] = useState<Record<string, string>>({});
  const [sel, setSel] = useState<Set<string>>(new Set()); const [busy, setBusy] = useState<"search" | "import" | null>(null);
  const [detailId, setDetailId] = useState<string | null>(null);
  const [job, setJob] = useState<Job | null>(null); const [ov, setOv] = useState<{ indexTotal: number; imported: number } | null>(null);
  const [confirmAll, setConfirmAll] = useState(false);
  const running = useRef(false);

  const run = useCallback(async (p = 0, opts: { refresh?: boolean; withCategories?: boolean; category?: string } = {}) => {
    // Index browse (category / full list). A newer search or browse supersedes this one.
    const my = ++seq.current; setBusy("search"); setSearchErr(null);
    const category = opts.category ?? cat;
    try {
      const r = await search({ data: { query: "", category, page: p, refresh: !!opts.refresh, withCategories: !!opts.withCategories } });
      if (opts.withCategories) setCats(r.categories);
      if (my !== seq.current) return;
      setApiTerm(null); setItems(r.results); setExisting(r.existing); setMeta(r); setPage(p);
      if (opts.refresh) toast.success(`Índice atualizado: ${r.total} séries.`);
    } catch (x) { if (my === seq.current) setSearchErr(errMsg(x)); } finally { if (my === seq.current) setBusy(null); }
  }, [search, cat]);

  async function searchApi(term: string) {
    const my = ++seq.current; setBusy("search"); setSearchErr(null);
    setCat(""); setCatStats(null); setConfirmCat(false); setSel(new Set()); setApiTerm(term); setItems([]); setMeta(null);
    try {
      const r = await apiSearchFn({ data: { kind: "series", query: term } });
      if (my !== seq.current) return;
      setItems(r.series); setExisting(r.existing); setPage(0);
    } catch (x) { if (my === seq.current) setSearchErr(errMsg(x)); } finally { if (my === seq.current) setBusy(null); }
  }

  async function pickCategory(c: string) {
    setCat(c); setSel(new Set()); setConfirmCat(false); setCatStats(null);
    run(0, { category: c });
    if (c) catStatsFn({ data: { category: c } }).then(setCatStats).catch(x => toast.error(errMsg(x)));
  }

  const drive = useCallback(async (j: Job) => {
    if (running.current) return; running.current = true; setJob(j);
    try {
      let cur = j; let first = true;
      while (cur.status !== "done" && cur.status !== "paused" && cur.pending > 0) {
        const r = await runJob({ data: { jobId: cur.id, resume: first } }); first = false;
        cur = r as Job; setJob(cur);
        if (!running.current) break;
        // Wait for the provider's pause / next scheduled retry instead of hammering the server.
        const until = cur.next_retry_at ? Date.parse(cur.next_retry_at) - Date.now() : 0;
        const nothingDue = (cur.queued ?? 1) === 0 && (cur.processing ?? 0) === 0;
        if (r.busy) await new Promise(res => setTimeout(res, 4000));
        else if (until > 0 && (cur.throttled || nothingDue)) await new Promise(res => setTimeout(res, Math.min(until + 500, 15000)));
      }
      if (cur.status === "done") { toast.success(`Importação concluída: ${cur.done} série(s), ${cur.episodes_created} episódio(s) novos${cur.failed ? `, ${cur.failed} com falha` : ""}.`); qc.invalidateQueries({ queryKey: ["admin"] }); }
    } catch (x) { toast.error(`${errMsg(x)} — use "Retomar" para continuar de onde parou.`); }
    finally { running.current = false; }
  }, [runJob, qc]);

  useEffect(() => {
    run(0, { withCategories: true }); loadCats();
    overview().then(o => { setOv(o); const open = (o.jobs as Job[]).find(j => j.status !== "done" || j.failed > 0); if (open) setJob(open); }).catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (detailId) return <EpisodesDialog id={detailId} onBack={() => setDetailId(null)} onClose={onClose} />;

  async function start(data: { ids?: string[]; allMissing?: boolean; category?: string; repairEmpty?: boolean }) {
    setBusy("import");
    try { const j = await createJob({ data: { ids: data.ids ?? [], allMissing: !!data.allMissing, category: data.category, repairEmpty: !!data.repairEmpty } }); if (j.unmatched?.length) toast.warning(`${j.unmatched.length} série(s) sem episódios não existem na lista atual da API e ficaram como estão: ${j.unmatched.slice(0, 5).join(", ")}${j.unmatched.length > 5 ? "…" : ""}`); setSel(new Set()); setConfirmAll(false); setConfirmCat(false); setBusy(null); await drive(j as Job); if (apiTerm != null) searchApi(apiTerm); else run(page); overview().then(setOv).catch(() => {}); if (cat) catStatsFn({ data: { category: cat } }).then(setCatStats).catch(() => {}); loadCats(); }
    catch (x) { toast.error(errMsg(x)); setBusy(null); }
  }
  const missing = ov ? Math.max(0, ov.indexTotal - ov.imported) : null;
  const pages = meta ? Math.max(1, Math.ceil(meta.matches / meta.pageSize)) : 1;
  const jobActive = !!job && running.current;
  // While showing API search results, panels move below them so results sit right under the search field (phones).
  const later = apiTerm != null ? "order-last" : "";

  return (
    <Dialog open onOpenChange={o => !o && onClose()}>
      <DialogContent className="h-[100dvh] max-h-[100dvh] max-w-none content-start overflow-y-auto overscroll-contain rounded-none p-4 sm:h-auto sm:max-h-[90vh] sm:max-w-5xl sm:rounded-lg sm:p-6">
        <DialogHeader>
          <DialogTitle>Buscar séries pela API — BugouMods VIP</DialogTitle>
          <DialogDescription>"Importar série completa" traz a série com todas as temporadas, episódios e players VIP. Reimportar só adiciona o que falta; nada é apagado.</DialogDescription>
        </DialogHeader>
        <div className="sticky -top-4 z-10 -mx-4 space-y-2 border-b border-border bg-background px-4 py-2 sm:static sm:mx-0 sm:border-0 sm:p-0">
          <ApiSearchBar label="Nome da série" placeholder="Nome da série (completo ou parte)" busy={busy === "search"} onSearch={searchApi}
            source="Pesquisa direto na API BugouMods VIP (busca oficial do provedor), inclusive séries ainda não importadas." />
          <div className="flex flex-wrap gap-2">
          {(catList?.categories.length || cats.length) ? (
            <select aria-label="Categoria" className="h-10 min-w-0 max-w-full flex-1 rounded-md border border-input bg-background px-2 text-sm" value={cat} onChange={e => pickCategory(e.target.value)}>
              <option value="">Todas as categorias</option>
              {catList ? catList.categories.map(c => <option key={c.name} value={c.name}>{c.name} — {c.imported}/{c.total} importadas</option>) : cats.map(c => <option key={c} value={c}>{c}</option>)}
            </select>
          ) : null}
          <Button type="button" variant="outline" disabled={!!busy || jobActive} onClick={() => start({ repairEmpty: true })} title="Busca na API VIP as temporadas, episódios e players das séries já importadas que estão vazias"><Wrench /> Completar séries sem episódios</Button>
          </div>
        </div>

        {job && (
          <div className={`space-y-2 rounded-xl border border-border p-3 text-sm ${later}`}>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="font-medium">{job.label}</span>
              <span className="text-xs text-muted-foreground">{job.queued ?? job.pending} na fila · {job.processing ?? 0} processando · {job.done} concluída(s) · {job.waiting ?? 0} aguardando nova tentativa · {job.failed} com falha</span>
            </div>
            <p className="text-xs text-muted-foreground">{job.seasons ?? 0} temporada(s) e {job.episodes_created} episódio(s) novos · {job.requests ?? 0} consulta(s) ao provedor · {job.http429 ?? 0} limite(s) HTTP 429</p>
            <p className="text-xs text-muted-foreground">{job.with_player ?? 0} episódio(s) verificados com player VIP · {job.no_episodes ?? 0} série(s) sem episódios no provedor · uma série só conta como concluída depois de conferir no banco todos os episódios e players.</p>
            {job.next_retry_at && Date.parse(job.next_retry_at) > Date.now() && (
              <p className="rounded-lg bg-primary/10 px-2 py-1 text-xs">{job.throttled ? "Pausado pelo limite de requisições do provedor. " : ""}Próxima tentativa às {new Date(job.next_retry_at).toLocaleTimeString("pt-BR")}. O progresso está salvo.</p>
            )}
            <Progress value={job.total ? ((job.done + job.failed) / job.total) * 100 : 0} />
            <div className="flex flex-wrap gap-2">
              {jobActive && <Button size="sm" variant="outline" onClick={() => { running.current = false; pause({ data: { jobId: job.id } }).then(j => setJob(j as Job)); }}><Pause /> Pausar</Button>}
              {!jobActive && job.pending > 0 && <Button size="sm" onClick={() => drive({ ...job, status: "running" })}><Play /> Retomar</Button>}
              {!jobActive && job.failed > 0 && <Button size="sm" variant="outline" onClick={() => retry({ data: { jobId: job.id } }).then(j => drive(j as Job))}><RotateCcw /> Tentar de novo só as falhas</Button>}
              {jobActive && <Loader2 className="h-4 w-4 animate-spin self-center" />}
            </div>
            {job.failures.length > 0 && <ul className="max-h-28 space-y-0.5 overflow-y-auto text-xs text-muted-foreground">{job.failures.map(f => <li key={f.ext_id}><span className="text-destructive">✕</span> {f.title ?? f.ext_id}: {f.error}</li>)}</ul>}
          </div>
        )}

        <div className={later}><CatalogSyncBar kind="series" onDone={() => { if (apiTerm == null) run(0, { withCategories: true }); loadCats(); overview().then(setOv).catch(() => {}); if (cat) catStatsFn({ data: { category: cat } }).then(setCatStats).catch(() => {}); }} /></div>
        {catList && <p className={`text-xs text-muted-foreground ${later}`}>Catálogo da API: {catList.distinct} séries únicas em {catList.categories.length} categorias · {catList.imported} já no aplicativo{catList.synced_at ? ` · leitura completa em ${new Date(catList.synced_at).toLocaleString("pt-BR")}` : ""}</p>}

        <div className={`flex flex-wrap items-center gap-2 ${later}`}>
          <Button size="sm" disabled={!sel.size || !!busy || jobActive} onClick={() => start({ ids: [...sel] })}>{busy === "import" ? <Loader2 className="animate-spin" /> : <DownloadCloud />} Importar série completa {sel.size ? `(${sel.size})` : ""}</Button>
          {missing != null && missing > 0 && !confirmAll && <Button size="sm" variant="outline" disabled={!!busy || jobActive} onClick={() => setConfirmAll(true)}>Importar todas as não importadas…</Button>}
          {confirmAll && <span className="flex flex-wrap items-center gap-2 rounded-lg border border-border p-2 text-xs">
            Isso vai importar cerca de {missing} séries com todos os episódios (1 consulta ao provedor por série, em sequência — pode levar horas; pode pausar e retomar). Confirmar?
            <Button size="sm" onClick={() => start({ allMissing: true })}>Sim, importar</Button>
            <Button size="sm" variant="ghost" onClick={() => setConfirmAll(false)}>Cancelar</Button>
          </span>}
        </div>

        {cat && (
          <div className="flex flex-wrap items-center gap-2 rounded-xl border border-primary/40 bg-primary/5 p-3 text-sm">
            <b>{cat}</b>
            {catStats ? <span className="grid w-full grid-cols-3 gap-2 text-xs sm:w-auto sm:flex sm:flex-wrap">
              <span className="rounded-lg bg-background/60 px-2 py-1">Disponíveis na API: <b>{catStats.total}</b></span>
              <span className="rounded-lg bg-background/60 px-2 py-1">Importadas: <b>{catStats.imported}</b></span>
              <span className="rounded-lg bg-background/60 px-2 py-1">Pendentes: <b>{catStats.missing}</b></span>
              <span className="col-span-3 text-muted-foreground">Nas importadas: {catStats.seasons} temporada(s) · {catStats.episodes} episódio(s) · {catStats.withPlayer} com player VIP{catStats.noPlayer ? ` · ${catStats.noPlayer} sem player` : ""}{catStats.emptySeries ? ` · ${catStats.emptySeries} série(s) sem episódios` : ""}</span>
            </span> : <span className="text-muted-foreground">Contando séries…</span>}
            <Button size="sm" variant="ghost" className="ml-auto" disabled={!items.length} onClick={() => setSel(s => { const all = items.every(i => s.has(i.id)); const x = new Set(s); items.forEach(i => (all ? x.delete(i.id) : x.add(i.id))); return x; })}>{items.length && items.every(i => sel.has(i.id)) ? "Desmarcar esta página" : "Selecionar todas desta página"}</Button>
          </div>
        )}
        {searchErr && <p role="alert" className="rounded-lg border border-destructive/40 p-2 text-sm text-destructive">{searchErr}</p>}
        {apiTerm != null && <p className="text-xs text-muted-foreground" aria-live="polite">{busy === "search" ? `Pesquisando "${apiTerm}" na API BugouMods VIP…` : searchErr ? "" : items.length ? `${items.length} série(s) encontrada(s) na API para "${apiTerm}"` : `Nenhuma série encontrada na API para "${apiTerm}". Tente outra parte do nome.`}</p>}
        {apiTerm != null && items.length > 0 && <div className="flex flex-wrap items-center gap-2">
          <Button size="sm" variant="ghost" onClick={() => setSel(s => { const all = items.every(i => s.has(i.id)); const x = new Set(s); items.forEach(i => (all ? x.delete(i.id) : x.add(i.id))); return x; })}>{items.every(i => sel.has(i.id)) ? "Desmarcar resultados" : `Selecionar os ${items.length} resultados`}</Button>
          {sel.size > 0 && <Button size="sm" disabled={!!busy || jobActive} onClick={() => start({ ids: [...sel] })}><DownloadCloud /> Importar série completa ({sel.size})</Button>}
        </div>}
        {meta && apiTerm == null && <p className="text-xs text-muted-foreground">Navegando pelo índice da API: {meta.matches} resultado(s) de {meta.total} séries no índice · atualizado {new Date(meta.synced_at).toLocaleString("pt-BR")}{ov ? ` · ${ov.imported} já importadas` : ""}</p>}
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-5">
          {items.map(r => { const has = !!existing[r.id]; const on = sel.has(r.id); return (
            <button key={r.id} type="button" onClick={() => setSel(s => { const x = new Set(s); if (x.has(r.id)) x.delete(r.id); else if (x.size < 500) x.add(r.id); return x; })}
              className={`relative overflow-hidden rounded-xl border text-left transition ${on ? "border-primary shadow-glow" : "border-border"}`}>
              <div className="aspect-[2/3] bg-muted">{r.poster_url && <img src={r.poster_url} alt="" loading="lazy" className="h-full w-full object-cover" />}</div>
              <div className="p-2"><p className="truncate text-sm font-medium">{r.title}</p><p className="truncate text-xs text-muted-foreground">{r.year ?? "—"} · {r.category}</p></div>
              <Badge variant={has ? "secondary" : "outline"} className="absolute left-2 top-2 bg-background/90">{has ? "Importada · atualizar" : "Não importada"}</Badge>
              <span role="button" tabIndex={0} onClick={ev => { ev.stopPropagation(); setDetailId(r.id); }} onKeyDown={ev => { if (ev.key === "Enter") { ev.stopPropagation(); setDetailId(r.id); } }} className="absolute bottom-14 right-2 inline-flex items-center gap-1 rounded-full bg-background/90 px-2 py-1 text-xs font-medium ring-1 ring-border"><ListVideo className="h-3 w-3" /> Episódios</span>
              {on && <span className="absolute right-2 top-2 rounded-full bg-primary p-1 text-primary-foreground"><Check className="h-3 w-3" /></span>}
            </button>); })}
        </div>
        {meta && apiTerm == null && pages > 1 && (
          <div className="flex items-center justify-center gap-2">
            <Button size="sm" variant="outline" disabled={page === 0 || !!busy} onClick={() => run(page - 1)}><ChevronLeft /></Button>
            <span className="text-sm">Página {page + 1} de {pages}</span>
            <Button size="sm" variant="outline" disabled={page + 1 >= pages || !!busy} onClick={() => run(page + 1)}><ChevronRight /></Button>
          </div>
        )}
        {cat && catStats && (
          <div className="sticky bottom-0 flex flex-wrap items-center gap-2 border-t border-border bg-background pt-3">
            {!confirmCat ? <>
              <span className="text-xs text-muted-foreground">{sel.size ? `${sel.size} selecionada(s)` : "Nenhuma selecionada — você pode importar a categoria inteira."}</span>
              {sel.size > 0 && <Button size="sm" variant="outline" disabled={!!busy || jobActive} onClick={() => start({ ids: [...sel] })}>Importar selecionadas ({sel.size})</Button>}
              <Button className="ml-auto rounded-full" disabled={!!busy || jobActive || !catStats.total} onClick={() => setConfirmCat(true)}><DownloadCloud /> Importar categoria completa ({catStats.total})</Button>
            </> : <span className="flex w-full flex-wrap items-center gap-2 text-sm">
              Serão processadas {catStats.total} série(s) de "{cat}" — inclusive as que não aparecem nesta página: {catStats.missing} novas e {catStats.imported} já existentes (só recebem temporadas, episódios e players que faltam). Cada série traz temporadas, episódios e players VIP. Pode pausar e retomar. Confirmar?
              <Button size="sm" onClick={() => start({ category: cat })}>Sim, importar categoria</Button>
              <Button size="sm" variant="ghost" onClick={() => setConfirmCat(false)}>Cancelar</Button>
            </span>}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

function EpisodesDialog({ id, onBack, onClose }: { id: string; onBack: () => void; onClose: () => void }) {
  const qc = useQueryClient();
  const load = useServerFn(bugouSeriesDetails); const doImport = useServerFn(bugouImportEpisodes);
  const [d, setD] = useState<{ details: BugouDetails; localSeriesId: string | null; existingEpisodes: string[] } | null>(null);
  const [err, setErr] = useState<string | null>(null); const [busy, setBusy] = useState(false);
  const [pick, setPick] = useState<Set<number>>(new Set());
  useEffect(() => { load({ data: { id } }).then(r => { setD(r); setPick(new Set(r.details.seasons.map(s => s.season))); }).catch(x => setErr(errMsg(x))); }, [id, load]);
  async function run() {
    setBusy(true);
    try {
      const r = await doImport({ data: { id, seasons: [...pick] } });
      toast.success(`${r.seriesCreated ? "Série criada. " : ""}${r.episodesCreated} episódio(s) novo(s), ${r.episodesExisting} já existiam; ${r.sourcesCreated} player(s) adicionados, ${r.sourcesExisting} já existiam.`);
      qc.invalidateQueries({ queryKey: ["admin"] });
      setD(await load({ data: { id } }));
    } catch (x) { toast.error(errMsg(x)); } finally { setBusy(false); }
  }
  const det = d?.details; const have = new Set(d?.existingEpisodes ?? []);
  const total = det?.seasons.reduce((n, s) => n + s.episodes.length, 0) ?? 0;
  return (
    <Dialog open onOpenChange={o => !o && onClose()}>
      <DialogContent className="max-h-[90vh] max-w-3xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{det?.title ?? "Carregando…"}{det?.year ? ` (${det.year})` : ""}</DialogTitle>
          <DialogDescription>{det ? `${det.seasons.length} temporada(s) · ${total} episódio(s) na API · ${have.size} já no catálogo.` : "Consultando o BugouMods…"} Dados existentes não são apagados.</DialogDescription>
        </DialogHeader>
        <Button size="sm" variant="ghost" className="self-start" onClick={onBack}>← Voltar à lista</Button>
        {err && <p className="text-sm text-destructive">{err}</p>}
        {!det && !err && <Loader2 className="mx-auto animate-spin" />}
        {det && <>
          <p className="text-xs text-muted-foreground">{d?.localSeriesId ? "Série já existe no catálogo — será reaproveitada e só o que falta será importado." : "Série ainda não existe — será criada."}</p>
          {det.seasons.length === 0 && <p className="text-sm text-muted-foreground">A API não retornou temporadas para esta série.</p>}
          {det.seasons.map(s => (
            <div key={s.season} className="rounded-xl border border-border p-3">
              <label className="flex items-center gap-2 font-medium"><input type="checkbox" checked={pick.has(s.season)} onChange={() => setPick(p => { const x = new Set(p); if (x.has(s.season)) x.delete(s.season); else x.add(s.season); return x; })} /> Temporada {s.season} · {s.episodes.length} episódio(s)</label>
              <ul className="mt-2 space-y-1 text-sm">
                {s.episodes.map(e => <li key={e.id} className="flex items-center gap-2"><span className="w-8 text-muted-foreground">E{e.episode}</span><span className="flex-1 truncate">{e.title}</span>{e.duration_minutes && <span className="text-xs text-muted-foreground">{e.duration_minutes} min</span>}{have.has(`${s.season}x${e.episode}`) && <Badge variant="secondary">Já existe</Badge>}</li>)}
              </ul>
            </div>))}
          <Button disabled={!pick.size || busy} onClick={run}>{busy ? <Loader2 className="animate-spin" /> : <DownloadCloud />} Importar temporadas selecionadas</Button>
        </>}
      </DialogContent>
    </Dialog>
  );
}
