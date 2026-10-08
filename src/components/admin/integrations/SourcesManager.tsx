import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { ArrowDown, ArrowUp, CloudDownload, Loader2, Plus, Star, Trash2 } from "lucide-react";
import { db, errMsg } from "@/lib/admin/db";
import { addPlayerSource, findPlayer } from "@/lib/integrations/integrations.functions";
import { detectPlayer } from "@/lib/integrations/engine";
import { buildMegaEmbedUrl } from "@/lib/integrations/megaembed";
import { megaEmbedQuery } from "./MegaEmbedCard";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { EmbedPlayer } from "@/components/site/EmbedPlayer";

type Src = { id: string; url: string; source_type: string; is_active: boolean; is_primary: boolean; sort_order: number; label: string | null; api_integration_id: string | null; m3u_list_id: string | null; unavailable_since: string | null };
type Found = Awaited<ReturnType<typeof findPlayer>>;

/** All players of one movie or one episode (never a whole series). */
export function SourcesManager({ kind, contentId }: { kind: "movie" | "episode"; contentId: string }) {
  const qc = useQueryClient();
  const key = ["admin", "sources", kind, contentId];
  const list = useQuery({ queryKey: key, queryFn: async () => { const r = await db.from("playback_sources").select("id,url,source_type,is_active,is_primary,sort_order,label,api_integration_id,m3u_list_id,unavailable_since").eq("content_kind", kind).eq("content_id", contentId).order("is_primary", { ascending: false }).order("sort_order").order("created_at"); if (r.error) throw r.error; return r.data as Src[]; } });
  const find = useServerFn(findPlayer); const add = useServerFn(addPlayerSource);
  const [busy, setBusy] = useState(false); const [found, setFound] = useState<Found | null>(null);
  const [manual, setManual] = useState(""); const [label, setLabel] = useState(""); const [ptype, setPtype] = useState<"auto" | "url" | "embed" | "hls">("auto"); const [adding, setAdding] = useState(false);
  const refresh = () => { qc.invalidateQueries({ queryKey: key }); qc.invalidateQueries({ queryKey: ["player"] }); };
  const act = async (p: PromiseLike<{ error: unknown }>) => { const r = await p; if (r.error) toast.error(errMsg(r.error)); refresh(); };

  async function lookup() { setBusy(true); setFound(null); try { const r = await find({ data: { kind, contentId } }); setFound(r); if (!r.player) toast.error("Nenhuma API encontrou um player"); } catch (e) { toast.error(errMsg(e)); } finally { setBusy(false); } }
  async function save(p: { type: "embed" | "hls" | "url"; url: string }, integrationId: string | null, lbl?: string) {
    setBusy(true);
    try { const r = await add({ data: { kind, contentId, type: p.type, url: p.url, label: lbl?.trim() || null, integrationId } }); toast.success(r.duplicate ? "Esse player já estava salvo" : "Player salvo"); setFound(null); setManual(""); setLabel(""); setAdding(false); refresh(); }
    catch (e) { toast.error(errMsg(e)); } finally { setBusy(false); }
  }
  async function move(s: Src, dir: -1 | 1) {
    const arr = [...(list.data ?? [])]; const i = arr.findIndex(x => x.id === s.id); const j = i + dir; if (j < 0 || j >= arr.length) return;
    [arr[i], arr[j]] = [arr[j]!, arr[i]!];
    await Promise.all(arr.map((x, n) => db.from("playback_sources").update({ sort_order: n }).eq("id", x.id))); refresh();
  }
  async function addMega() {
    setBusy(true);
    try {
      const cfg = await qc.fetchQuery(megaEmbedQuery);
      if (!cfg.megaembed_enabled) throw new Error("O MegaEmbed está inativo em APIs e Integrações");
      const base = { movieTemplate: cfg.megaembed_movie_template, episodeTemplate: cfg.megaembed_episode_template, player: cfg.megaembed_player, color: cfg.megaembed_color };
      let url: string;
      if (kind === "movie") {
        const m = await db.from("movies").select("tmdb_id").eq("id", contentId).single();
        if (m.error) throw m.error;
        if (!m.data.tmdb_id) throw new Error("Este filme não tem TMDB ID");
        url = buildMegaEmbedUrl(base, { kind: "movie", tmdbId: Number(m.data.tmdb_id) });
      } else {
        const e = await db.from("episodes").select("episode_number, seasons(season_number, series(tmdb_id))").eq("id", contentId).single();
        if (e.error) throw e.error;
        const d = e.data as unknown as { episode_number: number; seasons: { season_number: number; series: { tmdb_id: number | null } | null } | null };
        const tmdb = d.seasons?.series?.tmdb_id;
        if (!tmdb) throw new Error("A série deste episódio não tem TMDB ID");
        url = buildMegaEmbedUrl(base, { kind: "episode", tmdbSeriesId: Number(tmdb), season: d.seasons!.season_number, episode: d.episode_number });
      }
      setBusy(false);
      await save({ type: "embed", url }, null, "MegaEmbed");
    } catch (e) { toast.error(errMsg(e)); setBusy(false); }
  }
  const manualPlayer = manual.trim() ? detectPlayer(manual, ptype) : null;
  function editUrl(s: Src, raw: string) {
    if (!raw.trim() || raw.trim() === s.url) return;
    const p = detectPlayer(raw, /^<iframe/i.test(raw.trim()) ? "auto" : (s.source_type as "url" | "embed" | "hls"));
    if (!p) { toast.error("Link inválido. Use um endereço https ou um código <iframe>."); return; }
    act(db.from("playback_sources").update({ url: p.url, source_type: p.type }).eq("id", s.id));
  }

  return (
    <div className="space-y-3 rounded-xl border border-border p-3">
      <div className="flex flex-wrap items-center justify-between gap-2"><p className="text-sm font-medium">Fontes / Players {kind === "movie" ? "do filme" : "deste episódio"}</p><div className="flex flex-wrap gap-2"><Button type="button" size="sm" onClick={() => setAdding(true)}><Plus /> Adicionar fonte</Button><Button type="button" size="sm" variant="outline" disabled={busy} onClick={addMega}><Plus /> MegaEmbed</Button><Button type="button" size="sm" variant="secondary" disabled={busy} onClick={lookup}>{busy ? <Loader2 className="animate-spin" /> : <CloudDownload />} Buscar player pela API</Button></div></div>
      {found?.attempts.length ? <ul className="space-y-0.5 text-xs text-muted-foreground">{found.attempts.map((a, n) => <li key={n}>{n + 1}º {a.integration}: {a.ok ? "player encontrado" : a.error ?? `HTTP ${a.status}`}{a.cached && " (cache)"}</li>)}</ul> : null}
      {found?.player && <div className="space-y-2 rounded-lg border border-primary/40 bg-accent/30 p-3 text-sm">
        <p>Encontrado por <b>{found.integrationName}</b> · {found.player.type.toUpperCase()}</p><p className="break-all font-mono text-xs">{found.player.url}</p>
        {found.player.type === "embed" && <EmbedPlayer key={found.player.url} url={found.player.url} title="Prévia" preview />}
        <Button type="button" size="sm" disabled={busy} onClick={() => save(found.player!, found.integrationId)}>Salvar player</Button>
      </div>}
      {list.data?.length === 0 && <p className="text-xs text-muted-foreground">Nenhum player salvo.</p>}
      {list.data?.map((s, n) => <div key={s.id} className="flex flex-wrap items-center gap-2 rounded-lg bg-muted/30 p-2">
        <Input className="h-8 w-32" defaultValue={s.label ?? `Servidor ${n + 1}`} aria-label="Nome do player" onBlur={e => e.target.value !== (s.label ?? "") && act(db.from("playback_sources").update({ label: e.target.value.slice(0, 60) || null }).eq("id", s.id))} />
        <Badge variant="outline">{s.source_type.toUpperCase()}</Badge>{s.is_primary && <Badge>Principal</Badge>}{s.api_integration_id && <Badge variant="secondary">API</Badge>}{s.m3u_list_id && <Badge variant="secondary">M3U</Badge>}{s.unavailable_since && <Badge variant="outline" title="Este item não apareceu na última sincronização da lista">Indisponível na última sincronização</Badge>}
        <Input key={s.url} className="h-8 min-w-0 flex-1 font-mono text-xs" defaultValue={s.url} aria-label="URL do player" onBlur={e => editUrl(s, e.target.value)} />
        <Switch checked={s.is_active} aria-label="Ativo" onCheckedChange={v => act(db.from("playback_sources").update({ is_active: v }).eq("id", s.id))} />
        {!s.is_primary && <Button type="button" size="icon" variant="ghost" aria-label="Definir como principal" onClick={() => act(db.rpc("set_primary_playback", { _source_id: s.id }))}><Star /></Button>}
        <Button type="button" size="icon" variant="ghost" aria-label="Subir" onClick={() => move(s, -1)}><ArrowUp /></Button>
        <Button type="button" size="icon" variant="ghost" aria-label="Descer" onClick={() => move(s, 1)}><ArrowDown /></Button>
        <Button type="button" size="icon" variant="ghost" aria-label="Excluir" onClick={() => confirm("Excluir este player?") && act(db.from("playback_sources").delete().eq("id", s.id))}><Trash2 /></Button>
      </div>)}
      {(adding || list.data?.length === 0) && <div className="flex flex-wrap gap-2 rounded-lg border border-dashed border-border p-2">
        <select className="h-9 rounded-md border border-input bg-background px-2 text-sm" value={ptype} onChange={e => setPtype(e.target.value as typeof ptype)} aria-label="Tipo da fonte">
          <option value="auto">Tipo automático</option><option value="url">URL de vídeo</option><option value="embed">Embed / Iframe</option><option value="hls">HLS / M3U8</option>
        </select>
        <Input className="h-9 w-32" placeholder="Nome da fonte" value={label} onChange={e => setLabel(e.target.value)} aria-label="Nome do novo player" />
        <Input className="h-9 min-w-0 flex-1" placeholder="URL do player ou código <iframe> completo" value={manual} onChange={e => setManual(e.target.value)} aria-label="Novo player" />
        <Button type="button" size="sm" variant="outline" disabled={busy || !manualPlayer} onClick={() => manualPlayer && save(manualPlayer, null, label)}><Plus /> Salvar fonte</Button>
        {manual.trim() && !manualPlayer && <p className="w-full text-xs text-destructive">Link inválido. Use um endereço https ou um código &lt;iframe&gt;.</p>}
      </div>}
    </div>
  );
}
