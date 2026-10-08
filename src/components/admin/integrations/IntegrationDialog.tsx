import { useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { Loader2 } from "lucide-react";
import { db, errMsg } from "@/lib/admin/db";
import { saveCredentials } from "@/lib/integrations/integrations.functions";
import { AUTH_METHODS, CACHE_OPTIONS, INTEGRATION_KINDS } from "@/lib/integrations/engine";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { kvToText, textToKv, type Integration } from "./shared";

const blank = { name: "", description: "", kind: "movie_player", base_url: "https://", auth_method: "none", auth_param: "", headers: "", params: "", default_method: "GET", priority: 1, is_active: true, rate_limit_per_minute: 30, cache_ttl_seconds: 3600, auto_fetch_player: false };

export function IntegrationDialog({ open, onOpenChange, row, onSaved }: { open: boolean; onOpenChange: (o: boolean) => void; row: Integration | null; onSaved: () => void }) {
  const [v, setV] = useState(blank);
  const [apiKey, setApiKey] = useState(""); const [token, setToken] = useState("");
  const [saving, setSaving] = useState(false);
  const saveCred = useServerFn(saveCredentials);
  useEffect(() => {
    if (!open) return;
    setApiKey(""); setToken("");
    setV(row ? { name: row.name, description: row.description ?? "", kind: row.kind, base_url: row.base_url, auth_method: row.auth_method, auth_param: row.auth_param ?? "", headers: kvToText(row.headers), params: kvToText(row.params), default_method: row.default_method, priority: row.priority, is_active: row.is_active, rate_limit_per_minute: row.rate_limit_per_minute, cache_ttl_seconds: row.cache_ttl_seconds, auto_fetch_player: row.auto_fetch_player } : blank);
  }, [open, row]);
  const set = <K extends keyof typeof v>(k: K, val: (typeof v)[K]) => setV(p => ({ ...p, [k]: val }));

  async function save(e: React.FormEvent) {
    e.preventDefault(); setSaving(true);
    try {
      const u = new URL(v.base_url.trim());
      if (u.protocol !== "https:") throw new Error("A URL base precisa começar com https://");
      const payload = { name: v.name.trim(), description: v.description.trim() || null, kind: v.kind, base_url: u.href.replace(/\/$/, ""), auth_method: v.auth_method, auth_param: v.auth_param.trim() || null, headers: textToKv(v.headers), params: textToKv(v.params), default_method: v.default_method, priority: Number(v.priority), is_active: v.is_active, rate_limit_per_minute: Number(v.rate_limit_per_minute), cache_ttl_seconds: Number(v.cache_ttl_seconds), auto_fetch_player: v.auto_fetch_player };
      const r = row ? await db.from("api_integrations").update(payload).eq("id", row.id).select("id").single() : await db.from("api_integrations").insert(payload).select("id").single();
      if (r.error) throw r.error;
      if (apiKey.trim() || token.trim()) await saveCred({ data: { integrationId: r.data.id, apiKey, token } });
      toast.success(row ? "API atualizada" : "API cadastrada");
      onSaved(); onOpenChange(false);
    } catch (err) { toast.error(errMsg(err)); } finally { setSaving(false); }
  }

  const needsParam = ["query_key", "header_key", "custom_header"].includes(v.auth_method);
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[92vh] max-w-2xl overflow-y-auto">
        <DialogHeader><DialogTitle>{row ? "Editar API" : "Adicionar API"}</DialogTitle></DialogHeader>
        <form onSubmit={save} className="grid gap-4 md:grid-cols-2">
          <div className="space-y-1.5"><Label htmlFor="i-name">Nome da API</Label><Input id="i-name" required maxLength={120} value={v.name} onChange={e => set("name", e.target.value)} /></div>
          <div className="space-y-1.5"><Label>Tipo da API</Label><Select value={v.kind} onValueChange={x => set("kind", x)}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{Object.entries(INTEGRATION_KINDS).map(([k, l]) => <SelectItem key={k} value={k}>{l}</SelectItem>)}</SelectContent></Select></div>
          <div className="space-y-1.5 md:col-span-2"><Label htmlFor="i-desc">Descrição</Label><Textarea id="i-desc" rows={2} maxLength={1000} value={v.description} onChange={e => set("description", e.target.value)} /></div>
          <div className="space-y-1.5 md:col-span-2"><Label htmlFor="i-url">URL Base</Label><Input id="i-url" required value={v.base_url} onChange={e => set("base_url", e.target.value)} placeholder="https://api.exemplo.com/v1" /><p className="text-xs text-muted-foreground">Todas as chamadas ficam presas a este domínio. Endereços internos são bloqueados.</p></div>
          <div className="space-y-1.5"><Label>Método de autenticação</Label><Select value={v.auth_method} onValueChange={x => set("auth_method", x)}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{Object.entries(AUTH_METHODS).map(([k, l]) => <SelectItem key={k} value={k}>{l}</SelectItem>)}</SelectContent></Select></div>
          {needsParam && <div className="space-y-1.5"><Label htmlFor="i-param">{v.auth_method === "query_key" ? "Nome do parâmetro" : "Nome do header"}</Label><Input id="i-param" value={v.auth_param} onChange={e => set("auth_param", e.target.value)} placeholder={v.auth_method === "query_key" ? "api_key" : "X-API-Key"} /></div>}
          {v.auth_method !== "none" && <>
            <div className="space-y-1.5"><Label htmlFor="i-key">API Key</Label><Input id="i-key" type="password" autoComplete="off" value={apiKey} onChange={e => setApiKey(e.target.value)} placeholder={row?.key_hint ?? "Cole a chave"} /></div>
            <div className="space-y-1.5"><Label htmlFor="i-token">Token</Label><Input id="i-token" type="password" autoComplete="off" value={token} onChange={e => setToken(e.target.value)} placeholder={row?.token_hint ?? "Opcional"} /></div>
            <p className="text-xs text-muted-foreground md:col-span-2">As chaves ficam guardadas no servidor e nunca voltam para a tela. Deixe em branco para manter a atual.</p>
          </>}
          <div className="space-y-1.5"><Label htmlFor="i-h">Headers personalizados</Label><Textarea id="i-h" rows={3} value={v.headers} onChange={e => set("headers", e.target.value)} placeholder={"Accept-Language=pt-BR"} className="font-mono text-xs" /></div>
          <div className="space-y-1.5"><Label htmlFor="i-p">Parâmetros personalizados</Label><Textarea id="i-p" rows={3} value={v.params} onChange={e => set("params", e.target.value)} placeholder={"language=pt-BR"} className="font-mono text-xs" /></div>
          <div className="space-y-1.5"><Label>Método HTTP padrão</Label><Select value={v.default_method} onValueChange={x => set("default_method", x)}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="GET">GET</SelectItem><SelectItem value="POST">POST</SelectItem></SelectContent></Select></div>
          <div className="space-y-1.5"><Label htmlFor="i-pr">Prioridade (1 = principal)</Label><Input id="i-pr" type="number" min={1} max={100} value={v.priority} onChange={e => set("priority", Number(e.target.value))} /></div>
          <div className="space-y-1.5"><Label>Tempo de cache</Label><Select value={String(v.cache_ttl_seconds)} onValueChange={x => set("cache_ttl_seconds", Number(x))}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{CACHE_OPTIONS.map(([s, l]) => <SelectItem key={s} value={String(s)}>{l}</SelectItem>)}</SelectContent></Select></div>
          <div className="space-y-1.5"><Label htmlFor="i-rl">Limite de requisições por minuto</Label><Input id="i-rl" type="number" min={1} max={600} value={v.rate_limit_per_minute} onChange={e => set("rate_limit_per_minute", Number(e.target.value))} /></div>
          <div className="flex flex-wrap gap-5 md:col-span-2">
            <label className="flex items-center gap-2 text-sm"><Switch checked={v.is_active} onCheckedChange={x => set("is_active", x)} /> Ativa</label>
            {v.kind === "catalog" && <label className="flex items-center gap-2 text-sm"><Switch checked={v.auto_fetch_player} onCheckedChange={x => set("auto_fetch_player", x)} /> Buscar player automaticamente ao importar</label>}
          </div>
          <DialogFooter className="md:col-span-2"><Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>Cancelar</Button><Button disabled={saving}>{saving && <Loader2 className="animate-spin" />} Salvar</Button></DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
