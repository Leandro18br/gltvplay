import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Loader2, Pencil, Plus, Trash2 } from "lucide-react";
import { db, errMsg } from "@/lib/admin/db";
import { ENDPOINT_KINDS, VARIABLES } from "@/lib/integrations/engine";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { kvToText, textToKv, type Endpoint, type Integration } from "./shared";

const FIELDS = [["title", "Título"], ["original_title", "Título original"], ["description", "Sinopse"], ["poster", "Poster"], ["backdrop", "Backdrop"], ["release_date", "Data de lançamento"], ["year", "Ano"], ["duration", "Duração"], ["rating", "Nota"], ["genres", "Gêneros"], ["external_id", "ID externo"], ["tmdb_id", "TMDB ID"], ["season_number", "Nº temporada"], ["episode_number", "Nº episódio"], ["thumbnail", "Thumbnail"]] as const;
type Form = { name: string; description: string; kind: string; method: "GET" | "POST"; path: string; headers: string; query: string; body: string; is_active: boolean; player_path: string; player_type: string; results_path: string; image_base: string; fields: Record<string, string> };

export function EndpointsDialog({ integration, onOpenChange }: { integration: Integration | null; onOpenChange: (o: boolean) => void }) {
  const qc = useQueryClient();
  const key = ["admin", "api-endpoints", integration?.id];
  const list = useQuery({ queryKey: key, enabled: !!integration, queryFn: async () => { const r = await db.from("api_endpoints").select("*").eq("integration_id", integration!.id).order("sort_order").order("created_at"); if (r.error) throw r.error; return r.data as Endpoint[]; } });
  const [edit, setEdit] = useState<Endpoint | "new" | null>(null);
  const [f, setF] = useState<Form | null>(null);
  const [saving, setSaving] = useState(false);
  const isPlayer = (k: string) => k === "movie_player" || k === "episode_player";
  useEffect(() => { if (!integration) setEdit(null); }, [integration]);
  useEffect(() => {
    if (!edit) { setF(null); return; }
    const e = edit === "new" ? null : edit; const m = (e?.mapping ?? {}) as Record<string, unknown>;
    const defKind = integration?.kind === "movie_player" ? "movie_player" : integration?.kind === "episode_player" ? "episode_player" : "search_movies";
    setF({ name: e?.name ?? "", description: e?.description ?? "", kind: e?.kind ?? defKind, method: e?.method ?? integration?.default_method ?? "GET", path: e?.path ?? "", headers: kvToText(e?.headers), query: kvToText(e?.query), body: e?.body ?? "", is_active: e?.is_active ?? true, player_path: String(m['player_path'] ?? ""), player_type: String(m['player_type'] ?? "auto"), results_path: String(m['results_path'] ?? ""), image_base: String(m['image_base'] ?? ""), fields: (m['fields'] as Record<string, string>) ?? {} });
  }, [edit, integration]);

  async function save(ev: React.FormEvent) {
    ev.preventDefault(); if (!f || !integration) return; setSaving(true);
    try {
      const mapping = isPlayer(f.kind) ? { player_path: f.player_path.trim() || undefined, player_type: f.player_type } : { results_path: f.results_path.trim() || undefined, image_base: f.image_base.trim() || undefined, fields: Object.fromEntries(Object.entries(f.fields).filter(([, v]) => v.trim())) };
      const payload = { integration_id: integration.id, name: f.name.trim(), description: f.description.trim() || null, kind: f.kind, method: f.method, path: f.path.trim(), headers: textToKv(f.headers), query: textToKv(f.query), body: f.body.trim() || null, mapping, is_active: f.is_active };
      const r = edit === "new" ? await db.from("api_endpoints").insert({ ...payload, sort_order: list.data?.length ?? 0 }) : await db.from("api_endpoints").update(payload).eq("id", (edit as Endpoint).id);
      if (r.error) throw r.error;
      toast.success("Endpoint salvo"); setEdit(null); qc.invalidateQueries({ queryKey: key });
    } catch (e) { toast.error(errMsg(e)); } finally { setSaving(false); }
  }
  async function remove(e: Endpoint) {
    if (!confirm(`Excluir o endpoint "${e.name}"?`)) return;
    const r = await db.from("api_endpoints").delete().eq("id", e.id);
    if (r.error) toast.error(errMsg(r.error)); else { toast.success("Endpoint excluído"); qc.invalidateQueries({ queryKey: key }); }
  }
  const set = <K extends keyof Form>(k: K, v: Form[K]) => setF(p => (p ? { ...p, [k]: v } : p));

  return (
    <Dialog open={!!integration} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[92vh] max-w-3xl overflow-y-auto">
        <DialogHeader><DialogTitle>Endpoints · {integration?.name}</DialogTitle></DialogHeader>
        {!f && <div className="space-y-3">
          <Button size="sm" onClick={() => setEdit("new")}><Plus /> Adicionar Endpoint</Button>
          {list.isPending && <Loader2 className="animate-spin" />}
          {list.data?.length === 0 && <p className="text-sm text-muted-foreground">Nenhum endpoint ainda.</p>}
          {list.data?.map(e => <div key={e.id} className="flex flex-wrap items-center gap-3 rounded-xl border border-border bg-card p-3">
            <div className="min-w-0 flex-1"><p className="font-medium">{e.name} {!e.is_active && <Badge variant="secondary">Inativo</Badge>}</p><p className="truncate font-mono text-xs text-muted-foreground">{e.method} {e.path || "/"}</p></div>
            <Badge variant="outline">{ENDPOINT_KINDS[e.kind as keyof typeof ENDPOINT_KINDS]}</Badge>
            <Button size="icon" variant="ghost" aria-label="Editar" onClick={() => setEdit(e)}><Pencil /></Button>
            <Button size="icon" variant="ghost" aria-label="Excluir" onClick={() => remove(e)}><Trash2 /></Button>
          </div>)}
        </div>}
        {f && <form onSubmit={save} className="grid gap-4 md:grid-cols-2">
          <div className="space-y-1.5"><Label htmlFor="e-name">Nome</Label><Input id="e-name" required value={f.name} onChange={e => set("name", e.target.value)} /></div>
          <div className="space-y-1.5"><Label>Tipo</Label><Select value={f.kind} onValueChange={v => set("kind", v)}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{Object.entries(ENDPOINT_KINDS).map(([k, l]) => <SelectItem key={k} value={k}>{l}</SelectItem>)}</SelectContent></Select></div>
          <div className="space-y-1.5 md:col-span-2"><Label htmlFor="e-desc">Descrição</Label><Input id="e-desc" value={f.description} onChange={e => set("description", e.target.value)} /></div>
          <div className="space-y-1.5"><Label>Método HTTP</Label><Select value={f.method} onValueChange={v => set("method", v as "GET" | "POST")}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="GET">GET</SelectItem><SelectItem value="POST">POST</SelectItem></SelectContent></Select></div>
          <div className="space-y-1.5"><Label htmlFor="e-path">URL/Path</Label><Input id="e-path" className="font-mono text-xs" value={f.path} onChange={e => set("path", e.target.value)} placeholder="/movie/{tmdb_id}" /></div>
          <p className="text-xs text-muted-foreground md:col-span-2">Variáveis: {VARIABLES.map(v => `{${v}}`).join(" ")}</p>
          <div className="space-y-1.5"><Label htmlFor="e-q">Query Parameters</Label><Textarea id="e-q" rows={3} className="font-mono text-xs" value={f.query} onChange={e => set("query", e.target.value)} placeholder={"query={title}\nyear={year}"} /></div>
          <div className="space-y-1.5"><Label htmlFor="e-h">Headers</Label><Textarea id="e-h" rows={3} className="font-mono text-xs" value={f.headers} onChange={e => set("headers", e.target.value)} /></div>
          {f.method === "POST" && <div className="space-y-1.5 md:col-span-2"><Label htmlFor="e-b">Body (JSON)</Label><Textarea id="e-b" rows={3} className="font-mono text-xs" value={f.body} onChange={e => set("body", e.target.value)} placeholder={'{"tmdb_id":"{tmdb_id}"}'} /></div>}
          <div className="rounded-xl border border-border p-3 md:col-span-2">
            <p className="mb-3 text-sm font-medium">Mapeamento da resposta</p>
            {isPlayer(f.kind) ? <div className="grid gap-3 md:grid-cols-2">
              <div className="space-y-1.5"><Label htmlFor="m-pp">Campo da URL do player</Label><Input id="m-pp" className="font-mono text-xs" value={f.player_path} onChange={e => set("player_path", e.target.value)} placeholder="data.player ou results[0].url" /><p className="text-xs text-muted-foreground">Vazio = procurar campos comuns (embed_url, url, player…).</p></div>
              <div className="space-y-1.5"><Label>Tipo do player</Label><Select value={f.player_type} onValueChange={v => set("player_type", v)}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="auto">Detectar automaticamente</SelectItem><SelectItem value="embed">Embed</SelectItem><SelectItem value="hls">HLS/M3U8</SelectItem><SelectItem value="url">Vídeo/URL</SelectItem></SelectContent></Select></div>
            </div> : <div className="grid gap-3 md:grid-cols-3">
              <div className="space-y-1.5"><Label htmlFor="m-rp">Lista de resultados</Label><Input id="m-rp" className="font-mono text-xs" value={f.results_path} onChange={e => set("results_path", e.target.value)} placeholder="results" /></div>
              <div className="space-y-1.5 md:col-span-2"><Label htmlFor="m-ib">Prefixo das imagens</Label><Input id="m-ib" className="font-mono text-xs" value={f.image_base} onChange={e => set("image_base", e.target.value)} placeholder="https://image.exemplo.org/w500" /></div>
              {FIELDS.map(([k, l]) => <div key={k} className="space-y-1"><Label className="text-xs" htmlFor={`m-${k}`}>{l}</Label><Input id={`m-${k}`} className="h-8 font-mono text-xs" value={f.fields[k] ?? ""} onChange={e => set("fields", { ...f.fields, [k]: e.target.value })} placeholder="padrão" /></div>)}
            </div>}
          </div>
          <label className="flex items-center gap-2 text-sm"><Switch checked={f.is_active} onCheckedChange={v => set("is_active", v)} /> Ativo</label>
          <div className="flex justify-end gap-2 md:col-span-2"><Button type="button" variant="ghost" onClick={() => setEdit(null)}>Voltar</Button><Button disabled={saving}>{saving && <Loader2 className="animate-spin" />} Salvar endpoint</Button></div>
        </form>}
      </DialogContent>
    </Dialog>
  );
}
