import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { CheckCircle2, Loader2, Play, XCircle } from "lucide-react";
import { db, errMsg } from "@/lib/admin/db";
import { testIntegration } from "@/lib/integrations/integrations.functions";
import { ENDPOINT_KINDS } from "@/lib/integrations/engine";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { EmbedPlayer } from "@/components/site/EmbedPlayer";
import type { Endpoint, Integration } from "./shared";

type Result = Awaited<ReturnType<typeof testIntegration>>;
const INPUTS = [["tmdb_id", "TMDB ID"], ["title", "Título"], ["year", "Ano"], ["series_id", "ID da série"], ["season", "Temporada"], ["episode", "Episódio"], ["imdb_id", "IMDb ID"]] as const;

export function TesterDialog({ integration, onOpenChange, onDone }: { integration: Integration | null; onOpenChange: (o: boolean) => void; onDone: () => void }) {
  const run = useServerFn(testIntegration);
  const eps = useQuery({ queryKey: ["admin", "api-endpoints", integration?.id], enabled: !!integration, queryFn: async () => { const r = await db.from("api_endpoints").select("*").eq("integration_id", integration!.id).order("sort_order"); if (r.error) throw r.error; return r.data as Endpoint[]; } });
  const [endpoint, setEndpoint] = useState("base");
  const [vars, setVars] = useState<Record<string, string>>({});
  const [noCache, setNoCache] = useState(true);
  const [busy, setBusy] = useState(false);
  const [res, setRes] = useState<Result | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [preview, setPreview] = useState(false);

  async function exec(e: React.FormEvent) {
    e.preventDefault(); if (!integration) return; setBusy(true); setErr(null); setRes(null); setPreview(false);
    try {
      const clean = Object.fromEntries(Object.entries({ ...vars, query: vars['title'], series_tmdb_id: vars['tmdb_id'] }).filter(([, v]) => v?.trim()));
      setRes(await run({ data: { integrationId: integration.id, ...(endpoint !== "base" ? { endpointId: endpoint } : {}), vars: clean, noCache } }));
      onDone();
    } catch (x) { setErr(errMsg(x)); } finally { setBusy(false); }
  }

  return (
    <Dialog open={!!integration} onOpenChange={o => { if (!o) { setRes(null); setErr(null); } onOpenChange(o); }}>
      <DialogContent className="max-h-[92vh] max-w-3xl overflow-y-auto">
        <DialogHeader><DialogTitle>Testar API · {integration?.name}</DialogTitle></DialogHeader>
        <form onSubmit={exec} className="grid gap-3 md:grid-cols-4">
          <div className="space-y-1.5 md:col-span-4"><Label>Endpoint</Label><Select value={endpoint} onValueChange={setEndpoint}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="base">Testar conexão (URL base)</SelectItem>{eps.data?.map(e => <SelectItem key={e.id} value={e.id}>{e.name} · {ENDPOINT_KINDS[e.kind as keyof typeof ENDPOINT_KINDS]}</SelectItem>)}</SelectContent></Select></div>
          {INPUTS.map(([k, l]) => <div key={k} className="space-y-1"><Label htmlFor={`t-${k}`} className="text-xs">{l}</Label><Input id={`t-${k}`} value={vars[k] ?? ""} onChange={e => setVars(v => ({ ...v, [k]: e.target.value }))} /></div>)}
          <label className="flex items-center gap-2 self-end text-sm"><Switch checked={noCache} onCheckedChange={setNoCache} /> Ignorar cache</label>
          <div className="md:col-span-4"><Button disabled={busy}>{busy ? <Loader2 className="animate-spin" /> : <Play />} Executar teste</Button></div>
        </form>
        {err && <p className="rounded-xl border border-destructive/40 bg-destructive/10 p-3 text-sm">{err}</p>}
        {res && <div className="space-y-3">
          <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
            <Stat label="Status HTTP" value={res.status ?? "—"} ok={res.ok} />
            <Stat label="Tempo de resposta" value={`${res.ms} ms`} />
            <Stat label="Cache" value={res.cached ? "Do cache" : "Ao vivo"} />
            <Stat label="Player encontrado" value={res.player ? "Sim" : "Não"} ok={!!res.player} />
          </div>
          {res.error && <p className="flex items-center gap-2 rounded-xl border border-destructive/40 bg-destructive/10 p-3 text-sm"><XCircle className="size-4" />{res.error}</p>}
          {res.player && <div className="space-y-2 rounded-xl border border-primary/40 bg-accent/30 p-3 text-sm">
            <p className="flex items-center gap-2"><CheckCircle2 className="size-4 text-primary" /> URL identificada ({res.player.type.toUpperCase()}):</p>
            <p className="break-all font-mono text-xs">{res.player.url}</p>
            {res.player.type === "embed" && <Button size="sm" variant="outline" onClick={() => setPreview(p => !p)}>{preview ? "Fechar prévia" : "Ver prévia"}</Button>}
            {preview && <EmbedPlayer url={res.player.url} title="Prévia" preview />}
          </div>}
          {res.items.length > 0 && <div className="grid grid-cols-3 gap-2 md:grid-cols-5">{res.items.map((i, n) => <div key={n} className="overflow-hidden rounded-lg border border-border text-xs"><div className="aspect-[2/3] bg-muted">{i.poster_url && <img src={i.poster_url} alt="" className="h-full w-full object-cover" />}</div><p className="truncate p-1.5">{i.title || `#${i.episode_number ?? i.season_number}`} {i.release_year && `(${i.release_year})`}</p></div>)}</div>}
          <details open><summary className="cursor-pointer text-sm font-medium">Resposta JSON</summary><pre className="mt-2 max-h-96 overflow-auto whitespace-pre-wrap break-all rounded-xl bg-muted p-3 text-xs">{res.json}</pre></details>
        </div>}
      </DialogContent>
    </Dialog>
  );
}
function Stat({ label, value, ok }: { label: string; value: React.ReactNode; ok?: boolean }) {
  return <div className="rounded-xl border border-border bg-card p-3"><p className="text-xs text-muted-foreground">{label}</p><p className={`font-semibold ${ok === false ? "text-destructive" : ok ? "text-primary" : ""}`}>{value}</p></div>;
}
