import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { Check, DownloadCloud, Loader2, Search } from "lucide-react";
import { db, errMsg } from "@/lib/admin/db";
import { catalogSearch, importCatalog } from "@/lib/integrations/integrations.functions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

type Item = Awaited<ReturnType<typeof catalogSearch>>[number];

export function ApiImport() {
  const apis = useQuery({ queryKey: ["admin", "integrations", "catalog"], queryFn: async () => { const r = await db.from("api_integrations").select("id,name,auto_fetch_player").eq("kind", "catalog").eq("is_active", true).order("priority"); if (r.error) throw r.error; return r.data as { id: string; name: string; auto_fetch_player: boolean }[]; } });
  const search = useServerFn(catalogSearch); const doImport = useServerFn(importCatalog);
  const [api, setApi] = useState(""); const [kind, setKind] = useState<"movie" | "series">("movie");
  const [q, setQ] = useState(""); const [year, setYear] = useState(""); const [ext, setExt] = useState("");
  const [items, setItems] = useState<Item[]>([]); const [existing, setExisting] = useState<Set<string>>(new Set());
  const [sel, setSel] = useState<Set<number>>(new Set()); const [busy, setBusy] = useState(false);
  const [auto, setAuto] = useState<boolean | null>(null);
  const current = apis.data?.find(a => a.id === (api || apis.data?.[0]?.id));
  const autoOn = auto ?? !!current?.auto_fetch_player;

  async function run(e: React.FormEvent) {
    e.preventDefault(); if (!current) return; setBusy(true);
    try {
      const r = await search({ data: { integrationId: current.id, kind, query: q, ...(year ? { year } : {}), ...(ext ? { externalId: ext } : {}) } });
      setItems(r); setSel(new Set());
      const table = kind === "movie" ? "movies" : "series"; const found = new Set<string>();
      for (const src of [...new Set(r.map(i => i.key.source))]) {
        const ids = r.filter(i => i.key.source === src).map(i => i.key.id);
        const { data } = await db.from(table).select("external_id").eq("external_source", src).in("external_id", ids);
        (data ?? []).forEach((d: { external_id: string }) => found.add(`${src}|${d.external_id}`));
      }
      setExisting(found);
      if (!r.length) toast.message("Nenhum resultado");
    } catch (x) { toast.error(errMsg(x)); } finally { setBusy(false); }
  }
  async function importSel() {
    if (!current) return; setBusy(true);
    try {
      const chosen = items.filter((_, n) => sel.has(n)).map(({ key: _k, ...i }) => i);
      const r = await doImport({ data: { integrationId: current.id, kind, items: chosen, autoPlayer: autoOn } });
      toast.success(`Importação concluída: ${r.created} novos, ${r.updated} atualizados${kind === "series" ? `, ${r.seasons} temporadas, ${r.episodes} episódios` : ""}${autoOn ? `, ${r.players} players` : ""}. Os novos ficam como rascunho.`);
      r.playerErrors.slice(0, 3).forEach(m => toast.warning(m));
      setSel(new Set()); setExisting(s => new Set([...s, ...items.filter((_, n) => sel.has(n)).map(i => `${i.key.source}|${i.key.id}`)]));
    } catch (x) { toast.error(errMsg(x)); } finally { setBusy(false); }
  }

  if (apis.isPending) return <Loader2 className="animate-spin text-primary" />;
  if (!apis.data?.length) return <p className="rounded-2xl border border-dashed border-border p-6 text-sm text-muted-foreground">Nenhuma API de Catálogo ativa. Cadastre uma em "APIs e Integrações".</p>;
  return (
    <div className="space-y-4">
      <form onSubmit={run} className="grid gap-2 rounded-2xl border border-border bg-card p-3 md:grid-cols-6">
        <Select value={current?.id ?? ""} onValueChange={v => { setApi(v); setAuto(null); }}><SelectTrigger className="md:col-span-2" aria-label="API"><SelectValue /></SelectTrigger><SelectContent>{apis.data.map(a => <SelectItem key={a.id} value={a.id}>{a.name}</SelectItem>)}</SelectContent></Select>
        <Select value={kind} onValueChange={v => { setKind(v as "movie" | "series"); setItems([]); }}><SelectTrigger aria-label="Tipo"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="movie">Filmes</SelectItem><SelectItem value="series">Séries</SelectItem></SelectContent></Select>
        <Input placeholder="Título" value={q} onChange={e => setQ(e.target.value)} className="md:col-span-1" />
        <Input placeholder="Ano" value={year} onChange={e => setYear(e.target.value.replace(/\D/g, "").slice(0, 4))} />
        <Input placeholder="ID externo" value={ext} onChange={e => setExt(e.target.value)} />
        <div className="flex flex-wrap items-center gap-3 md:col-span-6">
          <Button disabled={busy || (!q.trim() && !ext.trim())}>{busy ? <Loader2 className="animate-spin" /> : <Search />} Buscar</Button>
          <label className="flex items-center gap-2 text-sm"><Switch checked={autoOn} onCheckedChange={setAuto} /> Buscar player automaticamente</label>
          <Button type="button" className="ml-auto rounded-full" disabled={!sel.size || busy} onClick={importSel}><DownloadCloud /> Importar {sel.size || ""}</Button>
        </div>
      </form>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
        {items.map((r, n) => { const on = sel.has(n); const has = existing.has(`${r.key.source}|${r.key.id}`); return (
          <button key={n} type="button" onClick={() => setSel(s => { const x = new Set(s); if (x.has(n)) x.delete(n); else x.add(n); return x; })} className={`relative overflow-hidden rounded-xl border text-left transition ${on ? "border-primary shadow-glow" : "border-border"}`}>
            <div className="aspect-[2/3] bg-muted">{r.poster_url && <img src={r.poster_url} alt="" loading="lazy" className="h-full w-full object-cover" />}</div>
            <div className="p-2"><p className="truncate text-sm font-medium">{r.title}</p><p className="text-xs text-muted-foreground">{r.release_year ?? "—"} · {kind === "movie" ? "Filme" : "Série"}{r.rating != null && ` · ★ ${r.rating.toFixed(1)}`}</p></div>
            {has && <Badge variant="secondary" className="absolute left-2 top-2">Já existe — atualizar</Badge>}
            {on && <span className="absolute right-2 top-2 rounded-full bg-primary p-1 text-primary-foreground"><Check className="h-3 w-3" /></span>}
          </button>); })}
      </div>
    </div>
  );
}
