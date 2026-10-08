import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Link } from "@tanstack/react-router";
import { toast } from "sonner";
import { Check, CheckCircle2, DownloadCloud, Film, Loader2, RefreshCw, Search, Sparkles, XCircle } from "lucide-react";
import { tmdbImportEpisodes, tmdbImportMovie, tmdbImportSeasons, tmdbImportSeries, tmdbListSeasons, tmdbRefresh, tmdbSearch, tmdbStatus, tmdbTestConnection } from "@/lib/tmdb/tmdb.functions";
import { errMsg } from "@/lib/admin/db";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";

type Kind = "movie" | "series";
type Result = Awaited<ReturnType<typeof tmdbSearch>>["results"][number];

const invalidateCatalog = (qc: ReturnType<typeof useQueryClient>) => {
  ["movies", "series", "seasons", "episodes", "genres"].forEach((t) => qc.invalidateQueries({ queryKey: ["admin", t] }));
};

/** Full series import: info → seasons (no specials unless chosen) → episodes. Never creates players. */
function useFullSeriesImport() {
  const listSeasons = useServerFn(tmdbListSeasons);
  const importSeasons = useServerFn(tmdbImportSeasons);
  const importEpisodes = useServerFn(tmdbImportEpisodes);
  return async (seriesId: string, includeSpecials: boolean, log: (l: string) => void) => {
    log("Importando temporadas...");
    const list = await listSeasons({ data: { seriesId } });
    const nums = list.filter((s) => includeSpecials || !s.special).map((s) => s.season_number);
    const seasons = await importSeasons({ data: { seriesId, seasonNumbers: nums } });
    seasons.forEach((s) => log(`✓ ${s.season_number === 0 ? "Especiais" : `Temporada ${s.season_number}`}${s.created ? "" : " (já existia)"}`));
    log("Importando episódios...");
    let total = 0;
    for (const s of seasons) {
      const r = await importEpisodes({ data: { seasonId: s.id } });
      total += r.created + r.updated;
      log(`✓ ${total} episódios importados`);
    }
    return list.some((s) => s.special) && !includeSpecials;
  };
}

export function TmdbSearchButton({ kind }: { kind: Kind }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button size="sm" className="rounded-full" onClick={() => setOpen(true)}><Search /> Buscar {kind === "movie" ? "filme" : "série"} no TMDB</Button>
      {open && <TmdbSearchDialog kind={kind} onClose={() => setOpen(false)} />}
    </>
  );
}

