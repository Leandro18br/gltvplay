import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { Check, DownloadCloud, Loader2, Search } from "lucide-react";
import { errMsg } from "@/lib/admin/db";
import { bugouImportSeries, bugouSearchSeries } from "@/lib/integrations/bugoumods.functions";
import type { BugouSeries } from "@/lib/integrations/bugoumods";
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
          <DialogDescription>Importa só nome, ano e capa. Séries já cadastradas não são alteradas. Episódios e players não são criados.</DialogDescription>
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
            <button key={r.id} type="button" disabled={has} onClick={() => setSel(s => { const x = new Set(s); if (x.has(r.id)) x.delete(r.id); else if (x.size < 50) x.add(r.id); return x; })}
              className={`relative overflow-hidden rounded-xl border text-left transition disabled:opacity-60 ${on ? "border-primary shadow-glow" : "border-border"}`}>
              <div className="aspect-[2/3] bg-muted">{r.poster_url && <img src={r.poster_url} alt="" loading="lazy" className="h-full w-full object-cover" />}</div>
              <div className="p-2"><p className="truncate text-sm font-medium">{r.title}</p><p className="truncate text-xs text-muted-foreground">{r.year ?? "—"} · {r.category}</p></div>
              {has && <Badge variant="secondary" className="absolute left-2 top-2">Já existe</Badge>}
              {on && <span className="absolute right-2 top-2 rounded-full bg-primary p-1 text-primary-foreground"><Check className="h-3 w-3" /></span>}
            </button>); })}
        </div>
      </DialogContent>
    </Dialog>
  );
}
