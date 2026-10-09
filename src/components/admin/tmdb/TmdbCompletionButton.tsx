import { useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { useQueryClient } from "@tanstack/react-query";
import { Loader2, RefreshCw } from "lucide-react";
import { toast } from "sonner";
import { tmdbRefresh, tmdbResolveContent, tmdbCompleteSeasonEpisodes } from "@/lib/tmdb/tmdb.functions";
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
export function TmdbRefreshButton({ kind, id, disabled, onDone, onBusyChange }: {
  kind: Kind; id: string; disabled?: boolean; onDone?: (result: CompletionResult) => void | Promise<void>; onBusyChange?: (busy: boolean) => void;
}) {
  const qc = useQueryClient();
  const resolve = useServerFn(tmdbResolveContent);
  const refresh = useServerFn(tmdbRefresh);
  const [busy, setBusy] = useState(false);
  const [candidates, setCandidates] = useState<MatchCandidate[]>([]);
  const [message, setMessage] = useState<{ text: string; error: boolean } | null>(null);
  const markBusy = (value: boolean) => { setBusy(value); onBusyChange?.(value); };
  async function apply(tmdbId: number) {
    const result = await refresh({ data: { kind, id, tmdbId } });
    invalidate(qc); await onDone?.(result); setCandidates([]);
    const text = `Informações atualizadas! ${result.filled} campos foram preenchidos.${result.genres ? ` ${result.genres} gênero(s) associado(s).` : ""}`;
    setMessage({ text, error: false }); toast.success(text);
  }
  async function run(tmdbId?: number) {
    markBusy(true); setMessage(null);
    try {
      if (tmdbId) await apply(tmdbId);
      else {
        const result = await resolve({ data: { kind, id } });
        if (result.tmdbId) await apply(result.tmdbId);
        else if (result.candidates.length) setCandidates(result.candidates);
        else throw new Error("Não foi possível identificar este conteúdo no TMDB. Confira o título e o ano.");
      }
    } catch (error) { const text = errMsg(error); setMessage({ text, error: true }); toast.error(text); }
    finally { markBusy(false); }
  }
  return <div className="min-w-0 space-y-2">
    <Button type="button" variant="outline" size="sm" className="h-auto min-h-9 max-w-full whitespace-normal text-left" disabled={busy || disabled} onClick={() => run()}>
      {busy ? <Loader2 className="shrink-0 animate-spin" /> : <RefreshCw className="shrink-0" />}{busy ? "Buscando informações no TMDB..." : "Atualizar informações via TMDB"}
    </Button>
    {message && <p role={message.error ? "alert" : "status"} className={`max-w-xl text-xs ${message.error ? "text-destructive" : "text-muted-foreground"}`}>{message.text}</p>}
    <Dialog open={candidates.length > 0} onOpenChange={(open) => !open && !busy && setCandidates([])}>
      <DialogContent className="max-h-[85dvh] max-w-2xl overflow-y-auto">
        <DialogHeader><DialogTitle>Selecionar correspondência no TMDB</DialogTitle><DialogDescription>Confirme o título e o ano antes de atualizar este conteúdo.</DialogDescription></DialogHeader>
        <div className="space-y-2">{candidates.map((candidate) => <div key={candidate.tmdb_id} className="flex min-w-0 flex-wrap items-center gap-3 rounded-md border border-border p-3">
          <div className="aspect-[2/3] w-12 shrink-0 overflow-hidden rounded bg-muted">{candidate.poster_url && <img src={candidate.poster_url} alt="" className="h-full w-full object-cover" loading="lazy" />}</div>
          <div className="min-w-0 flex-1"><p className="break-words text-sm font-medium">{candidate.title}</p><p className="break-words text-xs text-muted-foreground">{candidate.original_title} · {candidate.year ?? "—"}</p><p className="text-xs text-muted-foreground">TMDB ID {candidate.tmdb_id}</p></div>
          <Button type="button" size="sm" disabled={busy} onClick={() => run(candidate.tmdb_id)}>Selecionar</Button>
        </div>)}</div>
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
      let filled = 0, updated = 0, unmatched = 0;
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
        }
        const text = `Informações atualizadas! ${filled} campos foram preenchidos em temporadas e ${updated} episódio(s).${unmatched ? ` ${unmatched} episódio(s) sem correspondência foram preservados.` : ""}`;
        setMessage(text); toast.success(text);
      } catch (error) { const text = `${errMsg(error)}${filled ? ` ${filled} campos já foram preenchidos. Tente novamente para completar os restantes.` : ""}`; setMessage(text); toast.error(text); }
      finally { invalidate(qc); setBusy(false); onBusyChange?.(false); }
    }}>{busy ? <Loader2 className="shrink-0 animate-spin" /> : <RefreshCw className="shrink-0" />} Atualizar informações dos episódios</Button>
    {message && <p role="status" className="max-w-xl text-xs text-muted-foreground">{message}</p>}
  </div>;
}
