import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { Download, ListVideo, Loader2, Pencil, Plus, RefreshCw, Search, Trash2, Wifi } from "lucide-react";
import { db, errMsg } from "@/lib/admin/db";
import { saveM3uList, testM3uList, indexM3uStep } from "@/lib/integrations/m3u.functions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { M3uExplorer } from "./M3uExplorer";
import { fmtDate } from "./shared";

type List = { id: string; name: string; list_type: string; detected_type: string | null; url_hint: string | null; is_active: boolean; enrich_tmdb: boolean; sync_state: string; last_synced_at: string | null; last_error: string | null; movies_count: number; series_count: number; episodes_count: number; channels_count: number; total_items: number; index_entries: number; index_offset: number; index_total_bytes: number | null; index_flags: { running?: boolean } | null; index_batch_size: number };
const STATE: Record<string, string> = { idle: "Não indexada", indexing: "Indexando", indexed: "Catálogo indexado", error: "Erro", done: "Catálogo indexado" };
const n = (x: number) => Number(x ?? 0).toLocaleString("pt-BR");

export function M3uListsCard() {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ["admin", "m3u"], queryFn: async () => { const r = await db.from("m3u_lists").select("*").order("created_at"); if (r.error) throw r.error; return r.data as unknown as List[]; } });
  const test = useServerFn(testM3uList), step = useServerFn(indexM3uStep);
  const [edit, setEdit] = useState<List | "new" | null>(null);
  const [explore, setExplore] = useState<List | null>(null);
  const [busy, setBusy] = useState<Record<string, string>>({});
  const [result, setResult] = useState<Record<string, string>>({});
  const refresh = () => qc.invalidateQueries({ queryKey: ["admin", "m3u"] });
  const setB = (id: string, s?: string) => setBusy(b => { const x = { ...b }; if (s) x[id] = s; else delete x[id]; return x; });

  async function runTest(l: List) {
    setB(l.id, "Conectando…");
    const r = await test({ data: { listId: l.id } });
    setB(l.id);
    if (!r.ok) { setResult(x => ({ ...x, [l.id]: `Erro: ${"error" in r ? r.error : ""}` })); return; }
    setResult(x => ({ ...x, [l.id]: `✓ Lista conectada — ${r.type} · ${r.approximate ? "amostra de " : ""}${n(r.total)} itens — Filmes: ${n(r.movies)} · Séries: ${n(r.series)} (${n(r.episodes)} episódios) · Canais: ${n(r.channels)}` }));
    refresh();
  }

  /** Indexing runs as many short server steps; progress is checkpointed so it can resume. */
  async function runIndex(l: List, restart: boolean) {
    setB(l.id, "Conectando…");
    setResult(x => { const y = { ...x }; delete y[l.id]; return y; });
    try {
      let first = true;
      for (;;) {
        const r = await step({ data: { listId: l.id, restart: restart && first } });
        first = false;
        if (!r.ok) throw new Error(r.error);
        const pct = r.total ? ` (${Math.min(99, Math.floor(((r.offset ?? 0) / r.total) * 100))}%)` : "";
        setB(l.id, r.phase === "finalize" ? `Finalizando… ${n(("checked" in r ? r.checked : 0) ?? 0)} itens conferidos` : `Indexando… ${n(r.entries)} itens lidos${pct}`);
        if (r.done) { toast.success("Catálogo M3U indexado. Agora é só explorar e importar."); break; }
        refresh();
      }
    } catch (e) { toast.error(errMsg(e)); setResult(x => ({ ...x, [l.id]: `Erro: ${errMsg(e)} — o progresso foi salvo; clique em "Continuar indexação".` })); }
    finally { setB(l.id); refresh(); }
  }

  async function remove(l: List) {
    if (!confirm(`Excluir a lista "${l.name}"? Os filmes, séries, canais e fontes já importados continuam no sistema.`)) return;
    const r = await db.from("m3u_lists").delete().eq("id", l.id);
    if (r.error) toast.error(errMsg(r.error)); else { toast.success("Lista excluída"); refresh(); }
  }

  return (
    <div className="space-y-3 rounded-2xl border border-border bg-card p-4">
      <div className="flex flex-wrap items-center gap-2"><ListVideo className="size-5 text-primary" /><h2 className="font-semibold">Listas M3U</h2><Badge variant="secondary">Catálogo e fontes</Badge>
        <Button size="sm" className="ml-auto rounded-full" onClick={() => setEdit("new")}><Plus /> Adicionar lista</Button></div>
      <p className="text-xs text-muted-foreground">A sincronização só indexa a lista (nada aparece no site). Depois, explore e importe o que quiser — o conteúdo importado entra publicado com a fonte da lista. Use apenas listas que você tem autorização para usar.</p>
      {q.isPending && <Loader2 className="animate-spin text-primary" />}
      {q.data?.length === 0 && <p className="rounded-xl border border-dashed border-border p-4 text-center text-sm text-muted-foreground">Nenhuma lista cadastrada.</p>}
      {q.data?.map(l => {
        const resumable = !!l.index_flags?.running;
        const indexed = l.sync_state === "indexed" || (!!l.last_synced_at && l.sync_state !== "indexing");
        return (
          <div key={l.id} className="rounded-xl border border-border p-3">
            <div className="flex flex-col gap-3">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2"><b>{l.name}</b>
                  <Badge variant={l.is_active ? "default" : "outline"}>{l.is_active ? "Ativa" : "Inativa"}</Badge>
                  <Badge variant="outline">{l.detected_type === "m3u_plus" ? "M3U Plus" : l.detected_type === "m3u" ? "M3U" : l.list_type === "m3u_plus" ? "M3U Plus" : l.list_type === "m3u" ? "M3U" : "Automático"}</Badge>
                  <Badge variant="secondary">{STATE[l.sync_state] ?? l.sync_state}</Badge></div>
                <p className="mt-1 font-mono text-xs text-muted-foreground">{l.url_hint}</p>
                <div className="mt-2 grid max-w-2xl grid-cols-2 gap-2 sm:grid-cols-4">
                  {[["Conteúdos", l.total_items], ["Filmes", l.movies_count], ["Séries", l.series_count], ["Canais", l.channels_count]].map(([k, v]) => (
                    <div key={k as string} className="rounded-lg bg-muted/40 px-2 py-1.5"><p className="text-[11px] text-muted-foreground">{k}</p><p className="font-semibold">{n(v as number)}</p></div>))}
                </div>
                <p className="mt-2 text-xs text-muted-foreground">Última sincronização: {fmtDate(l.last_synced_at)}{l.episodes_count ? ` · ${n(l.episodes_count)} episódios` : ""}</p>
                {indexed && !resumable && <p className="mt-1 text-xs text-primary">{l.detected_type && "✓ Lista conectada · "}✓ Catálogo indexado · ✓ Pronto para importação</p>}
                {resumable && !busy[l.id] && <p className="mt-1 text-xs text-primary">Indexação pausada em {n(l.index_entries)} itens. Clique em "Continuar indexação" — ela continua de onde parou.</p>}
                {l.last_error && l.sync_state === "error" && !busy[l.id] && <p className="mt-1 text-xs text-destructive">{l.last_error}</p>}
                {busy[l.id] && <p className="mt-1 flex items-center gap-1 text-xs text-primary"><Loader2 className="size-3 animate-spin" />{busy[l.id]}</p>}
                {result[l.id] && <p className="mt-1 whitespace-pre-line text-xs">{result[l.id]}</p>}
              </div>
              <div className="flex flex-wrap gap-1">
                <Button size="sm" variant="outline" disabled={!!busy[l.id]} onClick={() => runTest(l)}><Wifi /> Testar conexão</Button>
                {resumable && <Button size="sm" disabled={!!busy[l.id] || !l.is_active} onClick={() => runIndex(l, false)}><RefreshCw /> Continuar indexação</Button>}
                <Button size="sm" variant="outline" disabled={!!busy[l.id] || !l.is_active} onClick={() => (!resumable || confirm("Recomeçar a indexação do início?")) && runIndex(l, true)}><RefreshCw /> Sincronizar</Button>
                <Button size="sm" variant="outline" disabled={!indexed && !resumable} onClick={() => setExplore(l)}><Search /> Explorar conteúdo</Button>
                <Button size="sm" variant="outline" disabled={!indexed && !resumable} onClick={() => setExplore(l)}><Download /> Importar selecionados</Button>
                <Button size="icon" variant="ghost" aria-label="Editar" onClick={() => setEdit(l)}><Pencil /></Button>
                <Button size="icon" variant="ghost" aria-label="Excluir" disabled={!!busy[l.id]} onClick={() => remove(l)}><Trash2 /></Button>
              </div>
            </div>
          </div>
        );
      })}
      {edit && <ListDialog row={edit === "new" ? null : edit} onClose={() => setEdit(null)} onSaved={refresh} />}
      {explore && <M3uExplorer list={explore} onClose={() => setExplore(null)} />}
    </div>
  );
}

