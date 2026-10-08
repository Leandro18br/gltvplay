import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { ListVideo, Loader2, Pencil, Plus, RefreshCw, Trash2, Wifi } from "lucide-react";
import { db, errMsg } from "@/lib/admin/db";
import { saveM3uList, testM3uList, startM3uSync, processM3uChunk } from "@/lib/integrations/m3u.functions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { fmtDate } from "./shared";

type List = { id: string; name: string; list_type: string; detected_type: string | null; url_hint: string | null; is_active: boolean; enrich_tmdb: boolean; sync_state: string; last_synced_at: string | null; last_error: string | null; movies_count: number; series_count: number; episodes_count: number; channels_count: number; total_items: number; processed_items: number; last_report: Record<string, number> };
const STATE: Record<string, string> = { idle: "Nunca sincronizada", connecting: "Conectando", reading: "Lendo lista", processing: "Importando / atualizando", done: "Finalizado", error: "Erro" };

export function M3uListsCard() {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ["admin", "m3u"], queryFn: async () => { const r = await db.from("m3u_lists").select("*").order("created_at"); if (r.error) throw r.error; return r.data as List[]; } });
  const test = useServerFn(testM3uList), start = useServerFn(startM3uSync), chunk = useServerFn(processM3uChunk);
  const [edit, setEdit] = useState<List | "new" | null>(null);
  const [busy, setBusy] = useState<Record<string, string>>({});
  const [result, setResult] = useState<Record<string, string>>({});
  const refresh = () => qc.invalidateQueries({ queryKey: ["admin", "m3u"] });
  const setB = (id: string, s?: string) => setBusy(b => { const n = { ...b }; if (s) n[id] = s; else delete n[id]; return n; });

  async function runTest(l: List) {
    setB(l.id, "Conectando…");
    const r = await test({ data: { listId: l.id } });
    setB(l.id);
    if (!r.ok) { setResult(x => ({ ...x, [l.id]: `Erro: ${"error" in r ? r.error : ""}` })); return; }
    setResult(x => ({ ...x, [l.id]: `${r.type} válida · ${r.approximate ? "aprox. " : ""}${r.total} itens — Filmes: ${r.movies} · Séries: ${r.series} (${r.episodes} episódios) · Canais: ${r.channels}` }));
    refresh();
  }
  async function runSync(l: List) {
    setB(l.id, "Conectando…");
    try {
      if (l.sync_state !== "processing") {
        setB(l.id, "Lendo lista…");
        const s = await start({ data: { listId: l.id } });
        if (!s.ok) throw new Error(s.error);
      }
      refresh();
      for (;;) {
        const r = await chunk({ data: { listId: l.id } });
        setB(l.id, `Importando ${r.processed}/${r.total}…`);
        if (r.done) { const p = r.report as Record<string, number>; setResult(x => ({ ...x, [l.id]: report(p) })); toast.success("Sincronização concluída."); break; }
      }
    } catch (e) { toast.error(errMsg(e)); setResult(x => ({ ...x, [l.id]: `Erro: ${errMsg(e)}` })); }
    finally { setB(l.id); refresh(); }
  }
  async function remove(l: List) {
    if (!confirm(`Excluir a lista "${l.name}"? Os filmes, séries, canais e fontes já importados continuam no sistema.`)) return;
    const r = await db.from("m3u_lists").delete().eq("id", l.id);
    if (r.error) toast.error(errMsg(r.error)); else { toast.success("Lista excluída"); refresh(); }
  }

  return (
    <div className="space-y-3 rounded-2xl border border-border bg-card p-4">
      <div className="flex flex-wrap items-center gap-2"><ListVideo className="size-5 text-primary" /><h2 className="font-semibold">Listas M3U</h2><Badge variant="secondary">Conteúdo e fontes</Badge>
        <Button size="sm" className="ml-auto rounded-full" onClick={() => setEdit("new")}><Plus /> Adicionar lista</Button></div>
      <p className="text-xs text-muted-foreground">Importa filmes, séries/episódios e canais com a fonte de cada um. Use apenas listas que você tem autorização para usar.</p>
      {q.isPending && <Loader2 className="animate-spin text-primary" />}
      {q.data?.length === 0 && <p className="rounded-xl border border-dashed border-border p-4 text-center text-sm text-muted-foreground">Nenhuma lista cadastrada.</p>}
      {q.data?.map(l => (
        <div key={l.id} className="rounded-xl border border-border p-3">
          <div className="flex flex-wrap items-start gap-3">
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2"><b>{l.name}</b>
                <Badge variant={l.is_active ? "default" : "outline"}>{l.is_active ? "Ativa" : "Inativa"}</Badge>
                <Badge variant="outline">{l.detected_type === "m3u_plus" ? "M3U Plus" : l.detected_type === "m3u" ? "M3U" : l.list_type === "m3u_plus" ? "M3U Plus" : l.list_type === "m3u" ? "M3U" : "Automático"}</Badge>
                <Badge variant="secondary">{STATE[l.sync_state] ?? l.sync_state}</Badge></div>
              <p className="mt-1 font-mono text-xs text-muted-foreground">{l.url_hint}</p>
              <p className="mt-1 text-xs text-muted-foreground">Última sincronização: {fmtDate(l.last_synced_at)} · Filmes {l.movies_count} · Séries {l.series_count} · Episódios {l.episodes_count} · Canais {l.channels_count}</p>
              {l.sync_state === "processing" && !busy[l.id] && <p className="mt-1 text-xs text-primary">Sincronização pausada em {l.processed_items}/{l.total_items}. Clique em "Sincronizar agora" para continuar.</p>}
              {l.last_error && l.sync_state === "error" && <p className="mt-1 text-xs text-destructive">{l.last_error}</p>}
              {busy[l.id] && <p className="mt-1 flex items-center gap-1 text-xs text-primary"><Loader2 className="size-3 animate-spin" />{busy[l.id]}</p>}
              {(result[l.id] || (l.sync_state === "done" && l.last_report)) && <p className="mt-1 whitespace-pre-line text-xs">{result[l.id] ?? report(l.last_report)}</p>}
            </div>
            <div className="flex flex-wrap gap-1">
              <Button size="sm" variant="outline" disabled={!!busy[l.id]} onClick={() => runTest(l)}><Wifi /> Testar conexão</Button>
              <Button size="sm" variant="outline" disabled={!!busy[l.id] || !l.is_active} onClick={() => runSync(l)}><RefreshCw /> Sincronizar agora</Button>
              <Button size="icon" variant="ghost" aria-label="Editar" onClick={() => setEdit(l)}><Pencil /></Button>
              <Button size="icon" variant="ghost" aria-label="Excluir" disabled={!!busy[l.id]} onClick={() => remove(l)}><Trash2 /></Button>
            </div>
          </div>
        </div>
      ))}
      {edit && <ListDialog row={edit === "new" ? null : edit} onClose={() => setEdit(null)} onSaved={refresh} />}
    </div>
  );
}

