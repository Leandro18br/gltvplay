import { useCallback, useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { DownloadCloud, Loader2, RefreshCw, Search, X } from "lucide-react";
import { errMsg } from "@/lib/admin/db";
import { bugouImportMovies, bugouMoviesTest, bugouSearchMovies } from "@/lib/integrations/bugoumods.functions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";

type Movie = { id: string; title: string; year: number | null; poster_url: string | null; category: string };
type SearchResult = Awaited<ReturnType<typeof bugouSearchMovies>>;

export function BugouMoviesButton({ label = "Importar filmes completos" }: { label?: string }) {
  const [open, setOpen] = useState(false);
  return <><Button variant="outline" className="rounded-full" onClick={() => setOpen(true)}><DownloadCloud /> {label}</Button>{open && <BugouMoviesDialog onClose={() => setOpen(false)} />}</>;
}

function BugouMoviesDialog({ onClose }: { onClose: () => void }) {
  const search = useServerFn(bugouSearchMovies);
  const test = useServerFn(bugouMoviesTest);
  const importMovies = useServerFn(bugouImportMovies);
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState("");
  const [categories, setCategories] = useState<string[]>([]);
  const [categoryStats, setCategoryStats] = useState<Record<string, { total: number; imported: number }>>({});
  const [lastImportReport, setLastImportReport] = useState<{ category: string; total: number; created: number; updated: number; skipped: number; descriptionsAdded: number; genresAdded: number; metadataUnavailable: number; playersAdded: number; detailFailures: number; failed: number } | null>(null);
  const [page, setPage] = useState(0);
  const [result, setResult] = useState<SearchResult | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [existing, setExisting] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<"" | "search" | "import" | "test">("");
  const [importProgress, setImportProgress] = useState("");
  const [allIds, setAllIds] = useState<string[]>([]);
  const [allOffset, setAllOffset] = useState(0);
  const [allTotals, setAllTotals] = useState({ created: 0, updated: 0, skipped: 0, descriptionsAdded: 0, genresAdded: 0, metadataUnavailable: 0, playersAdded: 0, detailFailures: 0, failed: 0 });
  const [error, setError] = useState("");
  const run = useCallback(async (nextPage = 0, refresh = false, withCategories = false) => {
    setBusy(refresh ? "test" : "search"); setError("");
    try {
      const r = await search({ data: { query, category, page: nextPage, refresh, withCategories } });
      setResult(r); setExisting(r.existing); if (withCategories) { setCategories(r.categories); setCategoryStats(r.categoryStats ?? {}); }
      setPage(nextPage); setSelected(new Set());
      if (refresh) toast.success("Catálogo atualizado: " + r.total + " filmes.");
    } catch (e) { setError(errMsg(e)); } finally { setBusy(""); }
  }, [search, query, category]);
  useEffect(() => { void run(0, false, true); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  async function processAllIds(ids: string[], startAt: number, initial: typeof allTotals) {
    let totals = { ...initial };
    // One film per server call keeps each operation small and makes retrying a 429 idempotent.
    for (let i = startAt; i < ids.length; i++) {
      let r: Awaited<ReturnType<typeof importMovies>>;
      for (let attempt = 0; ; attempt++) {
        setImportProgress(`Importando filmes completos: ${i + 1} de ${ids.length}${attempt ? ` · nova tentativa ${attempt + 1}/4` : ""}…`);
        try {
          r = await importMovies({ data: { ids: [ids[i]!] } });
          break;
        } catch (error) {
          const message = errMsg(error);
          if (!/429|limite de requisições/i.test(message) || attempt >= 3) throw error;
          const waitMs = 5000 * 2 ** attempt;
          setImportProgress(`Limite da API (HTTP 429). Aguardando ${Math.round(waitMs / 1000)}s antes de tentar novamente o filme ${i + 1} de ${ids.length}…`);
          await new Promise(resolve => setTimeout(resolve, waitMs));
        }
      }
      totals = {
        created: totals.created + r.created, updated: totals.updated + r.updated, skipped: totals.skipped + r.skipped,
        descriptionsAdded: totals.descriptionsAdded + r.descriptionsAdded, genresAdded: totals.genresAdded + r.genresAdded,
        metadataUnavailable: totals.metadataUnavailable + r.metadataUnavailable, playersAdded: totals.playersAdded + r.playersAdded,
        detailFailures: totals.detailFailures + r.detailFailures, failed: totals.failed + r.failed,
      };
      setAllTotals(totals);
      setAllOffset(i + 1);
    }
    setLastImportReport({ category: "Catálogo completo BugouMods VIP", total: ids.length, ...totals });
    setSelected(new Set());
    toast.success(`Importação completa: ${totals.created} novos, ${totals.updated} atualizados, ${totals.failed} falhas.`);
    if (totals.detailFailures) toast.warning(`${totals.detailFailures} filme(s) não retornaram detalhes completos pela API; os metadados ausentes foram preservados.`);
    setAllIds([]); setAllOffset(0); setAllTotals({ created: 0, updated: 0, skipped: 0, descriptionsAdded: 0, genresAdded: 0, metadataUnavailable: 0, playersAdded: 0, detailFailures: 0, failed: 0 });
    await run(0, false, true);
  }

  async function importWholeCatalog() {
    if (busy) return;
    setBusy("import"); setError(""); setImportProgress("Atualizando o catálogo BugouMods VIP…");
    try {
      const first = await search({ data: { query: "", category: "", page: 0, refresh: true, withCategories: true } });
      const ids = first.results.map(m => m.id);
      const pages = Math.ceil(first.matches / first.pageSize);
      for (let p = 1; p < pages; p++) {
        setImportProgress(`Lendo catálogo: página ${p + 1} de ${pages}…`);
        const next = await search({ data: { query: "", category: "", page: p, refresh: false, withCategories: false } });
        ids.push(...next.results.map(m => m.id));
      }
      const unique = [...new Set(ids)];
      if (!unique.length) { toast.info("A API não retornou filmes para importar."); return; }
      setAllIds(unique); setAllOffset(0);
      const zero = { created: 0, updated: 0, skipped: 0, descriptionsAdded: 0, genresAdded: 0, metadataUnavailable: 0, playersAdded: 0, detailFailures: 0, failed: 0 };
      setAllTotals(zero);
      await processAllIds(unique, 0, zero);
    } catch (e) {
      setError(errMsg(e));
      toast.error(errMsg(e) + " O lote atual ficou pendente; use Retomar importação para continuar.");
    } finally { setBusy(""); setImportProgress(""); }
  }

  async function resumeWholeCatalog() {
    if (busy || !allIds.length || allOffset >= allIds.length) return;
    setBusy("import");
    try { await processAllIds(allIds, allOffset, allTotals); }
    catch (e) { setError(errMsg(e)); toast.error(errMsg(e) + " O progresso anterior foi mantido para retomada."); }
    finally { setBusy(""); setImportProgress(""); }
  }

  async function testConnection() {
    setBusy("test"); setError("");
    try {
      const r = await test(); setCategories(r.categories);
      const probe = r.metadataProbe;
      const probeText = probe ? ` · teste de metadados: sinopse ${probe.descriptionAvailable ? "presente" : "ausente"}, ${probe.genreNames.length} gênero(s); campos: ${probe.providerFieldPaths.join(", ") || "nenhum campo reconhecido"}` : "";
      toast.success("Conexão OK: " + r.total + " filmes e " + r.categories.length + " categorias." + probeText, { duration: 12000 });
      await run(0, true, true);
    } catch (e) { setError(errMsg(e)); setBusy(""); }
  }
  async function importIds(ids: string[]) {
    let created = 0, updated = 0, skipped = 0, descriptionsAdded = 0, genresAdded = 0, metadataUnavailable = 0, playersAdded = 0, detailFailures = 0, failed = 0;
    for (let i = 0; i < ids.length; i += 10) {
      setImportProgress("Importando " + Math.min(i + 10, ids.length) + " de " + ids.length + " filmes…");
      const r = await importMovies({ data: { ids: ids.slice(i, i + 10) } });
      created += r.created; updated += r.updated; skipped += r.skipped; descriptionsAdded += r.descriptionsAdded; genresAdded += r.genresAdded; metadataUnavailable += r.metadataUnavailable; playersAdded += r.playersAdded; detailFailures += r.detailFailures; failed += r.failed;
    }
    return { created, updated, skipped, descriptionsAdded, genresAdded, metadataUnavailable, playersAdded, detailFailures, failed };
  }
  async function doImport() {
    if (!selected.size) return; setBusy("import"); setImportProgress("");
    try {
      const r = await importIds([...selected]);
      setLastImportReport({ category: category || "Seleção manual", total: selected.size, ...r });
      toast.success("Importação concluída: " + r.created + " novos, " + r.updated + " atualizados, " + r.descriptionsAdded + " descrições preenchidas, " + r.genresAdded + " gêneros associados e " + r.playersAdded + " players Bugou VIP adicionados" + (r.skipped ? ", " + r.skipped + " ignorados" : "") + ".");
      if (r.detailFailures) toast.warning(r.detailFailures + " filme(s) não retornaram metadados completos pela API BugouMods; os dados ausentes ficaram sinalizados para recuperação posterior.");
      setSelected(new Set()); await run(page);
    } catch (e) { toast.error(errMsg(e)); } finally { setBusy(""); setImportProgress(""); }
  }
  async function importWholeCategory() {
    if (!category) return;
    setBusy("import"); setImportProgress("Localizando filmes da categoria…"); setError("");
    try {
      const first = await search({ data: { query: "", category, page: 0, refresh: false, withCategories: false } });
      const ids = first.results.map(m => m.id);
      const pageCount = Math.ceil(first.matches / first.pageSize);
      for (let p = 1; p < pageCount; p++) {
        setImportProgress("Preparando lista: página " + (p + 1) + " de " + pageCount + "…");
        const next = await search({ data: { query: "", category, page: p, refresh: false, withCategories: false } });
        ids.push(...next.results.map(m => m.id));
      }
      if (!ids.length) { toast.info("Não há filmes nesta categoria para importar."); return; }
      const uniqueIds = [...new Set(ids)];
      const report = await importIds(uniqueIds);
      setLastImportReport({ category, total: uniqueIds.length, ...report });
      toast.success("Categoria “" + category + "” concluída: " + report.created + " novos, " + report.updated + " atualizados, " + report.descriptionsAdded + " descrições preenchidas, " + report.genresAdded + " gêneros associados e " + report.playersAdded + " players Bugou VIP adicionados" + (report.skipped ? ", " + report.skipped + " ignorados" : "") + ".");
      if (report.detailFailures) toast.warning(report.detailFailures + " filme(s) não retornaram detalhes completos pela API; o player Bugou VIP foi cadastrado com o ID disponível.");
      setSelected(new Set()); await run(0, false, true);
    } catch (e) { setError(errMsg(e)); toast.error(errMsg(e)); } finally { setBusy(""); setImportProgress(""); }
  }
  const items: Movie[] = result?.results ?? [];
  return <Dialog open onOpenChange={v => !v && onClose()}>
    <DialogContent className="max-h-[92vh] max-w-5xl overflow-y-auto">
      <DialogHeader><DialogTitle>Catálogo de filmes — BugouMods</DialogTitle><DialogDescription>Obtém sinopse e gêneros exclusivamente dos detalhes da API BugouMods VIP. Preserva metadados válidos, categorias editoriais e fontes de reprodução; não usa TMDB para completar esses campos.</DialogDescription></DialogHeader>
      <form className="grid gap-2 md:grid-cols-[1fr_200px_auto_auto]" onSubmit={e => { e.preventDefault(); void run(0); }}>
        <Input value={query} onChange={e => setQuery(e.target.value)} placeholder="Buscar título do filme" />
        <Select value={category || "__all"} onValueChange={v => { setCategory(v === "__all" ? "" : v); setPage(0); }}><SelectTrigger aria-label="Categoria"><SelectValue placeholder="Todas as categorias" /></SelectTrigger><SelectContent><SelectItem value="__all">Todas as categorias</SelectItem>{categories.map(c => { const s = categoryStats[c]; return <SelectItem key={c} value={c}>{c}{s ? ` · ${s.total} filmes · ${s.imported} importados` : ""}</SelectItem>; })}</SelectContent></Select>
        <Button disabled={!!busy} type="submit">{busy === "search" ? <Loader2 className="animate-spin" /> : <Search />} Buscar</Button>
        <Button disabled={!!busy} type="button" variant="outline" onClick={testConnection}>{busy === "test" ? <Loader2 className="animate-spin" /> : <RefreshCw />} Testar / sincronizar</Button>
        <Button disabled={!!busy} type="button" className="bg-[#00DDFA] text-black hover:bg-[#00c8e2]" onClick={importWholeCatalog}>{busy === "import" ? <Loader2 className="animate-spin" /> : <DownloadCloud />} Importar filmes completos</Button>
      </form>
      {error && <p role="alert" className="rounded-lg bg-destructive/10 p-3 text-sm text-destructive">{error}</p>}
      {result && <div className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground"><span>{result.matches} resultados · catálogo com {result.total} filmes</span><span className="ml-auto">{selected.size} selecionados</span><Button type="button" size="sm" variant="outline" disabled={!!busy || !items.length} onClick={() => setSelected(s => { const n = new Set(s); const allSelected = items.every(m => n.has(m.id)); items.forEach(m => allSelected ? n.delete(m.id) : n.add(m.id)); return n; })}>{items.length && items.every(m => selected.has(m.id)) ? "Desmarcar página" : "Selecionar página"}</Button><Button type="button" size="sm" variant="ghost" onClick={() => setSelected(new Set())}><X /> Limpar seleção</Button></div>}
      {category && <div className="flex flex-wrap items-center gap-3 rounded-lg border border-primary/20 p-3"><div className="flex-1"><p className="text-sm font-medium">Importação em massa por categoria</p><p className="text-xs text-muted-foreground">{categoryStats[category] ? `${categoryStats[category].total} filmes na categoria · ${categoryStats[category].imported} já importados. ` : ""}Importa todos os filmes de “{category}”, incluindo os que estão em outras páginas.</p></div><Button type="button" disabled={!!busy} onClick={importWholeCategory}><DownloadCloud /> Importar todos da categoria</Button></div>}
      {importProgress && <p className="text-sm text-muted-foreground" role="status">{importProgress}</p>}
      {allIds.length > 0 && allOffset < allIds.length && !busy && <div className="flex flex-wrap items-center gap-2 rounded-lg border border-primary/30 bg-primary/5 p-3"><p className="flex-1 text-sm">Importação interrompida: {allOffset} de {allIds.length} filmes processados. Você pode continuar sem reiniciar os lotes concluídos.</p><Button type="button" onClick={() => void resumeWholeCatalog()}><RefreshCw /> Retomar importação</Button></div>}
      {lastImportReport && <div className="grid grid-cols-2 gap-2 rounded-lg border p-3 text-sm sm:grid-cols-4"><div><p className="text-muted-foreground">Categoria / seleção</p><p className="font-medium">{lastImportReport.category}</p></div><div><p className="text-muted-foreground">Processados</p><p className="font-medium">{lastImportReport.total}</p></div><div><p className="text-muted-foreground">Novos importados</p><p className="font-medium">{lastImportReport.created}</p></div><div><p className="text-muted-foreground">Atualizados</p><p className="font-medium">{lastImportReport.updated}</p></div><div><p className="text-muted-foreground">Sinopses preenchidas</p><p className="font-medium">{lastImportReport.descriptionsAdded}</p></div><div><p className="text-muted-foreground">Gêneros associados</p><p className="font-medium">{lastImportReport.genresAdded}</p></div><div><p className="text-muted-foreground">Sem metadados completos</p><p className="font-medium">{lastImportReport.metadataUnavailable}</p></div><div><p className="text-muted-foreground">Falhas</p><p className="font-medium">{lastImportReport.failed}</p></div></div>}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6">
        {items.map(m => { const checked = selected.has(m.id); return <button key={m.id} type="button" onClick={() => setSelected(s => { const n = new Set(s); n.has(m.id) ? n.delete(m.id) : n.add(m.id); return n; })} className={"relative overflow-hidden rounded-xl border text-left " + (checked ? "border-primary ring-1 ring-primary" : "border-border")}>
          <div className="aspect-[2/3] bg-muted">{m.poster_url && <img src={m.poster_url} alt="" loading="lazy" className="h-full w-full object-cover" />}</div>
          <div className="space-y-1 p-2"><p className="line-clamp-2 text-sm font-medium">{m.title}</p><p className="text-xs text-muted-foreground">{m.year ?? "Ano indisponível"}</p>{m.category && <Badge variant="secondary" className="max-w-full truncate">{m.category}</Badge>}</div>
          {existing[m.id] && <Badge className="absolute left-1 top-1" variant="outline">Importado</Badge>}
          {checked && <span className="absolute right-2 top-2 rounded-full bg-primary px-2 py-1 text-xs text-primary-foreground">Selecionado</span>}
        </button>; })}
      </div>
      {result && <div className="flex flex-wrap items-center gap-2"><Button variant="outline" disabled={!!busy || page <= 0} onClick={() => void run(page - 1)}>Anterior</Button><span className="text-sm text-muted-foreground">Página {page + 1} · {result.pageSize} por página</span><Button variant="outline" disabled={!!busy || (page + 1) * result.pageSize >= result.matches} onClick={() => void run(page + 1)}>Próxima</Button><Button className="ml-auto" disabled={!!busy || !selected.size} onClick={doImport}>{busy === "import" ? <Loader2 className="animate-spin" /> : <DownloadCloud />} Importar {selected.size || ""}</Button></div>}
    </DialogContent>
  </Dialog>;
}