function ListDialog({ row, onClose, onSaved }: { row: List | null; onClose: () => void; onSaved: () => void }) {
  const save = useServerFn(saveM3uList);
  const [v, setV] = useState({ name: row?.name ?? "", url: "", list_type: (row?.list_type ?? "auto") as "auto" | "m3u" | "m3u_plus", is_active: row?.is_active ?? true, enrich_tmdb: row?.enrich_tmdb ?? true, index_batch_size: (row?.index_batch_size ?? 500) as 100 | 250 | 500 | 1000 });
  const [saving, setSaving] = useState(false);
  async function submit() {
    setSaving(true);
    try { await save({ data: { id: row?.id, name: v.name, url: v.url.trim() || undefined, list_type: v.list_type, is_active: v.is_active, enrich_tmdb: v.enrich_tmdb, index_batch_size: v.index_batch_size } }); toast.success("Lista salva"); onSaved(); onClose(); }
    catch (e) { toast.error(errMsg(e)); } finally { setSaving(false); }
  }
  return (
    <Dialog open onOpenChange={o => !o && onClose()}>
      <DialogContent>
        <DialogHeader><DialogTitle>{row ? "Editar lista M3U" : "Adicionar lista M3U"}</DialogTitle></DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1.5"><Label>Nome da lista</Label><Input value={v.name} maxLength={80} onChange={e => setV({ ...v, name: e.target.value })} /></div>
          <div className="space-y-1.5"><Label>URL da lista M3U</Label><Input type="password" autoComplete="off" value={v.url} placeholder={row ? `${row.url_hint ?? ""} (deixe vazio para manter)` : "http://servidor/get.php?username=…&password=…&type=m3u_plus"} onChange={e => setV({ ...v, url: e.target.value })} />
            <p className="text-xs text-muted-foreground">A URL completa fica guardada só no servidor e não é mostrada de novo.</p></div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5"><Label>Tipo</Label>
              <select className="h-9 w-full rounded-md border border-input bg-background px-2 text-sm" value={v.list_type} onChange={e => setV({ ...v, list_type: e.target.value as typeof v.list_type })}>
                <option value="auto">Detectar automaticamente</option><option value="m3u">M3U</option><option value="m3u_plus">M3U Plus</option></select></div>
            <div className="space-y-1.5"><Label>Lote de indexação</Label>
              <select className="h-9 w-full rounded-md border border-input bg-background px-2 text-sm" value={v.index_batch_size} onChange={e => setV({ ...v, index_batch_size: Number(e.target.value) as typeof v.index_batch_size })}>
                {[100, 250, 500, 1000].map(x => <option key={x} value={x}>{x} itens por lote</option>)}</select></div>
          </div>
          <label className="flex items-center gap-2 text-sm"><Switch checked={v.is_active} onCheckedChange={x => setV({ ...v, is_active: x })} /> Ativa</label>
          <label className="flex items-center gap-2 text-sm"><Switch checked={v.enrich_tmdb} onCheckedChange={x => setV({ ...v, enrich_tmdb: x })} /> Ao importar, completar filmes e séries novos com dados do TMDB (somente correspondências exatas)</label>
        </div>
        <DialogFooter><Button variant="ghost" onClick={onClose}>Cancelar</Button><Button disabled={saving || !v.name.trim() || (!row && !v.url.trim())} onClick={submit}>{saving && <Loader2 className="animate-spin" />}Salvar</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