function report(p: Record<string, number>) {
  const n = (k: string) => p?.[k] ?? 0;
  return `Sincronização concluída.\nNovos filmes: ${n("movies_new")} · Atualizados: ${n("movies_updated")}\nNovas séries: ${n("series_new")} · Novos episódios: ${n("episodes_new")} · Atualizados: ${n("episodes_updated")}\nNovos canais: ${n("channels_new")} · Atualizados: ${n("channels_updated")}\nIgnorados: ${n("ignored")} · Erros: ${n("errors")}`;
}

function ListDialog({ row, onClose, onSaved }: { row: List | null; onClose: () => void; onSaved: () => void }) {
  const save = useServerFn(saveM3uList);
  const [v, setV] = useState({ name: row?.name ?? "", url: "", list_type: (row?.list_type ?? "auto") as "auto" | "m3u" | "m3u_plus", is_active: row?.is_active ?? true, enrich_tmdb: row?.enrich_tmdb ?? true });
  const [saving, setSaving] = useState(false);
  async function submit() {
    setSaving(true);
    try { await save({ data: { id: row?.id, name: v.name, url: v.url.trim() || undefined, list_type: v.list_type, is_active: v.is_active, enrich_tmdb: v.enrich_tmdb } }); toast.success("Lista salva"); onSaved(); onClose(); }
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
          <div className="space-y-1.5"><Label>Tipo</Label>
            <select className="h-9 w-full rounded-md border border-input bg-background px-2 text-sm" value={v.list_type} onChange={e => setV({ ...v, list_type: e.target.value as typeof v.list_type })}>
              <option value="auto">Detectar automaticamente</option><option value="m3u">M3U</option><option value="m3u_plus">M3U Plus</option></select></div>
          <label className="flex items-center gap-2 text-sm"><Switch checked={v.is_active} onCheckedChange={x => setV({ ...v, is_active: x })} /> Ativa</label>
          <label className="flex items-center gap-2 text-sm"><Switch checked={v.enrich_tmdb} onCheckedChange={x => setV({ ...v, enrich_tmdb: x })} /> Completar filmes e séries novos com dados do TMDB</label>
        </div>
        <DialogFooter><Button variant="ghost" onClick={onClose}>Cancelar</Button><Button disabled={saving || !v.name.trim() || (!row && !v.url.trim())} onClick={submit}>{saving && <Loader2 className="animate-spin" />}Salvar</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
