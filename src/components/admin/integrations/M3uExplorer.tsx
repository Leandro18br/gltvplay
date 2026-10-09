import { useEffect, useRef, useState } from "react";
import { keepPreviousData, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { Download, Loader2, RotateCcw, Search, Square } from "lucide-react";
const IMPORT_CONCURRENCY = 3;
import { exploreM3u, m3uGroups, pickM3uItems, importM3uItems } from "@/lib/integrations/m3u.functions";
import { errMsg } from "@/lib/admin/db";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";

type Kind = "all" | "movie" | "series" | "channel";
type Status = "all" | "imported" | "not_imported" | "error" | "missing";
type Row = { id: number; kind: string; title: string; year: number | null; group_title: string | null; logo: string | null; tmdb_id: number | null; episode_count: number | null; missing: boolean; content_id: string | null; import_error: string | null };
type Progress = { total: number; done: number; skipped: number; errors: number; note?: string | undefined; running: boolean };

const KINDS: [Kind, string][] = [["all", "Todos"], ["movie", "Filmes"], ["series", "Séries"], ["channel", "Canais"]];
const STATUSES: [Status, string][] = [["all", "Todos"], ["imported", "Importados"], ["not_imported", "Não importados"], ["error", "Com erro"], ["missing", "Indisponíveis"]];
const KIND_LABEL: Record<string, string> = { movie: "Filme", series: "Série", channel: "Canal" };
const PAGE = 50;
const n = (x: number) => x.toLocaleString("pt-BR");

export function M3uExplorer({ list, onClose }: { list: { id: string; name: string }; onClose: () => void }) {
  const qc = useQueryClient();
  const explore = useServerFn(exploreM3u), loadGroups = useServerFn(m3uGroups), pick = useServerFn(pickM3uItems), imp = useServerFn(importM3uItems);
  const [kind, setKind] = useState<Kind>("all");
  const [status, setStatus] = useState<Status>("all");
  const [group, setGroup] = useState<string>("");
  const [text, setText] = useState(""); const [q, setQ] = useState("");
  const [page, setPage] = useState(1);
  const [sel, setSel] = useState<Set<number>>(new Set());
  const [lot, setLot] = useState<50 | 100 | 250 | 500>(100);
  const [prog, setProg] = useState<Progress | null>(null);
  const stop = useRef(false);

  useEffect(() => { const t = setTimeout(() => { setQ(text.trim()); setPage(1); }, 350); return () => clearTimeout(t); }, [text]);
  const f = { listId: list.id, kind, status, group: group || null, q };
  const items = useQuery({ queryKey: ["admin", "m3u-explore", f, page], queryFn: () => explore({ data: { ...f, page, pageSize: PAGE } }), placeholderData: keepPreviousData });
  const groups = useQuery({ queryKey: ["admin", "m3u-groups", list.id, kind], queryFn: () => loadGroups({ data: { listId: list.id, kind } }), staleTime: 60_000 });
  const total = items.data?.total ?? 0, pages = Math.max(1, Math.ceil(total / PAGE));
  const rows = (items.data?.items ?? []) as Row[];
  const running = !!prog?.running;

  function reset<T>(set: (v: T) => void) { return (v: T) => { set(v); setPage(1); setSel(new Set()); }; }

  async function runImport(ids: number[]) {
    if (!ids.length) return;
    stop.current = false;
    const jobStart = new Date().toISOString(), batchId = crypto.randomUUID().slice(0, 8);
    const p: Progress = { total: ids.length, done: 0, skipped: 0, errors: 0, running: true };
    setProg({ ...p });
    const queue = [...ids];
    // Limited concurrency: a few requests at once, each on different items (never the same series twice).
    const worker = async () => {
      while (queue.length && !stop.current) {
        const chunk = queue.splice(0, 5);
        try {
          const res = await imp({ data: { listId: list.id, ids: chunk, jobStart, batchId } });
          p.note = undefined;
          for (const r of res) {
            if (r.episodeErrors) p.errors += r.episodeErrors;
            if (r.status === "partial") { queue.unshift(r.id); p.note = `Importando episódios… faltam ${n(r.remaining ?? 0)}`; }
            else if (r.status === "pending") queue.unshift(r.id);
            else if (r.status === "done") p.done++;
            else if (r.status === "skipped") p.skipped++;
            else p.errors++;
          }
        } catch (e) { p.errors += chunk.length; p.note = errMsg(e); }
        setProg({ ...p });
      }
    };
    await Promise.all(Array.from({ length: IMPORT_CONCURRENCY }, worker));
    p.running = false; setProg({ ...p }); setSel(new Set());
    qc.invalidateQueries({ queryKey: ["admin", "m3u-explore"] });
    toast[p.errors ? "warning" : "success"](stop.current ? "Importação interrompida." : `Importação concluída: ${p.done} importados, ${p.skipped} ignorados, ${p.errors} erros.`);
  }

  async function importLot() {
    try {
      const ids = await pick({ data: { ...f, limit: lot } });
      if (!ids.length) { toast.info("Nenhum conteúdo não importado com esses filtros."); return; }
      if (!confirm(`Importar ${ids.length} conteúdo(s) com os filtros atuais? A importação acontece em pequenos lotes.`)) return;
      await runImport(ids);
    } catch (e) { toast.error(errMsg(e)); }
  }

  const toggle = (id: number) => setSel(s => { const x = new Set(s); if (x.has(id)) x.delete(id); else x.add(id); return x; });
  const allOnPage = rows.length > 0 && rows.every(r => sel.has(r.id));
  const from = total ? (page - 1) * PAGE + 1 : 0, to = Math.min(page * PAGE, total);
  const nums = Array.from(new Set([1, page - 1, page, page + 1, pages].filter(x => x >= 1 && x <= pages))).sort((a, b) => a - b);

  return (
    <Dialog open onOpenChange={o => !o && !running && onClose()}>
      <DialogContent className="m3u-explorer box-border max-h-[calc(100dvh-24px)] w-[calc(100vw-24px)] min-w-0 max-w-[calc(100vw-24px)] overflow-hidden rounded-lg p-0 [overflow-wrap:anywhere] sm:max-h-[calc(100dvh-32px)] sm:w-[calc(100vw-32px)] sm:max-w-5xl">
        <div className="flex max-h-[calc(100dvh-24px)] min-w-0 flex-col sm:max-h-[calc(100dvh-32px)]">
          <DialogHeader className="shrink-0 border-b border-border p-4 pr-12 text-left"><DialogTitle className="min-w-0 leading-snug">Explorar conteúdo da M3U — {list.name}</DialogTitle></DialogHeader>
          <div className="min-h-0 min-w-0 flex-1 overflow-y-auto overscroll-contain">
          <div className="min-w-0 space-y-3 border-b border-border p-3 sm:p-4">
            <div className="relative"><Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
              <Input className="min-w-0 max-w-full pl-9" placeholder="Pesquisar conteúdo" value={text} onChange={e => setText(e.target.value)} aria-label="Pesquisar conteúdo" /></div>
            <div className="grid grid-cols-2 gap-2 sm:flex sm:flex-wrap">{KINDS.map(([k, l]) => <Button key={k} size="sm" variant={kind === k ? "default" : "outline"} className="h-9 min-w-0 rounded-full" onClick={() => { reset(setKind)(k); setGroup(""); }}>{l}</Button>)}</div>
            <div className="grid min-w-0 grid-cols-1 items-center gap-2 sm:grid-cols-2 lg:flex lg:flex-wrap">
              <select aria-label="Status" className="h-9 w-full min-w-0 max-w-full rounded-md border border-input bg-background px-2 text-sm lg:w-auto" value={status} onChange={e => reset(setStatus)(e.target.value as Status)}>
                {STATUSES.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select>
              <select aria-label="Grupo" className="h-9 w-full min-w-0 max-w-full rounded-md border border-input bg-background px-2 text-sm lg:w-auto lg:max-w-[16rem]" value={group} onChange={e => reset(setGroup)(e.target.value)}>
                <option value="">Todos os grupos</option>
                {(groups.data ?? []).map(g => <option key={g.group_title} value={g.group_title}>{g.group_title} ({n(Number(g.n))})</option>)}</select>
              <div className="grid min-w-0 grid-cols-1 gap-2 sm:col-span-2 sm:grid-cols-2 lg:ml-auto lg:flex lg:flex-wrap [&>button]:h-9 [&>button]:min-w-0 [&>button]:max-w-full [&>button]:whitespace-normal [&>button]:leading-tight">
                <select aria-label="Tamanho do lote" className="sm:col-span-2 h-9 w-full min-w-0 max-w-full rounded-md border border-input bg-background px-2 text-sm lg:w-auto" value={lot} onChange={e => setLot(Number(e.target.value) as typeof lot)} disabled={running}>
                  {[50, 100, 250, 500].map(x => <option key={x} value={x}>{x} por operação</option>)}</select>
                <Button size="sm" variant="outline" disabled={running} onClick={importLot}><Download /> Importar por lote</Button>
                <Button size="sm" disabled={running || !sel.size} onClick={() => runImport([...sel])}><Download /> Importar selecionados ({sel.size})</Button>
              </div>
            </div>
            {prog && (
              <div className="min-w-0 rounded-xl border border-primary/40 bg-primary/5 p-3 text-sm">
                <div className="grid min-w-0 grid-cols-[minmax(0,1fr)_auto] items-center gap-2">
                  <div className="flex min-w-0 items-center gap-2">{prog.running && <Loader2 className="size-4 animate-spin text-primary" />}
                  <b className="min-w-0">{prog.running ? "Importando…" : "Importação finalizada"}</b></div>
                  <span className="col-start-1 min-w-0">{n(prog.done + prog.skipped)} / {n(prog.total)}</span>
                  {prog.running && <Button size="sm" variant="ghost" className="col-start-2 row-span-2 row-start-1" onClick={() => { stop.current = true; }}><Square /> Parar</Button>}
                </div>
                <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-muted"><div className="h-full bg-primary transition-all" style={{ width: `${prog.total ? ((prog.done + prog.skipped) / prog.total) * 100 : 0}%` }} /></div>
                <p className="mt-1 text-xs text-muted-foreground">Concluídos: {prog.done} · Ignorados: {prog.skipped} · Erros: {prog.errors}{prog.note ? ` · ${prog.note}` : ""}</p>
              </div>
            )}
          </div>
          <div className="min-w-0">
            <div className="flex min-w-0 items-center gap-2 border-b border-border px-4 py-2 text-xs text-muted-foreground">
              <input type="checkbox" className="size-4 shrink-0 accent-primary" aria-label="Selecionar página" checked={allOnPage} onChange={() => setSel(s => { const x = new Set(s); rows.forEach(r => allOnPage ? x.delete(r.id) : x.add(r.id)); return x; })} />
              <span>{total ? `${n(from)}–${n(to)} de ${n(total)}` : items.isFetching ? "Carregando…" : "Nenhum conteúdo encontrado"}</span>
              {items.isFetching && <Loader2 className="size-3 animate-spin" />}
            </div>
            {items.isError && <p className="p-4 text-sm text-destructive">{errMsg(items.error)}</p>}
            {rows.map(r => (
              <div key={r.id} className="grid min-w-0 grid-cols-[auto_auto_minmax(0,1fr)] items-center gap-2 border-b border-border/60 px-3 py-3 sm:grid-cols-[auto_auto_minmax(0,1fr)_auto] sm:gap-3 sm:px-4">
                <input type="checkbox" className="size-4 shrink-0 accent-primary" aria-label={`Selecionar ${r.title}`} checked={sel.has(r.id)} onChange={() => toggle(r.id)} />
                <div className="size-12 shrink-0 overflow-hidden rounded-lg bg-muted">{r.logo && <img src={r.logo} alt="" loading="lazy" referrerPolicy="no-referrer" className="size-full object-cover" onError={e => { e.currentTarget.style.display = "none"; }} />}</div>
                <div className="min-w-0 flex-1">
                  <p className="font-medium leading-snug sm:truncate">{r.title}</p>
                  <p className="truncate text-xs text-muted-foreground">{KIND_LABEL[r.kind] ?? r.kind}{r.year ? ` · Ano: ${r.year}` : ""}{r.kind === "series" && r.episode_count ? ` · ${n(r.episode_count)} episódios` : ""}{r.group_title ? ` · ${r.group_title}` : ""} · Fonte: {list.name}</p>
                  {r.import_error && <p className="truncate text-xs text-destructive">Erro: {r.import_error}</p>}
                </div>
                <div className="col-span-2 col-start-2 flex min-w-0 flex-wrap items-center gap-2 sm:col-span-1 sm:col-start-4 sm:max-w-[17rem] sm:justify-end [&>span]:max-w-full [&>span]:whitespace-normal [&>button]:h-9 [&>button]:min-w-0 [&>button]:max-w-full [&>button]:whitespace-normal">
                  {r.missing && <Badge variant="outline">Indisponível na última sincronização</Badge>}
                  {r.content_id ? <Badge>✓ Importado</Badge> : r.import_error ? <Badge variant="destructive">Erro</Badge> : <Badge variant="secondary">Não importado</Badge>}
                  <Button size="sm" variant={r.content_id ? "ghost" : "outline"} disabled={running} onClick={() => runImport([r.id])}>
                    {r.import_error && !r.content_id ? <><RotateCcw /> Tentar novamente</> : r.content_id ? (r.kind === "series" ? "Completar episódios" : "Atualizar fonte") : "Importar"}
                  </Button>
                </div>
              </div>
            ))}
          </div>
          </div>
          <div className="flex shrink-0 flex-wrap items-center justify-center gap-1 border-t border-border p-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
            <Button size="sm" variant="outline" disabled={page <= 1} onClick={() => setPage(p => p - 1)}>Anterior</Button>
            {nums.map((x, i) => <span key={x} className="flex items-center gap-1">{i > 0 && x - (nums[i - 1] ?? x) > 1 && <span className="px-1 text-muted-foreground">…</span>}
              <Button size="sm" variant={x === page ? "default" : "ghost"} onClick={() => setPage(x)}>{x}</Button></span>)}
            <Button size="sm" variant="outline" disabled={page >= pages} onClick={() => setPage(p => p + 1)}>Próxima</Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
