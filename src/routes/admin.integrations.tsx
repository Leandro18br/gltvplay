import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Activity, Cable, FlaskConical, ListTree, Loader2, Pencil, Plus, Power, Trash2 } from "lucide-react";
import { db, errMsg } from "@/lib/admin/db";
import { adminHead } from "@/lib/admin/head";
import { INTEGRATION_KINDS, httpErrorLabel } from "@/lib/integrations/engine";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { IntegrationDialog } from "@/components/admin/integrations/IntegrationDialog";
import { EndpointsDialog } from "@/components/admin/integrations/EndpointsDialog";
import { TesterDialog } from "@/components/admin/integrations/TesterDialog";
import { StatusBadge, fmtDate, type Integration } from "@/components/admin/integrations/shared";

export const Route = createFileRoute("/admin/integrations")({
  head: () => adminHead("APIs e Integrações", "Cadastre, teste e use APIs externas de catálogo e de player."),
  component: IntegrationsPage,
});

function IntegrationsPage() {
  const qc = useQueryClient();
  const list = useQuery({ queryKey: ["admin", "integrations"], queryFn: async () => { const r = await db.from("api_integrations").select("*").order("kind").order("priority"); if (r.error) throw r.error; return r.data as Integration[]; } });
  const logs = useQuery({ queryKey: ["admin", "api-logs"], queryFn: async () => { const r = await db.from("api_request_logs").select("*, api_integrations(name), api_endpoints(name)").order("created_at", { ascending: false }).limit(200); if (r.error) throw r.error; return r.data as Array<{ id: string; created_at: string; content_label: string | null; http_status: number | null; duration_ms: number | null; success: boolean; cached: boolean; error: string | null; api_integrations: { name: string } | null; api_endpoints: { name: string } | null }>; } });
  const [form, setForm] = useState<{ open: boolean; row: Integration | null }>({ open: false, row: null });
  const [eps, setEps] = useState<Integration | null>(null);
  const [test, setTest] = useState<Integration | null>(null);
  const refresh = () => { qc.invalidateQueries({ queryKey: ["admin", "integrations"] }); qc.invalidateQueries({ queryKey: ["admin", "api-logs"] }); };
  const all = list.data ?? [];
  const last = all.filter(i => i.last_tested_at).sort((a, b) => b.last_tested_at!.localeCompare(a.last_tested_at!))[0];

  async function toggle(i: Integration) { const r = await db.from("api_integrations").update({ is_active: !i.is_active }).eq("id", i.id); if (r.error) toast.error(errMsg(r.error)); else refresh(); }
  async function remove(i: Integration) { if (!confirm(`Excluir a API "${i.name}"? Os endpoints e credenciais dela também serão apagados. Os players já salvos continuam.`)) return; const r = await db.from("api_integrations").delete().eq("id", i.id); if (r.error) toast.error(errMsg(r.error)); else { toast.success("API excluída"); refresh(); } }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div><h1 className="font-display text-2xl font-bold md:text-3xl">APIs e Integrações</h1><p className="text-sm text-muted-foreground">Catálogo, players de filmes e players de episódios, configurados sem mexer no código.</p></div>
        <Button className="rounded-full" onClick={() => setForm({ open: true, row: null })}><Plus /> Adicionar API</Button>
      </div>
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Card label="APIs cadastradas" value={all.length} />
        <Card label="APIs ativas" value={all.filter(i => i.is_active).length} />
        <Card label="APIs inativas" value={all.filter(i => !i.is_active).length} />
        <Card label="Requisições" value={all.reduce((s, i) => s + Number(i.request_count), 0)} />
      </div>
      {last && <p className="text-sm text-muted-foreground">Último teste: <b className="text-foreground">{last.name}</b> em {fmtDate(last.last_tested_at)}</p>}
      <Tabs defaultValue="apis">
        <TabsList><TabsTrigger value="apis"><Cable className="mr-1 size-4" />APIs</TabsTrigger><TabsTrigger value="logs"><Activity className="mr-1 size-4" />Histórico de requisições</TabsTrigger></TabsList>
        <TabsContent value="apis" className="space-y-3">
          {list.isPending && <Loader2 className="animate-spin text-primary" />}
          {list.data?.length === 0 && <div className="rounded-2xl border border-dashed border-border p-8 text-center text-sm text-muted-foreground">Nenhuma API cadastrada. Clique em "Adicionar API".</div>}
          {all.map(i => (
            <div key={i.id} className="rounded-2xl border border-border bg-card p-4">
              <div className="flex flex-wrap items-start gap-3">
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2"><h2 className="font-semibold">{i.name}</h2><StatusBadge i={i} /><Badge variant="secondary">{INTEGRATION_KINDS[i.kind]}</Badge><Badge variant="outline">Prioridade {i.priority}</Badge></div>
                  <p className="mt-1 truncate font-mono text-xs text-muted-foreground">{i.base_url}</p>
                  <p className="mt-1 text-xs text-muted-foreground">{i.request_count} requisições · último teste {fmtDate(i.last_tested_at)}{i.key_hint && <> · chave {i.key_hint}</>}</p>
                  {i.last_error && <p className="mt-1 text-xs text-destructive">Último erro: {i.last_error}</p>}
                </div>
                <div className="flex flex-wrap gap-1">
                  <Button size="sm" variant="outline" onClick={() => setTest(i)}><FlaskConical /> Testar API</Button>
                  <Button size="sm" variant="outline" onClick={() => setEps(i)}><ListTree /> Endpoints</Button>
                  <Button size="icon" variant="ghost" aria-label="Editar" onClick={() => setForm({ open: true, row: i })}><Pencil /></Button>
                  <Button size="icon" variant="ghost" aria-label={i.is_active ? "Desativar" : "Ativar"} onClick={() => toggle(i)}><Power className={i.is_active ? "text-primary" : ""} /></Button>
                  <Button size="icon" variant="ghost" aria-label="Excluir" onClick={() => remove(i)}><Trash2 /></Button>
                </div>
              </div>
            </div>
          ))}
        </TabsContent>
        <TabsContent value="logs">
          <div className="overflow-x-auto rounded-2xl border border-border">
            <table className="w-full min-w-[720px] text-sm">
              <thead className="bg-muted/40 text-left text-xs text-muted-foreground"><tr><th className="p-3">Data/hora</th><th className="p-3">API</th><th className="p-3">Endpoint</th><th className="p-3">Conteúdo</th><th className="p-3">Status</th><th className="p-3">Tempo</th><th className="p-3">Resultado</th></tr></thead>
              <tbody>{logs.data?.map(l => <tr key={l.id} className="border-t border-border">
                <td className="p-3 whitespace-nowrap">{fmtDate(l.created_at)}</td><td className="p-3">{l.api_integrations?.name ?? "—"}</td><td className="p-3">{l.api_endpoints?.name ?? "Conexão"}</td><td className="p-3">{l.content_label}</td>
                <td className="p-3">{l.http_status ?? "—"}</td><td className="p-3">{l.duration_ms} ms</td>
                <td className="p-3">{l.success ? <Badge className="rounded-full">{l.cached ? "Sucesso (cache)" : "Sucesso"}</Badge> : <span className="text-destructive">{l.error ?? httpErrorLabel(l.http_status)}</span>}</td>
              </tr>)}</tbody>
            </table>
            {logs.data?.length === 0 && <p className="p-6 text-center text-sm text-muted-foreground">Nenhuma requisição ainda.</p>}
          </div>
        </TabsContent>
      </Tabs>
      <IntegrationDialog open={form.open} row={form.row} onOpenChange={o => setForm(f => ({ ...f, open: o }))} onSaved={refresh} />
      <EndpointsDialog integration={eps} onOpenChange={o => !o && setEps(null)} />
      <TesterDialog integration={test} onOpenChange={o => !o && setTest(null)} onDone={refresh} />
    </div>
  );
}
function Card({ label, value }: { label: string; value: number }) {
  return <div className="rounded-2xl border border-border bg-card p-4"><p className="text-xs text-muted-foreground">{label}</p><p className="font-display text-2xl font-bold text-primary">{value}</p></div>;
}
