import { createFileRoute, redirect, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Copy, Loader2, LogOut, RefreshCw } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { db, type Row } from "@/lib/admin/db";
import { fmtDate, resellerErr, ORDER_STATUS, CONTENT_STATUS, TX_REASON } from "@/lib/resellers/shared";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

export const Route = createFileRoute("/revenda")({
  ssr: false,
  head: () => ({
    meta: [
      { title: "Painel de revenda" },
      { name: "description", content: "Gere acessos, testes e acompanhe seus créditos e pedidos." },
      { property: "og:title", content: "Painel de revenda" },
      { property: "og:description", content: "Gere acessos, testes e acompanhe seus créditos e pedidos." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
      { name: "robots", content: "noindex, nofollow" },
    ],
  }),
  beforeLoad: async () => {
    const { data } = await supabase.auth.getUser();
    if (!data.user) throw redirect({ to: "/revenda/login", search: { denied: undefined } });
    const { data: ok } = await supabase.rpc("is_active_reseller", { _user_id: data.user.id });
    if (!ok) throw redirect({ to: "/revenda/login", search: { denied: 1 } });
    return { user: data.user };
  },
  component: ResellerPanel,
});

type Creds = { login: string; password: string; kind: string; expires_at: string };
const th = "px-3 py-2";
const head = "border-b border-border text-left text-xs uppercase text-muted-foreground";
const tr = "border-b border-border/60 last:border-0";
const card = "rounded-2xl border border-border bg-card";

export function accessState(a: Row, now = Date.now()) {
  if (a.status === "revoked") return "Cancelado";
  if (a.status === "suspended") return "Bloqueado";
  return new Date(a.expires_at).getTime() <= now ? "Vencido" : "Ativo";
}

function ResellerPanel() {
  const { user } = Route.useRouteContext();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const uid = user.id;
  const refresh = () => qc.invalidateQueries({ queryKey: ["revenda"] });

  const me = useQuery({
    queryKey: ["revenda", "me"],
    queryFn: async () => { const { data, error } = await db.from("resellers").select("*").eq("user_id", uid).single(); if (error) throw error; return data as Row; },
  });
  const accs = useQuery({
    queryKey: ["revenda", "accs"],
    queryFn: async () => {
      const { data, error } = await db.from("access_accounts").select("id,login,kind,duration_hours,status,created_at,expires_at").eq("reseller_id", uid).order("created_at", { ascending: false }).limit(500);
      if (error) throw error; return data as Row[];
    },
  });
  const orders = useQuery({
    queryKey: ["revenda", "orders"],
    queryFn: async () => { const { data, error } = await db.from("credit_orders").select("*").eq("reseller_id", uid).order("created_at", { ascending: false }).limit(100); if (error) throw error; return data as Row[]; },
  });
  const content = useQuery({
    queryKey: ["revenda", "content"],
    queryFn: async () => { const { data, error } = await db.from("content_requests").select("*").eq("reseller_id", uid).order("created_at", { ascending: false }).limit(100); if (error) throw error; return data as Row[]; },
  });
  const tx = useQuery({
    queryKey: ["revenda", "tx"],
    queryFn: async () => { const { data, error } = await db.from("credit_transactions").select("*").eq("reseller_id", uid).order("created_at", { ascending: false }).limit(100); if (error) throw error; return data as Row[]; },
  });

  const [busy, setBusy] = useState(false);
  const [creds, setCreds] = useState<Creds | null>(null);
  const [trialHours, setTrialHours] = useState("3");
  const [renewing, setRenewing] = useState<{ acc: Row; requestId: string } | null>(null);
  const [filter, setFilter] = useState("");

  async function generate(kind: "normal" | "trial") {
    if (busy) return;
    setBusy(true);
    const { data, error } = await db.rpc("create_access", { _kind: kind, _hours: kind === "trial" ? Number(trialHours) : null, _reseller_id: null, _note: null });
    setBusy(false);
    if (error) { toast.error(resellerErr(error)); refresh(); return; }
    setCreds(data as Creds); refresh();
  }
  async function setStatus(a: Row, status: string, label: string) {
    if (status === "revoked" && !window.confirm(`Cancelar o acesso ${a.login}? Só o administrador poderá reativá-lo.`)) return;
    const { error } = await db.rpc("set_access_status", { _access_id: a.id, _status: status });
    if (error) toast.error(resellerErr(error)); else { toast.success(label); refresh(); }
  }
  async function renew() {
    if (!renewing || busy) return;
    setBusy(true);
    const { data, error } = await db.rpc("renew_access", { _access_id: renewing.acc.id, _request_id: renewing.requestId });
    setBusy(false);
    if (error) { toast.error(resellerErr(error)); return; }
    toast.success(`Renovado até ${fmtDate((data as Row).expires_at)}`); setRenewing(null); refresh();
  }
  async function logout() { qc.clear(); await supabase.auth.signOut(); navigate({ to: "/revenda/login", replace: true, search: { denied: undefined } }); }

  const now = Date.now();
  const list = accs.data ?? [];
  const active = list.filter((a) => accessState(a, now) === "Ativo");
  const soon = [...active].sort((a, b) => +new Date(a.expires_at) - +new Date(b.expires_at)).slice(0, 5);
  const f = filter.trim();
  const shown = f ? list.filter((a) => a.login.includes(f)) : list;

  return (
    <div className="min-h-screen bg-background">
      <header className="sticky top-0 z-30 flex h-16 items-center justify-between border-b border-border bg-background/85 px-4 backdrop-blur md:px-8">
        <div className="font-display text-lg font-bold"><span className="mr-2 text-primary">●</span> Revenda</div>
        <div className="flex min-w-0 items-center gap-2 text-sm text-muted-foreground"><span className="truncate">{me.data?.display_name ?? user.email}</span>
          <Button variant="ghost" size="icon" onClick={logout} aria-label="Sair"><LogOut /></Button></div>
      </header>
      <main className="mx-auto max-w-6xl space-y-5 p-4 md:p-8">
        <Tabs defaultValue="dash">
          <TabsList className="h-auto flex-wrap">
            <TabsTrigger value="dash">Dashboard</TabsTrigger><TabsTrigger value="new">Gerar acesso</TabsTrigger>
            <TabsTrigger value="list">Meus acessos</TabsTrigger><TabsTrigger value="orders">Pedidos</TabsTrigger>
          </TabsList>

          <TabsContent value="dash" className="space-y-4">
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
              {[["Saldo de créditos", me.data?.credits ?? "—"], ["Acessos ativos", active.filter((a) => a.kind === "normal").length], ["Testes ativos", active.filter((a) => a.kind === "trial").length]].map(([l, v]) => (
                <div key={l} className={`${card} p-5`}><p className="text-sm text-muted-foreground">{l}</p><p className="mt-1 text-3xl font-bold">{v}</p></div>))}
            </div>
            <div className="grid gap-4 lg:grid-cols-2">
              <Section title="Próximos vencimentos"><AccTable rows={soon} now={now} /></Section>
              <Section title="Últimos acessos"><AccTable rows={list.slice(0, 5)} now={now} /></Section>
              <Section title="Últimos pedidos de crédito"><Simple rows={(orders.data ?? []).slice(0, 5)} cols={[["Data", (o) => fmtDate(o.created_at)], ["Qtd.", (o) => o.quantity], ["Status", (o) => ORDER_STATUS[o.status]]]} /></Section>
              <Section title="Movimentações"><Simple rows={(tx.data ?? []).slice(0, 5)} cols={[["Data", (t) => fmtDate(t.created_at)], ["Qtd.", (t) => (t.delta > 0 ? `+${t.delta}` : t.delta)], ["Motivo", (t) => TX_REASON[t.reason] ?? t.reason]]} /></Section>
            </div>
          </TabsContent>

          <TabsContent value="new">
            <div className="grid gap-4 md:grid-cols-2">
              <div className={`${card} space-y-3 p-5`}>
                <h2 className="text-lg font-semibold">Acesso de 30 dias</h2>
                <p className="text-sm text-muted-foreground">Consome 1 crédito. Saldo atual: <b className="text-foreground">{me.data?.credits ?? "—"}</b></p>
                <Button className="w-full" disabled={busy || (me.data?.credits ?? 0) < 1} onClick={() => generate("normal")}>{busy && <Loader2 className="animate-spin" />}Gerar acesso</Button>
                {(me.data?.credits ?? 0) < 1 && <p className="text-xs text-destructive">Sem créditos. Solicite na aba Pedidos.</p>}
              </div>
              <div className={`${card} space-y-3 p-5`}>
                <h2 className="text-lg font-semibold">Teste grátis</h2>
                <p className="text-sm text-muted-foreground">Não consome créditos.</p>
                <Select value={trialHours} onValueChange={setTrialHours}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent><SelectItem value="3">3 horas</SelectItem><SelectItem value="6">6 horas</SelectItem><SelectItem value="12">12 horas</SelectItem></SelectContent>
                </Select>
                <Button variant="secondary" className="w-full" disabled={busy} onClick={() => generate("trial")}>Gerar teste</Button>
              </div>
            </div>
          </TabsContent>

          <TabsContent value="list" className="space-y-3">
            <Input placeholder="Buscar por login…" inputMode="numeric" value={filter} onChange={(e) => setFilter(e.target.value.replace(/\D/g, ""))} className="max-w-xs" />
            <div className={`${card} overflow-x-auto`}>
              {accs.isLoading ? <div className="flex justify-center p-10"><Loader2 className="animate-spin" /></div> : !shown.length ? <p className="p-10 text-center text-muted-foreground">Nenhum acesso.</p> : (
                <table className="w-full text-sm"><thead className={head}><tr><th className={th}>Login</th><th className={th}>Tipo</th><th className={th}>Criação</th><th className={th}>Vencimento</th><th className={th}>Status</th><th className={th}></th></tr></thead>
                  <tbody>{shown.map((a) => { const st = accessState(a, now); return (
                    <tr key={a.id} className={tr}>
                      <td className={`${th} font-mono font-semibold`}>{a.login}</td>
                      <td className={th}>{a.kind === "normal" ? "30 dias" : `Teste ${a.duration_hours}h`}</td>
                      <td className={`${th} whitespace-nowrap text-muted-foreground`}>{fmtDate(a.created_at)}</td>
                      <td className={`${th} whitespace-nowrap`}>{fmtDate(a.expires_at)}</td>
                      <td className={th}>{st}</td>
                      <td className={`${th} whitespace-nowrap text-right`}>
                        {a.kind === "normal" && a.status === "active" && <Button size="sm" variant="ghost" onClick={() => setRenewing({ acc: a, requestId: crypto.randomUUID() })}><RefreshCw />Renovar</Button>}
                        {a.status === "active" && <Button size="sm" variant="ghost" onClick={() => setStatus(a, "suspended", "Acesso bloqueado")}>Bloquear</Button>}
                        {a.status === "suspended" && <Button size="sm" variant="ghost" onClick={() => setStatus(a, "active", "Acesso reativado")}>Desbloquear</Button>}
                        {a.status !== "revoked" && <Button size="sm" variant="ghost" className="text-destructive" onClick={() => setStatus(a, "revoked", "Acesso cancelado")}>Cancelar</Button>}
                      </td>
                    </tr>); })}</tbody></table>)}
            </div>
          </TabsContent>

          <TabsContent value="orders"><Orders orders={orders.data ?? []} content={content.data ?? []} onDone={refresh} /></TabsContent>
        </Tabs>
      </main>

      <Dialog open={!!creds} onOpenChange={(o) => !o && setCreds(null)}>
        <DialogContent>
          <DialogHeader><DialogTitle>{creds?.kind === "trial" ? "Teste gerado" : "Acesso gerado"}</DialogTitle></DialogHeader>
          <p className="text-sm text-muted-foreground">Copie agora: a senha não poderá ser exibida novamente.</p>
          {creds && <div className="space-y-2">
            {[["Login", creds.login], ["Senha", creds.password]].map(([l, v]) => (
              <div key={l} className="flex items-center justify-between rounded-xl border border-border p-3">
                <div><p className="text-xs text-muted-foreground">{l}</p><p className="font-mono text-2xl font-bold tracking-widest">{v}</p></div>
                <Button size="icon" variant="ghost" aria-label={`Copiar ${l}`} onClick={() => navigator.clipboard.writeText(v!).then(() => toast.success(`${l} copiado`))}><Copy /></Button>
              </div>))}
            <p className="text-sm">Vence em: <b>{fmtDate(creds.expires_at)}</b></p>
            <Button variant="outline" className="w-full" onClick={() => navigator.clipboard.writeText(`Login: ${creds.login}\nSenha: ${creds.password}\nVence em: ${fmtDate(creds.expires_at)}`).then(() => toast.success("Copiado"))}><Copy />Copiar tudo</Button>
          </div>}
        </DialogContent>
      </Dialog>

      <Dialog open={!!renewing} onOpenChange={(o) => !o && setRenewing(null)}>
        <DialogContent>
          <DialogHeader><DialogTitle>Renovar acesso {renewing?.acc.login}</DialogTitle></DialogHeader>
          <p className="text-sm text-muted-foreground">Consome 1 crédito e adiciona 30 dias {renewing && new Date(renewing.acc.expires_at).getTime() > now ? "ao vencimento atual" : "a partir de agora"}.</p>
          <DialogFooter><Button variant="outline" onClick={() => setRenewing(null)}>Cancelar</Button><Button disabled={busy} onClick={renew}>{busy && <Loader2 className="animate-spin" />}Confirmar renovação</Button></DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return <div className={`${card} p-4`}><h2 className="mb-3 font-semibold">{title}</h2>{children}</div>;
}
function AccTable({ rows, now }: { rows: Row[]; now: number }) {
  return <Simple rows={rows} cols={[["Login", (a) => <span className="font-mono">{a.login}</span>], ["Tipo", (a) => (a.kind === "normal" ? "30 dias" : `Teste ${a.duration_hours}h`)], ["Vence", (a) => fmtDate(a.expires_at)], ["Status", (a) => accessState(a, now)]]} />;
}
function Simple({ rows, cols }: { rows: Row[]; cols: [string, (r: Row) => React.ReactNode][] }) {
  if (!rows.length) return <p className="p-4 text-center text-sm text-muted-foreground">Nada por aqui.</p>;
  return <div className="overflow-x-auto"><table className="w-full text-sm"><thead className={head}><tr>{cols.map(([l]) => <th key={l} className={th}>{l}</th>)}</tr></thead>
    <tbody>{rows.map((r) => <tr key={r.id} className={tr}>{cols.map(([l, fn]) => <td key={l} className={th}>{fn(r)}</td>)}</tr>)}</tbody></table></div>;
}

function Orders({ orders, content, onDone }: { orders: Row[]; content: Row[]; onDone: () => void }) {
  const [qty, setQty] = useState("10");
  const [note, setNote] = useState("");
  const [c, setC] = useState({ kind: "movie", title: "", year: "", note: "" });
  const [busy, setBusy] = useState(false);
  async function askCredits() {
    const n = Number(qty);
    if (!Number.isInteger(n) || n < 1 || n > 10000) return void toast.error("Quantidade inválida.");
    setBusy(true);
    const { error } = await db.rpc("request_credits", { _quantity: n, _note: note || null });
    setBusy(false);
    if (error) toast.error(resellerErr(error)); else { toast.success("Pedido enviado"); setNote(""); onDone(); }
  }
  async function askContent() {
    if (!c.title.trim()) return void toast.error("Informe o título.");
    const year = c.year ? Number(c.year) : null;
    if (year !== null && (!Number.isInteger(year) || year < 1880 || year > 2100)) return void toast.error("Ano inválido.");
    setBusy(true);
    const { error } = await db.rpc("request_content", { _kind: c.kind, _title: c.title, _year: year, _tmdb_id: null, _note: c.note || null });
    setBusy(false);
    if (error) toast.error(resellerErr(error)); else { toast.success("Pedido enviado"); setC({ kind: c.kind, title: "", year: "", note: "" }); onDone(); }
  }
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <div className={`${card} space-y-3 p-5`}>
        <h2 className="text-lg font-semibold">Solicitar créditos</h2>
        <div className="grid grid-cols-3 gap-2">
          <div className="space-y-1.5"><Label htmlFor="cq">Quantidade</Label><Input id="cq" type="number" min={1} value={qty} onChange={(e) => setQty(e.target.value)} /></div>
          <div className="col-span-2 space-y-1.5"><Label htmlFor="cn">Observação</Label><Input id="cn" maxLength={500} value={note} onChange={(e) => setNote(e.target.value)} /></div>
        </div>
        <Button disabled={busy} onClick={askCredits}>Enviar pedido</Button>
        <Simple rows={orders} cols={[["Data", (o) => fmtDate(o.created_at)], ["Pedido", (o) => o.quantity], ["Concedido", (o) => o.granted_quantity ?? "—"], ["Status", (o) => ORDER_STATUS[o.status]]]} />
      </div>
      <div className={`${card} space-y-3 p-5`}>
        <h2 className="text-lg font-semibold">Solicitar filme ou série</h2>
        <div className="grid grid-cols-3 gap-2">
          <Select value={c.kind} onValueChange={(v) => setC({ ...c, kind: v })}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="movie">Filme</SelectItem><SelectItem value="series">Série</SelectItem></SelectContent></Select>
          <Input className="col-span-2" placeholder="Título" maxLength={200} value={c.title} onChange={(e) => setC({ ...c, title: e.target.value })} />
          <Input placeholder="Ano" inputMode="numeric" value={c.year} onChange={(e) => setC({ ...c, year: e.target.value.replace(/\D/g, "").slice(0, 4) })} />
          <Input className="col-span-2" placeholder="Observação" maxLength={500} value={c.note} onChange={(e) => setC({ ...c, note: e.target.value })} />
        </div>
        <Button disabled={busy} onClick={askContent}>Enviar pedido</Button>
        <Simple rows={content} cols={[["Data", (r) => fmtDate(r.created_at)], ["Título", (r) => r.title], ["Status", (r) => CONTENT_STATUS[r.status]]]} />
      </div>
    </div>
  );
}
