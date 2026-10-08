import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { ArrowDown, ArrowUp, CloudDownload, Loader2, Plus, Star, Trash2 } from "lucide-react";
import { db, errMsg } from "@/lib/admin/db";
import { addPlayerSource, findPlayer } from "@/lib/integrations/integrations.functions";
import { detectPlayer } from "@/lib/integrations/engine";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { EmbedPlayer } from "@/components/site/EmbedPlayer";

type Src = { id: string; url: string; source_type: string; is_active: boolean; is_primary: boolean; sort_order: number; label: string | null; api_integration_id: string | null };
type Found = Awaited<ReturnType<typeof findPlayer>>;

/** All players of one movie or one episode (never a whole series). */
export function SourcesManager({ kind, contentId }: { kind: "movie" | "episode"; contentId: string }) {
  const qc = useQueryClient();
  const key = ["admin", "sources", kind, contentId];
  const list = useQuery({ queryKey: key, queryFn: async () => { const r = await db.from("playback_sources").select("id,url,source_type,is_active,is_primary,sort_order,label,api_integration_id").eq("content_kind", kind).eq("content_id", contentId).order("is_primary", { ascending: false }).order("sort_order").order("created_at"); if (r.error) throw r.error; return r.data as Src[]; } });
  const find = useServerFn(findPlayer); const add = useServerFn(addPlayerSource);
  const [busy, setBusy] = useState(false); const [found, setFound] = useState<Found | null>(null);
  const [manual, setManual] = useState(""); const [label, setLabel] = useState("");
  const refresh = () => { qc.invalidateQueries({ queryKey: key }); qc.invalidateQueries({ queryKey: ["player"] }); };
  const act = async (p: PromiseLike<{ error: unknown }>) => { const r = await p; if (r.error) toast.error(errMsg(r.error)); refresh(); };

  async function lookup() { setBusy(true); setFound(null); try { const r = await find({ data: { kind, contentId } }); setFound(r); if (!r.player) toast.error("Nenhuma API encontrou um player"); } catch (e) { toast.error(errMsg(e)); } finally { setBusy(false); } }
  async function save(p: { type: "embed" | "hls" | "url"; url: string }, integrationId: string | null, lbl?: string) {
    setBusy(true);
    try { const r = await add({ data: { kind, contentId, type: p.type, url: p.url, label: lbl?.trim() || null, integrationId } }); toast.success(r.duplicate ? "Esse player já estava salvo" : "Player salvo"); setFound(null); setManual(""); setLabel(""); refresh(); }
    catch (e) { toast.error(errMsg(e)); } finally { setBusy(false); }
  }
  async function move(s: Src, dir: -1 | 1) {
    const arr = [...(list.data ?? [])]; const i = arr.findIndex(x => x.id === s.id); const j = i + dir; if (j < 0 || j >= arr.length) return;
    [arr[i], arr[j]] = [arr[j]!, arr[i]!];
    await Promise.all(arr.map((x, n) => db.from("playback_sources").update({ sort_order: n }).eq("id", x.id))); refresh();
  }
  const manualPlayer = manual.trim() ? detectPlayer(manual) : null;

  return (
    <div className="space-y-3 rounded-xl border border-border p-3">
      <div className="flex flex-wrap items-center justify-between gap-2"><p className="text-sm font-medium">Players deste {kind === "movie" ? "filme" : "episódio"}</p><Button type="button" size="sm" variant="secondary" disabled={busy} onClick={lookup}>{busy ? <Loader2 className="animate-spin" /> : <CloudDownload />} Buscar Player pela API</Button></div>
      {found?.attempts.length ? <ul className="space-y-0.5 text-xs text-muted-foreground">{found.attempts.map((a, n) => <li key={n}>{n + 1}º {a.integration}: {a.ok ? "player encontrado" : a.error ?? `HTTP ${a.status}`}{a.cached && " (cache)"}</li>)}</ul> : null}
      {found?.player && <div className="space-y-2 rounded-lg border border-primary/40 bg-accent/30 p-3 text-sm">
        <p>Encontrado por <b>{found.integrationName}</b> · {found.player.type.toUpperCase()}</p><p className="break-all font-mono text-xs">{found.player.url}</p>
        {found.player.type === "embed" && <EmbedPlayer key={found.player.url} url={found.player.url} title="Prévia" preview />}
        <Button type="button" size="sm" disabled={busy} onClick={() => save(found.player!, found.integrationId)}>Salvar player</Button>
      </div>}
      {list.data?.length === 0 && <p className="text-xs text-muted-foreground">Nenhum player salvo.</p>}
      {list.data?.map((s, n) => <div key={s.id} className="flex flex-wrap items-center gap-2 rounded-lg bg-muted/30 p-2">
        <Input className="h-8 w-32" defaultValue={s.label ?? `Servidor ${n + 1}`} aria-label="Nome do player" onBlur={e => e.target.value !== (s.label ?? "") && act(db.from("playback_sources").update({ label: e.target.value.slice(0, 60) || null }).eq("id", s.id))} />
        <Badge variant="outline">{s.source_type.toUpperCase()}</Badge>{s.is_primary && <Badge>Principal</Badge>}{s.api_integration_id && <Badge variant="secondary">API</Badge>}
        <span className="min-w-0 flex-1 truncate font-mono text-xs text-muted-foreground" title={s.url}>{s.url}</span>
        <Switch checked={s.is_active} aria-label="Ativo" onCheckedChange={v => act(db.from("playback_sources").update({ is_active: v }).eq("id", s.id))} />
        {!s.is_primary && <Button type="button" size="icon" variant="ghost" aria-label="Definir como principal" onClick={() => act(db.rpc("set_primary_playback", { _source_id: s.id }))}><Star /></Button>}
        <Button type="button" size="icon" variant="ghost" aria-label="Subir" onClick={() => move(s, -1)}><ArrowUp /></Button>
        <Button type="button" size="icon" variant="ghost" aria-label="Descer" onClick={() => move(s, 1)}><ArrowDown /></Button>
        <Button type="button" size="icon" variant="ghost" aria-label="Excluir" onClick={() => confirm("Excluir este player?") && act(db.from("playback_sources").delete().eq("id", s.id))}><Trash2 /></Button>
      </div>)}
      <div className="flex flex-wrap gap-2">
        <Input className="h-9 w-32" placeholder="Nome" value={label} onChange={e => setLabel(e.target.value)} aria-label="Nome do novo player" />
        <Input className="h-9 min-w-0 flex-1" placeholder="URL ou <iframe> do player alternativo" value={manual} onChange={e => setManual(e.target.value)} aria-label="Novo player" />
        <Button type="button" size="sm" variant="outline" disabled={busy || !manualPlayer} onClick={() => manualPlayer && save(manualPlayer, null, label)}><Plus /> Adicionar player</Button>
      </div>
    </div>
  );
}