function TmdbSearchDialog({ kind, onClose }: { kind: Kind; onClose: () => void }) {
  const qc = useQueryClient();
  const search = useServerFn(tmdbSearch);
  const importMovie = useServerFn(tmdbImportMovie);
  const importSeries = useServerFn(tmdbImportSeries);
  const fullImport = useFullSeriesImport();
  const [q, setQ] = useState(""); const [year, setYear] = useState("");
  const [results, setResults] = useState<Result[]>([]); const [existing, setExisting] = useState<Record<number, string>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [specials, setSpecials] = useState(false);
  const [log, setLog] = useState<string[]>([]);
  const isMovie = kind === "movie";

  async function run(e: React.FormEvent) {
    e.preventDefault(); setBusy("search");
    try {
      const r = await search({ data: { kind, query: q, page: 1, ...(year ? { year } : {}) } });
      setResults(r.results); setExisting(r.existing);
      if (!r.results.length) toast.message(isMovie ? "Filme não encontrado." : "Série não encontrada.");
    } catch (x) { toast.error(errMsg(x)); } finally { setBusy(null); }
  }

  async function doImport(r: Result, mode: "import" | "update" | "full") {
    setBusy(`${r.tmdb_id}:${mode}`); setLog([]);
    try {
      const fn = isMovie ? importMovie : importSeries;
      if (mode === "full") setLog(["Importando série..."]);
      const res = await fn({ data: { tmdbId: r.tmdb_id, update: mode === "update" } });
      setExisting((s) => ({ ...s, [r.tmdb_id]: res.id }));
      if (res.exists) { toast.message(isMovie ? "Este filme já está cadastrado." : "Esta série já está cadastrada."); return; }
      if (mode === "full") {
        const add = (l: string) => setLog((x) => [...x, l]);
        add("✓ Informações da série");
        const skipped = await fullImport(res.id, specials, add);
        if (skipped) add("Especiais disponíveis — não importados (marque \"Incluir especiais\" para importar).");
        add("Finalizado.");
      }
      invalidateCatalog(qc);
      toast.success(mode === "update" ? "Informações atualizadas pelo TMDB." : `${isMovie ? "Filme" : "Série"} importado(a) como rascunho, sem player.`);
    } catch (x) { toast.error(errMsg(x)); setLog((l) => (l.length ? [...l, `Erro: ${errMsg(x)}`] : l)); } finally { setBusy(null); }
  }

  return (
    <Dialog open onOpenChange={(o) => !o && !busy && onClose()}>
      <DialogContent className="max-h-[90vh] max-w-5xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Buscar {isMovie ? "filme" : "série"} no TMDB</DialogTitle>
          <DialogDescription>Somente metadados. Nenhum player ou fonte é criado — adicione depois em Fontes/Players.</DialogDescription>
        </DialogHeader>
        <form onSubmit={run} className="flex flex-col gap-2 sm:flex-row">
          <Input autoFocus placeholder={isMovie ? "Digite o nome do filme..." : "Nome da série..."} value={q} onChange={(e) => setQ(e.target.value)} className="flex-1" />
          <Input placeholder="Ano (opcional)" value={year} onChange={(e) => setYear(e.target.value.replace(/\D/g, "").slice(0, 4))} className="sm:w-36" />
          <Button disabled={!!busy || !q.trim()}>{busy === "search" ? <Loader2 className="animate-spin" /> : <Search />} Buscar</Button>
        </form>
        {!isMovie && (
          <label className="flex items-center gap-2 text-sm text-muted-foreground"><Checkbox checked={specials} onCheckedChange={(v) => setSpecials(!!v)} /> Incluir "Especiais" (temporada 0) na importação completa</label>
        )}
        {log.length > 0 && <pre className="whitespace-pre-wrap rounded-xl border border-border bg-muted/40 p-3 text-xs">{log.join("\n")}</pre>}
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
          {results.map((r) => {
            const id = existing[r.tmdb_id];
            return (
              <div key={r.tmdb_id} className="flex flex-col overflow-hidden rounded-xl border border-border bg-card">
                <div className="aspect-[2/3] bg-muted">{r.poster_url ? <img src={r.poster_url} alt={r.title} loading="lazy" className="h-full w-full object-cover" /> : <Film className="m-auto mt-16 h-8 w-8 text-muted-foreground" />}</div>
                <div className="flex flex-1 flex-col gap-1 p-2 text-xs">
                  <p className="line-clamp-2 text-sm font-semibold">{r.title}</p>
                  {r.original_title && r.original_title !== r.title && <p className="truncate text-muted-foreground">{r.original_title}</p>}
                  <p className="text-muted-foreground">{r.year ?? "—"} · Nota {r.rating != null ? r.rating.toFixed(1) : "—"}{r.language ? ` · ${r.language.toUpperCase()}` : ""}</p>
                  <p className="text-muted-foreground">TMDB ID: {r.tmdb_id}</p>
                  <div className="mt-auto space-y-1 pt-2">
                    {id ? (
                      <>
                        <Badge variant="secondary" className="w-full justify-center">Já cadastrado</Badge>
                        <Button asChild size="sm" variant="outline" className="w-full">
                          {isMovie ? <Link to="/admin/movies" search={{ edit: id }} onClick={onClose}>Abrir filme</Link> : <Link to="/admin/series/$id" params={{ id }} onClick={onClose}>Abrir série</Link>}
                        </Button>
                        <Button size="sm" variant="ghost" className="w-full" disabled={!!busy} onClick={() => doImport(r, "update")}>{busy === `${r.tmdb_id}:update` ? <Loader2 className="animate-spin" /> : <RefreshCw />} Atualizar informações</Button>
                      </>
                    ) : (
                      <>
                        <Button size="sm" className="w-full" disabled={!!busy} onClick={() => doImport(r, "import")}>{busy === `${r.tmdb_id}:import` ? <Loader2 className="animate-spin" /> : <DownloadCloud />} Importar {isMovie ? "filme" : "série"}</Button>
                        {!isMovie && <Button size="sm" variant="outline" className="w-full" disabled={!!busy} onClick={() => doImport(r, "full")}>{busy === `${r.tmdb_id}:full` ? <Loader2 className="animate-spin" /> : <Sparkles />} Importar série completa</Button>}
                      </>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </DialogContent>
    </Dialog>
  );
}

/** "Atualizar dados do TMDB" — only TMDB-owned fields; players/status/categories untouched. */
export function TmdbRefreshButton({ kind, id, onDone }: { kind: Kind; id: string; onDone?: () => void }) {
  const qc = useQueryClient();
  const refresh = useServerFn(tmdbRefresh);
  const [busy, setBusy] = useState(false);
  return (
    <Button type="button" size="sm" variant="outline" className="rounded-full" disabled={busy} onClick={async () => {
      setBusy(true);
      try { await refresh({ data: { kind, id } }); invalidateCatalog(qc); toast.success("Dados do TMDB atualizados."); onDone?.(); }
      catch (x) { toast.error(errMsg(x)); } finally { setBusy(false); }
    }}>{busy ? <Loader2 className="animate-spin" /> : <RefreshCw />} Atualizar dados do TMDB</Button>
  );
}

export function TmdbSeasonsButton({ seriesId }: { seriesId: string }) {
  const qc = useQueryClient();
  const list = useServerFn(tmdbListSeasons);
  const importSeasons = useServerFn(tmdbImportSeasons);
  const fullImport = useFullSeriesImport();
  const [open, setOpen] = useState(false);
  const [sel, setSel] = useState<Set<number>>(new Set());
  const [busy, setBusy] = useState(false);
  const [log, setLog] = useState<string[]>([]);
  const seasons = useQuery({ queryKey: ["admin", "tmdb-seasons", seriesId], enabled: open, queryFn: async () => {
    const r = await list({ data: { seriesId } });
    setSel(new Set(r.filter((s) => !s.special && !s.exists).map((s) => s.season_number)));
    return r;
  } });
  const toggle = (n: number) => setSel((s) => { const x = new Set(s); if (x.has(n)) x.delete(n); else x.add(n); return x; });
  const Row = ({ s }: { s: NonNullable<typeof seasons.data>[number] }) => (
    <label className="flex items-center gap-3 rounded-xl border border-border p-3 text-sm">
      <Checkbox checked={sel.has(s.season_number)} onCheckedChange={() => toggle(s.season_number)} />
      <span className="flex-1">{s.special ? "Especiais" : `Temporada ${s.season_number}`}{s.name && !s.special ? ` — ${s.name}` : ""}<span className="block text-xs text-muted-foreground">{s.episode_count} episódios{s.air_date ? ` · ${s.air_date.slice(0, 4)}` : ""}</span></span>
      {s.exists && <Badge variant="secondary">Já existe</Badge>}
    </label>
  );
  return (
    <>
      <Button size="sm" variant="outline" className="rounded-full" onClick={() => { setLog([]); setOpen(true); }}><DownloadCloud /> Importar temporadas do TMDB</Button>
      <Dialog open={open} onOpenChange={(o) => !busy && setOpen(o)}>
        <DialogContent className="max-h-[90vh] max-w-lg overflow-y-auto">
          <DialogHeader><DialogTitle>Importar temporadas do TMDB</DialogTitle><DialogDescription>Temporadas existentes não são duplicadas. Nenhum player é criado.</DialogDescription></DialogHeader>
          {seasons.isPending ? <Loader2 className="animate-spin text-primary" /> : seasons.error ? <p className="text-sm text-destructive">{errMsg(seasons.error)}</p> : (
            <div className="space-y-2">
              {seasons.data!.filter((s) => !s.special).map((s) => <Row key={s.season_number} s={s} />)}
              {seasons.data!.some((s) => s.special) && <><p className="pt-2 text-xs font-semibold uppercase text-muted-foreground">Especiais</p>{seasons.data!.filter((s) => s.special).map((s) => <Row key={s.season_number} s={s} />)}</>}
            </div>
          )}
          {log.length > 0 && <pre className="whitespace-pre-wrap rounded-xl border border-border bg-muted/40 p-3 text-xs">{log.join("\n")}</pre>}
          <div className="flex flex-wrap justify-end gap-2">
            <Button variant="outline" disabled={busy || !seasons.data} onClick={async () => {
              setBusy(true); setLog([]);
              try { await fullImport(seriesId, sel.has(0), (l) => setLog((x) => [...x, l])); setLog((x) => [...x, "Finalizado."]); invalidateCatalog(qc); seasons.refetch(); }
              catch (x) { toast.error(errMsg(x)); } finally { setBusy(false); }
            }}><Sparkles /> Temporadas + episódios</Button>
            <Button disabled={busy || !sel.size} onClick={async () => {
              setBusy(true);
              try { const r = await importSeasons({ data: { seriesId, seasonNumbers: [...sel] } }); toast.success(`${r.filter((x) => x.created).length} temporada(s) criada(s).`); invalidateCatalog(qc); seasons.refetch(); }
              catch (x) { toast.error(errMsg(x)); } finally { setBusy(false); }
            }}>{busy ? <Loader2 className="animate-spin" /> : <Check />} Importar selecionadas</Button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}

export function TmdbEpisodesButton({ seasonId }: { seasonId: string }) {
  const qc = useQueryClient();
  const run = useServerFn(tmdbImportEpisodes);
  const [busy, setBusy] = useState(false);
  return (
    <Button size="sm" variant="outline" className="rounded-full" disabled={busy} onClick={async () => {
      setBusy(true);
      try { const r = await run({ data: { seasonId } }); toast.success(`${r.created} episódio(s) novo(s), ${r.updated} atualizado(s). Nenhum player foi criado.`); invalidateCatalog(qc); }
      catch (x) { toast.error(errMsg(x)); } finally { setBusy(false); }
    }}>{busy ? <Loader2 className="animate-spin" /> : <DownloadCloud />} Importar episódios do TMDB</Button>
  );
}

/** TMDB card for "APIs e Integrações". */
export function TmdbIntegrationCard() {
  const status = useServerFn(tmdbStatus);
  const test = useServerFn(tmdbTestConnection);
  const st = useQuery({ queryKey: ["admin", "tmdb-status"], queryFn: () => status() });
  const [res, setRes] = useState<{ ok: boolean; message: string } | null>(null);
  const [busy, setBusy] = useState(false);
  return (
    <div className="rounded-2xl border border-primary/30 bg-card p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2"><p className="font-semibold">TMDB</p><Badge variant="secondary" className="rounded-full">Oficial</Badge><Badge variant="outline" className="rounded-full">Catálogo de filmes e séries</Badge></div>
          <p className="mt-1 text-xs text-muted-foreground">https://api.themoviedb.org/3 · idioma pt-BR · somente metadados (sem players)</p>
          <p className="mt-1 text-xs">TMDB API Key: {st.data?.configured ? <span className="text-primary">configurada no backend (••••)</span> : <span className="text-destructive">não configurada</span>}</p>
          {res && <p className={`mt-2 flex items-center gap-1 text-sm ${res.ok ? "text-primary" : "text-destructive"}`}>{res.ok ? <CheckCircle2 className="h-4 w-4" /> : <XCircle className="h-4 w-4" />}{res.ok ? "Conectado" : `Erro na conexão — ${res.message}`}</p>}
        </div>
        <Button size="sm" variant="outline" disabled={busy} onClick={async () => { setBusy(true); try { setRes(await test()); } catch (x) { setRes({ ok: false, message: errMsg(x) }); } finally { setBusy(false); } }}>{busy ? <Loader2 className="animate-spin" /> : <RefreshCw />} Testar conexão</Button>
      </div>
    </div>
  );
}
