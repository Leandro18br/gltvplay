import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { Check, DownloadCloud, Loader2, Search } from "lucide-react";
import { ApiImport } from "@/components/admin/integrations/ApiImport";
import { listImportProviders, searchImport, type ImportItem } from "@/lib/import/import.functions";
import { db, errMsg } from "@/lib/admin/db";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

export const Route = createFileRoute("/admin/import")({ component: ImportPage });

function ImportPage() {
  const list = useServerFn(listImportProviders);
  const search = useServerFn(searchImport);
  const providers = useQuery({ queryKey: ["admin", "import-providers"], queryFn: () => list() });
  const [provider, setProvider] = useState("tmdb");
  const [kind, setKind] = useState<"movie" | "series">("movie");
  const [q, setQ] = useState("");
  const [results, setResults] = useState<ImportItem[]>([]);
  const [existing, setExisting] = useState<Set<string>>(new Set());
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);

  const current = providers.data?.find((p) => p.id === provider);
  const table = kind === "movie" ? "movies" : "series";

  async function run(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      const items = await search({ data: { provider, query: q, kind } });
      setResults(items);
      setSelected(new Set());
      const ids = items.map((i) => i.external_id);
      const { data } = ids.length ? await db.from(table).select("external_id").eq("external_source", provider).in("external_id", ids) : { data: [] };
      setExisting(new Set((data ?? []).map((d: { external_id: string }) => d.external_id)));
    } catch (err) {
      toast.error(errMsg(err));
    } finally {
      setBusy(false);
    }
  }

  async function doImport() {
    setBusy(true);
    try {
      const rows = results.filter((r) => selected.has(r.external_id)).map(({ kind: _k, language, ...r }) => (kind === "movie" ? { ...r, language } : r));
      const fresh = rows.filter((r) => !existing.has(r.external_id)).map((r) => ({ ...r, status: "draft" }));
      const old = rows.filter((r) => existing.has(r.external_id));
      if (fresh.length) {
        const { error } = await db.from(table).insert(fresh);
        if (error) throw error;
      }
      for (const r of old) {
        const { error } = await db.from(table).update(r).eq("external_source", r.external_source).eq("external_id", r.external_id);
        if (error) throw error;
      }
      toast.success(`${fresh.length} importado(s) como rascunho, ${old.length} atualizado(s)`);
      setExisting(new Set([...existing, ...rows.map((r) => r.external_id)]));
      setSelected(new Set());
    } catch (err) {
      toast.error(errMsg(err));
    } finally {
      setBusy(false);
    }
  }

  const toggle = (id: string) => { const s = new Set(selected); if (s.has(id)) s.delete(id); else s.add(id); setSelected(s); };

  return (
    <div className="space-y-5">
      <section id="api" className="space-y-3">
        <h1 className="text-2xl font-bold md:text-3xl">Importar pela API</h1>
        <p className="text-sm text-muted-foreground">Use as APIs de Catálogo cadastradas em "APIs e Integrações". Nada é duplicado: itens já cadastrados são atualizados.</p>
        <ApiImport />
      </section>
      <hr className="border-border" />
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold md:text-3xl">Importação de catálogo</h1>
          <p className="text-sm text-muted-foreground">Busque em fontes licenciadas, revise e importe sem duplicar. Itens novos entram como rascunho.</p>
        </div>
        <Button disabled={!selected.size || busy} onClick={doImport} className="rounded-full"><DownloadCloud /> Importar {selected.size || ""}</Button>
      </div>

      {current && !current.configured && (
        <div className="rounded-2xl border border-primary/30 bg-accent/40 p-4 text-sm">
          A fonte <b>{current.name}</b> ainda não está conectada. Para ativá-la, é necessário cadastrar a chave de acesso dessa fonte. A estrutura de busca, prévia e importação já está pronta.
        </div>
      )}

      <form onSubmit={run} className="flex flex-col gap-2 rounded-2xl border border-border bg-card p-3 md:flex-row">
        <Select value={provider} onValueChange={setProvider}>
          <SelectTrigger className="md:w-56"><SelectValue /></SelectTrigger>
          <SelectContent>{providers.data?.map((p) => <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>)}</SelectContent>
        </Select>
        <Select value={kind} onValueChange={(v) => { setKind(v as "movie" | "series"); setResults([]); }}>
          <SelectTrigger className="md:w-36"><SelectValue /></SelectTrigger>
          <SelectContent><SelectItem value="movie">Filmes</SelectItem><SelectItem value="series">Séries</SelectItem></SelectContent>
        </Select>
        <Input className="flex-1" placeholder="Buscar título…" value={q} onChange={(e) => setQ(e.target.value)} required />
        <Button disabled={busy || !current?.configured}>{busy ? <Loader2 className="animate-spin" /> : <Search />} Buscar</Button>
      </form>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
        {results.map((r) => {
          const on = selected.has(r.external_id);
          return (
            <button key={r.external_id} onClick={() => toggle(r.external_id)} className={`group relative overflow-hidden rounded-xl border text-left transition ${on ? "border-primary shadow-glow" : "border-border"}`}>
              <div className="aspect-[2/3] bg-muted">{r.poster_url && <img src={r.poster_url} alt="" className="h-full w-full object-cover" loading="lazy" />}</div>
              <div className="p-2"><p className="truncate text-sm font-medium">{r.title}</p><p className="text-xs text-muted-foreground">{r.release_year ?? "—"}</p></div>
              {existing.has(r.external_id) && <Badge variant="secondary" className="absolute left-2 top-2">Já existe — atualizar</Badge>}
              {on && <span className="absolute right-2 top-2 rounded-full bg-primary p-1 text-primary-foreground"><Check className="h-3 w-3" /></span>}
            </button>
          );
        })}
      </div>
    </div>
  );
}
