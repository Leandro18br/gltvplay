import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Loader2, Clapperboard } from "lucide-react";
import { db, errMsg } from "@/lib/admin/db";
import { MEGAEMBED_PLAYERS, buildMegaEmbedUrl } from "@/lib/integrations/megaembed";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";

export const MEGAEMBED_COLS = "megaembed_enabled,megaembed_player,megaembed_color,megaembed_movie_template,megaembed_episode_template,megaembed_json_movies_url,megaembed_json_series_url";
export type MegaEmbedSettings = { megaembed_enabled: boolean; megaembed_player: string | null; megaembed_color: string | null; megaembed_movie_template: string; megaembed_episode_template: string; megaembed_json_movies_url: string | null; megaembed_json_series_url: string | null };
export const megaEmbedQuery = { queryKey: ["admin", "megaembed"], queryFn: async () => { const r = await db.from("site_settings").select(MEGAEMBED_COLS).eq("id", 1).single(); if (r.error) throw r.error; return r.data as unknown as MegaEmbedSettings; } };

/** APIs e Integrações → Players → MegaEmbed (central configuration). */
export function MegaEmbedCard() {
  const qc = useQueryClient();
  const q = useQuery(megaEmbedQuery);
  const [v, setV] = useState<MegaEmbedSettings | null>(null);
  const [saving, setSaving] = useState(false);
  useEffect(() => { if (q.data) setV(q.data); }, [q.data]);
  if (!v) return <div className="rounded-2xl border border-border bg-card p-4"><Loader2 className="animate-spin text-primary" /></div>;
  const set = <K extends keyof MegaEmbedSettings>(k: K, val: MegaEmbedSettings[K]) => setV(p => p && ({ ...p, [k]: val }));
  let example = "";
  try { example = buildMegaEmbedUrl({ movieTemplate: v.megaembed_movie_template, episodeTemplate: v.megaembed_episode_template, player: v.megaembed_player, color: v.megaembed_color }, { kind: "episode", tmdbSeriesId: 12345, season: 1, episode: 3 }); } catch { example = "Modelo inválido"; }

  async function save() {
    setSaving(true);
    try {
      const color = v!.megaembed_color?.trim() || null;
      if (color && !/^#[0-9A-Fa-f]{3,8}$/.test(color)) throw new Error("Cor inválida. Use o formato #00BFFF");
      for (const t of [v!.megaembed_movie_template, v!.megaembed_episode_template]) if (!/^https:\/\//.test(t.trim())) throw new Error("Os modelos de URL precisam começar com https://");
      const r = await db.from("site_settings").update({ ...v!, megaembed_color: color, megaembed_movie_template: v!.megaembed_movie_template.trim(), megaembed_episode_template: v!.megaembed_episode_template.trim(), megaembed_json_movies_url: v!.megaembed_json_movies_url?.trim() || null, megaembed_json_series_url: v!.megaembed_json_series_url?.trim() || null }).eq("id", 1);
      if (r.error) throw r.error;
      toast.success("MegaEmbed salvo"); qc.invalidateQueries({ queryKey: ["admin", "megaembed"] });
    } catch (e) { toast.error(errMsg(e)); } finally { setSaving(false); }
  }

  return (
    <div className="space-y-4 rounded-2xl border border-border bg-card p-4">
      <div className="flex flex-wrap items-center gap-2"><Clapperboard className="size-5 text-primary" /><h2 className="font-semibold">MegaEmbed</h2><Badge variant="secondary">Players</Badge><Badge variant={v.megaembed_enabled ? "default" : "outline"}>{v.megaembed_enabled ? "Ativo" : "Inativo"}</Badge>
        <label className="ml-auto flex items-center gap-2 text-sm"><Switch checked={v.megaembed_enabled} onCheckedChange={x => set("megaembed_enabled", x)} /> Ativo</label></div>
      <p className="text-xs text-muted-foreground">Gera o player automaticamente pelo TMDB ID do filme, ou pelo TMDB ID da série + temporada + episódio.</p>
      <div className="grid gap-3 md:grid-cols-2">
        <div className="space-y-1.5"><Label>Player padrão do MegaEmbed</Label>
          <select className="h-9 w-full rounded-md border border-input bg-background px-2 text-sm" value={v.megaembed_player ?? ""} onChange={e => set("megaembed_player", e.target.value || null)}>
            <option value="">Padrão do MegaEmbed</option>{Object.entries(MEGAEMBED_PLAYERS).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
          </select></div>
        <div className="space-y-1.5"><Label htmlFor="me-color">Cor do Player MegaEmbed</Label>
          <div className="flex gap-2"><Input id="me-color" placeholder="#00BFFF" value={v.megaembed_color ?? ""} onChange={e => set("megaembed_color", e.target.value)} /><input type="color" aria-label="Escolher cor" className="h-9 w-10 rounded-md border border-input bg-background" value={/^#[0-9A-Fa-f]{6}$/.test(v.megaembed_color ?? "") ? v.megaembed_color! : "#00bfff"} onChange={e => set("megaembed_color", e.target.value.toUpperCase())} /></div></div>
        <div className="space-y-1.5 md:col-span-2"><Label htmlFor="me-mt">URL de filmes</Label><Input id="me-mt" className="font-mono text-xs" value={v.megaembed_movie_template} onChange={e => set("megaembed_movie_template", e.target.value)} /></div>
        <div className="space-y-1.5 md:col-span-2"><Label htmlFor="me-et">URL de episódios</Label><Input id="me-et" className="font-mono text-xs" value={v.megaembed_episode_template} onChange={e => set("megaembed_episode_template", e.target.value)} />
          <p className="text-xs text-muted-foreground">Variáveis: {"{tmdb_id}"}, {"{season}"}, {"{episode}"}. Se mudar o domínio, autorize-o em "Domínios autorizados para Embed".</p></div>
        <div className="space-y-1.5"><Label htmlFor="me-jm">API JSON de filmes (opcional)</Label><Input id="me-jm" placeholder="https://…" value={v.megaembed_json_movies_url ?? ""} onChange={e => set("megaembed_json_movies_url", e.target.value)} /></div>
        <div className="space-y-1.5"><Label htmlFor="me-js">API JSON de séries (opcional)</Label><Input id="me-js" placeholder="https://…" value={v.megaembed_json_series_url ?? ""} onChange={e => set("megaembed_json_series_url", e.target.value)} /></div>
      </div>
      <p className="text-xs text-muted-foreground">As APIs JSON ficam guardadas para uso futuro (disponibilidade e sincronização). A reprodução não depende delas e elas nunca substituem os dados do TMDB.</p>
      <p className="break-all rounded-lg bg-muted/30 p-2 font-mono text-xs">Exemplo (série 12345, T1, E3): {example}</p>
      <Button className="rounded-full" disabled={saving} onClick={save}>{saving && <Loader2 className="animate-spin" />} Salvar MegaEmbed</Button>
    </div>
  );
}
