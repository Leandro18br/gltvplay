import { useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { Check, DownloadCloud, ListVideo, Loader2, Search } from "lucide-react";
import { errMsg } from "@/lib/admin/db";
import { bugouImportSeries, bugouSearchSeries, bugouSeriesDetails, bugouImportEpisodes } from "@/lib/integrations/bugoumods.functions";
import type { BugouSeries, BugouDetails } from "@/lib/integrations/bugoumods";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";

export function BugouSeriesButton() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button size="sm" variant="outline" className="rounded-full" onClick={() => setOpen(true)}><Search /> Buscar séries no BugouMods</Button>
      {open && <BugouDialog onClose={() => setOpen(false)} />}
    </>
  );
}

function BugouDialog({ onClose }: { onClose: () => void }) {
  const qc = useQueryClient();
  const search = useServerFn(bugouSearchSeries); const doImport = useServerFn(bugouImportSeries);
  const [q, setQ] = useState(""); const [cat, setCat] = useState("");
  const [cats, setCats] = useState<string[]>([]); const [total, setTotal] = useState<number | null>(null);
  const [items, setItems] = useState<BugouSeries[]>([]); const [existing, setExisting] = useState<Record<string, string>>({});
  const [sel, setSel] = useState<Set<string>>(new Set()); const [busy, setBusy] = useState<"search" | "import" | null>(null);
  const [detailId, setDetailId] = useState<string | null>(null);
  if (detailId) return <EpisodesDialog id={detailId} onBack={() => setDetailId(null)} onClose={onClose} />;

  async function run(e?: React.FormEvent) {
    e?.preventDefault(); setBusy("search");
    try {
      const r = await search({ data: { query: q, category: cat } });
      setItems(r.results); setExisting(r.existing); setCats(r.categories); setTotal(r.total); setSel(new Set());
      if (!r.results.length) toast.message("Nenhuma série encontrada.");
    } catch (x) { toast.error(errMsg(x)); } finally { setBusy(null); }
  }
  async function importSel() {
    setBusy("import");
    try {
      const r = await doImport({ data: { ids: [...sel] } });
      toast.success(`${r.created} série(s) importada(s)${r.skipped ? `, ${r.skipped} já existiam` : ""}.`);
      setExisting(s => { const x = { ...s }; sel.forEach(id => { x[id] = x[id] ?? "new"; }); return x; });
      setSel(new Set()); qc.invalidateQueries({ queryKey: ["admin"] });
    } catch (x) { toast.error(errMsg(x)); } finally { setBusy(null); }
  }

  return (
    <Dialog open onOpenChange={o => !o && onClose()}>
      <DialogContent className="max-h-[90vh] max-w-4xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Buscar séries no BugouMods</DialogTitle>
          <DialogDescription>"Importar" traz só nome, ano e capa. Use "Episódios" para ver temporadas, episódios e players e importá-los. Dados existentes não são alterados.</DialogDescription>
        </DialogHeader>
        <form onSubmit={run} className="flex flex-wrap gap-2">
          <Input className="min-w-0 flex-1" placeholder="Título (vazio = todas)" value={q} onChange={e => setQ(e.target.value)} />
          {cats.length > 0 && (
            <select aria-label="Categoria" className="h-10 rounded-md border border-input bg-background px-2 text-sm" value={cat} onChange={e => setCat(e.target.value)}>
              <option value="">Todas as categorias</option>
              {cats.map(c => <option key={c} value={c}>{c}</option>)}
            </select>
          )}
          <Button disabled={!!busy}>{busy === "search" ? <Loader2 className="animate-spin" /> : <Search />} Buscar</Button>
          <Button type="button" disabled={!sel.size || !!busy} onClick={importSel}>{busy === "import" ? <Loader2 className="animate-spin" /> : <DownloadCloud />} Importar {sel.size || ""}</Button>
        </form>
        {total != null && <p className="text-xs text-muted-foreground">{total} séries na lista do provedor · mostrando até 60 resultados</p>}
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4">
          {items.map(r => { const has = !!existing[r.id]; const on = sel.has(r.id); return (
            <button key={r.id} type="button" onClick={() => !has && setSel(s => { const x = new Set(s); if (x.has(r.id)) x.delete(r.id); else if (x.size < 50) x.add(r.id); return x; })}
              className={`relative overflow-hidden rounded-xl border text-left transition disabled:opacity-60 ${on ? "border-primary shadow-glow" : "border-border"}`}>
              <div className="aspect-[2/3] bg-muted">{r.poster_url && <img src={r.poster_url} alt="" loading="lazy" className="h-full w-full object-cover" />}</div>
              <div className="p-2"><p className="truncate text-sm font-medium">{r.title}</p><p className="truncate text-xs text-muted-foreground">{r.year ?? "—"} · {r.category}</p></div>
              {has && <Badge variant="secondary" className="absolute left-2 top-2">Já existe</Badge>}
              {<span role="button" tabIndex={0} onClick={ev => { ev.stopPropagation(); setDetailId(r.id); }} onKeyDown={ev => { if (ev.key === "Enter") { ev.stopPropagation(); setDetailId(r.id); } }} className="absolute bottom-14 right-2 inline-flex items-center gap-1 rounded-full bg-background/90 px-2 py-1 text-xs font-medium ring-1 ring-border"><ListVideo className="h-3 w-3" /> Episódios</span>}
              {on && <span className="absolute right-2 top-2 rounded-full bg-primary p-1 text-primary-foreground"><Check className="h-3 w-3" /></span>}
            </button>); })}
        </div>
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
  const yes = (b: boolean) => (b ? "Disponível" : "Não fornecido");
  return (
    <Dialog open onOpenChange={o => !o && onClose()}>
      <DialogContent className="max-h-[90vh] max-w-3xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{det?.title ?? "Carregando…"}{det?.year ? ` (${det.year})` : ""}</DialogTitle>
          <DialogDescription>Prévia do BugouMods. Dados e players existentes não são alterados; episódios já cadastrados só recebem o player se ainda não o tiverem.</DialogDescription>
        </DialogHeader>
        <Button size="sm" variant="ghost" className="self-start" onClick={onBack}>← Voltar à lista</Button>
        {err && <p className="text-sm text-destructive">{err}</p>}
        {!det && !err && <Loader2 className="mx-auto animate-spin" />}
        {det && <>
          <div className="grid grid-cols-2 gap-2 text-xs sm:grid-cols-3">
            {[["Sinopse", !!det.plot], ["Capa", !!det.cover], ["Temporadas", det.seasons.length > 0], ["Episódios", det.seasons.some(s => s.episodes.length)], ["Player (embed do provedor)", det.seasons.some(s => s.episodes.length)], ["Link direto de vídeo", false]].map(([k, v]) => (
              <div key={String(k)} className="rounded-lg border border-border p-2"><span className="text-muted-foreground">{k}: </span><span className={v ? "text-primary" : "text-muted-foreground"}>{yes(!!v)}</span></div>))}
          </div>
          <p className="text-xs text-muted-foreground">{d?.localSeriesId ? "Série já existe no catálogo — será reaproveitada." : "Série ainda não existe — será criada."}</p>
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
