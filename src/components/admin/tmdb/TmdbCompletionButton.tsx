import { useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { useQueryClient } from "@tanstack/react-query";
import { Loader2, RefreshCw, Search } from "lucide-react";
import { Input } from "@/components/ui/input";
import { toast } from "sonner";
import { tmdbRefresh, tmdbResolveContent, tmdbCompleteSeasonEpisodes, tmdbSearch } from "@/lib/tmdb/tmdb.functions";
import type { MatchCandidate } from "@/lib/tmdb/completion";
import { db, errMsg } from "@/lib/admin/db";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";

type Kind = "movie" | "series";
type CompletionResult = Awaited<ReturnType<typeof tmdbRefresh>>;
function invalidate(qc: ReturnType<typeof useQueryClient>) {
  ["movies", "series", "seasons", "episodes", "genres"].forEach((table) => qc.invalidateQueries({ queryKey: ["admin", table] }));
  qc.invalidateQueries({ queryKey: ["catalog"] });
}
const FIELD_LABEL: Record<string, string> = {
  tmdb_id: "TMDB ID", imdb_id: "IMDb ID", title: "título", original_title: "título original", description: "sinopse",
  release_date: "data de lançamento", first_air_date: "primeira exibição", release_year: "ano", duration_minutes: "duração",
  poster_url: "pôster", backdrop_url: "banner", vote_average: "nota", vote_count: "avaliações", popularity: "popularidade",
  tagline: "slogan", tmdb_status: "status", language: "idioma original", country: "país", number_of_seasons: "temporadas", number_of_episodes: "episódios",
};
const labels = (keys: string[] = []) => [...new Set(keys.filter((k) => FIELD_LABEL[k]).map((k) => FIELD_LABEL[k]))].join(", ");
export function TmdbRefreshButton({ kind, id, disabled, onDone, onBusyChange }: {
  kind: Kind; id: string; disabled?: boolean; onDone?: (result: CompletionResult) => void | Promise<void>; onBusyChange?: (busy: boolean) => void;
}) {
  const qc = useQueryClient();
  const resolve = useServerFn(tmdbResolveContent);
  const refresh = useServerFn(tmdbRefresh);
  const search = useServerFn(tmdbSearch);
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState(false);
  const [candidates, setCandidates] = useState<MatchCandidate[]>([]);
  const [query, setQuery] = useState("");
  const [year, setYear] = useState("");
  const [selected, setSelected] = useState<number | null>(null);
  const [saveError, setSaveError] = useState("");
  async function confirm() {
    if (!selected) return;
    markBusy(true); setSaveError("");
    try { await apply(selected); setSelected(null); }
    catch (error) { const text = errMsg(error); setSaveError(text); toast.error(text); }
    finally { markBusy(false); }
  }
  const [message, setMessage] = useState<{ text: string; error: boolean } | null>(null);
  const markBusy = (value: boolean) => { setBusy(value); onBusyChange?.(value); };
  async function apply(tmdbId: number) {
    const result = await refresh({ data: { kind, id, tmdbId } });
    invalidate(qc); await onDone?.(result); setOpen(false); setCandidates([]);
    const filled = labels(result.filledFields);
    const empty = labels(result.empty);
    const text = `Informações atualizadas! ${result.filled} campos foram preenchidos${filled ? ` (${filled})` : ""}.${result.genres ? ` ${result.genres} gênero(s) associado(s).` : ""}${result.genres_created ? ` ${result.genres_created} gênero(s) novo(s) criado(s).` : ""}${empty ? ` Sem dados no TMDB: ${empty}.` : ""}${result.dateConfirmed ? "" : " A data de lançamento não pôde ser confirmada no TMDB; o valor atual foi mantido."}`;
    setMessage({ text, error: false }); toast.success(`Informações atualizadas! ${result.filled} campos foram preenchidos.`);
  }
  async function run(tmdbId?: number) {
    markBusy(true); setMessage(null);
    try {
      if (tmdbId) await apply(tmdbId);
      else {
        const result = await resolve({ data: { kind, id } });
        if (result.tmdbId) await apply(result.tmdbId);
        else {
          setCandidates(result.candidates); setSelected(null); setSaveError(""); setOpen(true);
          setMessage({ text: result.candidates.length ? "Há mais de uma correspondência possível. Selecione a correta." : "Não foi possível identificar este conteúdo no TMDB. Confira o título e o ano, ou use a busca manual.", error: !result.candidates.length });
        }
      }
    } catch (error) { const text = errMsg(error); setMessage({ text, error: true }); toast.error(text); }
    finally { markBusy(false); }
  }
  async function manualSearch() {
    if (!query.trim()) return;
    markBusy(true);
    try {
      const r = await search({ data: { kind, query: query.trim(), year: /^\d{4}$/.test(year) ? year : undefined, page: 1 } });
      setSelected(null);
      setCandidates(r.results.map((x) => ({ tmdb_id: x.tmdb_id, title: x.title, original_title: x.original_title, year: x.year, poster_url: x.poster_url, kind })));
      if (!r.results.length) toast.error("Nenhum resultado no TMDB para essa busca.");
    } catch (error) { toast.error(errMsg(error)); }
    finally { markBusy(false); }
  }
  return <div className="min-w-0 space-y-2">
    <Button type="button" variant="outline" size="sm" className="h-auto min-h-9 max-w-full whitespace-normal text-left" disabled={busy || disabled} onClick={() => run()}>
      {busy ? <Loader2 className="shrink-0 animate-spin" /> : <RefreshCw className="shrink-0" />}{busy ? "Buscando informações no TMDB..." : "Atualizar informações via TMDB"}
    </Button>
    {message && <p role={message.error ? "alert" : "status"} className={`max-w-xl text-xs ${message.error ? "text-destructive" : "text-muted-foreground"}`}>{message.text}</p>}
    <Dialog open={open} onOpenChange={(o) => !o && !busy && (setOpen(false), setCandidates([]), setSelected(null))}>
      <DialogContent className="max-h-[85dvh] max-w-2xl overflow-y-auto">
        <DialogHeader><DialogTitle>Selecionar correspondência no TMDB</DialogTitle><DialogDescription>{candidates.length ? "Confirme título, ano e tipo antes de atualizar este conteúdo." : "Nenhuma correspondência confiável foi encontrada. Faça uma busca manual mais ampla."}</DialogDescription></DialogHeader>
        {/* Not a <form>: this dialog is portaled inside the admin edit form and React submit events bubble through portals, which saved and closed the record. */}
        <div className="flex flex-wrap gap-2" role="search">
          <Input className="min-w-0 flex-1 basis-48" placeholder="Buscar título no TMDB" value={query} onChange={(e) => setQuery(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); e.stopPropagation(); manualSearch(); } }} />
          <Input className="w-24" inputMode="numeric" maxLength={4} placeholder="Ano" value={year} onChange={(e) => setYear(e.target.value.replace(/\D/g, ""))} onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); e.stopPropagation(); manualSearch(); } }} />
          <Button type="button" size="sm" variant="secondary" disabled={busy || !query.trim()} onClick={manualSearch}><Search /> Buscar</Button>
        </div>
        <div className="space-y-2">{candidates.map((candidate) => <div key={candidate.tmdb_id} className="flex min-w-0 flex-wrap items-center gap-3 rounded-md border border-border p-3">
          <div className="aspect-[2/3] w-12 shrink-0 overflow-hidden rounded bg-muted">{candidate.poster_url && <img src={candidate.poster_url} alt="" className="h-full w-full object-cover" loading="lazy" />}</div>
          <div className="min-w-0 flex-1"><p className="break-words text-sm font-medium">{candidate.title}</p><p className="break-words text-xs text-muted-foreground">{candidate.original_title} · {candidate.year ?? "—"} · {kind === "movie" ? "Filme" : "Série"}</p><p className="text-xs text-muted-foreground">TMDB ID {candidate.tmdb_id}</p></div>
          <Button type="button" size="sm" variant={selected === candidate.tmdb_id ? "default" : "outline"} disabled={busy} aria-pressed={selected === candidate.tmdb_id} onClick={() => setSelected(candidate.tmdb_id)}>{selected === candidate.tmdb_id ? "Selecionado" : "Selecionar"}</Button>
        </div>)}</div>
        {saveError && <p role="alert" className="text-xs text-destructive">{saveError}</p>}
        <div className="flex flex-wrap justify-end gap-2">
          <Button type="button" variant="ghost" size="sm" disabled={busy} onClick={() => { setOpen(false); setCandidates([]); setSelected(null); }}>Cancelar</Button>
          <Button type="button" size="sm" disabled={busy || !selected} onClick={confirm}>{busy ? <Loader2 className="animate-spin" /> : null} Confirmar atualização</Button>
        </div>
      </DialogContent>
    </Dialog>
  </div>;
}
export function TmdbCompleteEpisodesButton({ seriesId, seasonId, disabled, onBusyChange }: { seriesId: string; seasonId?: string; disabled?: boolean; onBusyChange?: (busy: boolean) => void }) {
  const qc = useQueryClient();
  const complete = useServerFn(tmdbCompleteSeasonEpisodes);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  return <div className="min-w-0 space-y-2">
    <Button type="button" size="sm" variant="outline" className="h-auto min-h-9 max-w-full whitespace-normal text-left" disabled={busy || disabled} onClick={async () => {
      setBusy(true); onBusyChange?.(true); setMessage("Buscando informações no TMDB...");
      let filled = 0, updated = 0, unmatched = 0; const cv = { analyzed: 0, fixed: 0, valid: 0, notFound: 0, failed: 0 };
      try {
        const { data: rows, error } = await db.from("seasons").select("id").eq("series_id", seriesId).order("season_number");
        if (error) throw error;
        const seasons = seasonId ? (rows ?? []).filter((s: { id: string }) => s.id === seasonId) : rows ?? [];
        if (!seasons.length) { setMessage("Nenhuma temporada cadastrada para atualizar."); return; }
        for (let index = 0; index < seasons.length; index++) {
          const season = seasons[index]; if (!season) continue;
          setMessage(`Buscando informações no TMDB... ${index + 1}/${seasons.length}`);
          const result = await complete({ data: { seriesId, seasonId: season.id } });
          filled += result.filled; updated += result.updated; unmatched += result.unmatched;
          for (const k of Object.keys(cv) as (keyof typeof cv)[]) cv[k] += result.covers?.[k] ?? 0;
        }
        const text = `Informações atualizadas! ${filled} campos foram preenchidos em temporadas e ${updated} episódio(s).${unmatched ? ` ${unmatched} episódio(s) sem correspondência foram preservados.` : ""} Capas: ${cv.analyzed} analisadas, ${cv.fixed} corrigidas, ${cv.valid} já válidas, ${cv.notFound} sem imagem no TMDB, ${cv.failed} falha(s).`;
        setMessage(text); toast.success(text);
      } catch (error) { const text = `${errMsg(error)}${filled ? ` ${filled} campos já foram preenchidos. Tente novamente para completar os restantes.` : ""}`; setMessage(text); toast.error(text); }
      finally { invalidate(qc); setBusy(false); onBusyChange?.(false); }
    }}>{busy ? <Loader2 className="shrink-0 animate-spin" /> : <RefreshCw className="shrink-0" />} Atualizar informações dos episódios</Button>
    {message && <p role="status" className="max-w-xl text-xs text-muted-foreground">{message}</p>}
  </div>;
}
