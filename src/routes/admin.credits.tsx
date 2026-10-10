import { createFileRoute, redirect } from "@tanstack/react-router";
import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Loader2 } from "lucide-react";
import { db, type Row } from "@/lib/admin/db";
import { adminHead } from "@/lib/admin/head";
import { fmtDate, resellerErr, TX_REASON, ORDER_STATUS } from "@/lib/resellers/shared";
import { OwnerBalance } from "@/components/admin/OwnerBalance";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";

export const Route = createFileRoute("/admin/credits")({
  head: () => adminHead("Gerenciar créditos", "Saldos, movimentações e pedidos de créditos dos revendedores."),
  beforeLoad: ({ context }) => { if (context.role !== "super_admin") throw redirect({ to: "/admin" }); },
  component: CreditsPage,
});

type Adjust = { reseller: Row; sign: 1 | -1; requestId: string };

function CreditsPage() {
  const qc = useQueryClient();
  const refresh = () => qc.invalidateQueries({ queryKey: ["admin", "resellers"] });
  const resellers = useQuery({
    queryKey: ["admin", "resellers", "list"],
    queryFn: async () => {
      const { data, error } = await db.from("resellers").select("*, profiles(email,name)").order("created_at", { ascending: false });
      if (error) throw error; return data as Row[];
    },
  });
  const tx = useQuery({
    queryKey: ["admin", "resellers", "tx"],
    queryFn: async () => {
      const { data, error } = await db.from("credit_transactions").select("*, resellers(display_name)").order("created_at", { ascending: false }).limit(200);
      if (error) throw error;
      const ids = [...new Set((data as Row[]).map((t) => t.actor_id).filter(Boolean))];
      const { data: ps } = ids.length ? await db.from("profiles").select("id,name,email").in("id", ids) : { data: [] };
      const who = new Map((ps ?? []).map((p: Row) => [p.id, p.name || p.email]));
      return (data as Row[]).map((t) => ({ ...t, actor: who.get(t.actor_id) ?? "—" }));
    },
  });
  const orders = useQuery({
    queryKey: ["admin", "resellers", "orders"],
    queryFn: async () => {
      const { data, error } = await db.from("credit_orders").select("*, resellers(display_name)").order("created_at", { ascending: false }).limit(200);
      if (error) throw error; return data as Row[];
    },
  });

  const [adj, setAdj] = useState<Adjust | null>(null);
  const [qty, setQty] = useState("1");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [decide, setDecide] = useState<{ order: Row; granted: string; note: string } | null>(null);

  function openAdjust(reseller: Row, sign: 1 | -1) { setAdj({ reseller, sign, requestId: crypto.randomUUID() }); setQty("1"); setNote(""); }
  async function submitAdjust() {
    if (!adj || busy) return;
    const n = Number(qty);
    if (!Number.isInteger(n) || n < 1) { toast.error("Quantidade inválida."); return; }
    if (adj.sign < 0 && n > adj.reseller.credits) { toast.error("Saldo insuficiente: a retirada deixaria o saldo negativo."); return; }
    setBusy(true);
    const { error } = await db.rpc("admin_adjust_credits", { _reseller_id: adj.reseller.user_id, _delta: adj.sign * n, _note: note, _request_id: adj.requestId });
    setBusy(false);
    if (error) toast.error(resellerErr(error)); else { toast.success(adj.sign > 0 ? "Créditos adicionados" : "Créditos retirados"); setAdj(null); refresh(); }
  }
  async function submitDecision(approve: boolean) {
    if (!decide || busy) return;
    const g = Number(decide.granted);
    if (approve && (!Number.isInteger(g) || g < 1)) { toast.error("Quantidade inválida."); return; }
    setBusy(true);
    const { error } = await db.rpc("decide_credit_order", { _order_id: decide.order.id, _approve: approve, _granted: approve ? g : null, _note: decide.note || null });
    setBusy(false);
    if (error) toast.error(resellerErr(error)); else { toast.success(approve ? "Pedido aprovado" : "Pedido recusado"); setDecide(null); refresh(); }
  }

  const pending = orders.data?.filter((o) => o.status === "pending").length ?? 0;
  const table = "w-full text-sm";
  const th = "px-4 py-3";
  const head = "border-b border-border text-left text-xs uppercase text-muted-foreground";
  const tr = "border-b border-border/60 last:border-0";

  return (
    <div className="space-y-5">
      <div><h1 className="text-2xl font-bold md:text-3xl">Gerenciar créditos</h1>
        <p className="text-sm text-muted-foreground">Saldos e movimentações dos revendedores.</p></div>
      <div className="max-w-sm"><OwnerBalance /></div>
      <Tabs defaultValue="balances">
        <TabsList className="flex-wrap h-auto">
          <TabsTrigger value="balances">Saldos</TabsTrigger>
          <TabsTrigger value="history">Histórico</TabsTrigger>
          <TabsTrigger value="orders">Pedidos{pending ? ` (${pending})` : ""}</TabsTrigger>
        </TabsList>
        <TabsContent value="balances">
          <div className="overflow-x-auto rounded-2xl border border-border bg-card">
            {resellers.isLoading ? <div className="flex justify-center p-12"><Loader2 className="animate-spin" /></div> : !resellers.data?.length ? <p className="p-12 text-center text-muted-foreground">Nenhum revendedor cadastrado.</p> : (
              <table className={table}><thead className={head}><tr><th className={th}>Revendedor</th><th className={th}>Status</th><th className={th}>Saldo</th><th className={th}></th></tr></thead>
                <tbody>{resellers.data.map((r) => (
                  <tr key={r.user_id} className={tr}>
                    <td className={th}><p className="font-medium">{r.display_name ?? r.profiles?.name ?? "—"}</p><p className="text-xs text-muted-foreground">{r.profiles?.email}</p></td>
                    <td className={th}>{r.status === "active" ? "Ativo" : "Bloqueado"}</td>
                    <td className={`${th} font-semibold`}>{r.credits}</td>
                    <td className={`${th} whitespace-nowrap text-right`}>
                      <Button size="sm" onClick={() => openAdjust(r, 1)}>Adicionar</Button>{" "}
                      <Button size="sm" variant="outline" disabled={r.credits < 1} onClick={() => openAdjust(r, -1)}>Retirar</Button>
                    </td>
                  </tr>))}</tbody></table>)}
          </div>
        </TabsContent>
        <TabsContent value="history">
          <div className="overflow-x-auto rounded-2xl border border-border bg-card">
            {tx.isLoading ? <div className="flex justify-center p-12"><Loader2 className="animate-spin" /></div> : !tx.data?.length ? <p className="p-12 text-center text-muted-foreground">Nenhuma movimentação.</p> : (
              <table className={table}><thead className={head}><tr><th className={th}>Data</th><th className={th}>Revendedor</th><th className={th}>Quantidade</th><th className={th}>Saldo após</th><th className={th}>Responsável</th><th className={th}>Motivo</th></tr></thead>
                <tbody>{tx.data.map((t) => (
                  <tr key={t.id} className={tr}>
                    <td className={`${th} whitespace-nowrap text-muted-foreground`}>{fmtDate(t.created_at)}</td>
                    <td className={th}>{t.resellers?.display_name ?? "—"}</td>
                    <td className={`${th} font-semibold ${t.delta > 0 ? "text-primary" : "text-destructive"}`}>{t.delta > 0 ? `+${t.delta}` : t.delta}</td>
                    <td className={th}>{t.balance_after}</td>
                    <td className={th}>{t.actor}</td>
                    <td className={th}>{TX_REASON[t.reason] ?? t.reason}{t.note ? ` — ${t.note}` : ""}</td>
                  </tr>))}</tbody></table>)}
          </div>
        </TabsContent>
        <TabsContent value="orders">
          <div className="overflow-x-auto rounded-2xl border border-border bg-card">
            {orders.isLoading ? <div className="flex justify-center p-12"><Loader2 className="animate-spin" /></div> : !orders.data?.length ? <p className="p-12 text-center text-muted-foreground">Nenhum pedido de créditos.</p> : (
              <table className={table}><thead className={head}><tr><th className={th}>Data</th><th className={th}>Revendedor</th><th className={th}>Pedido</th><th className={th}>Concedido</th><th className={th}>Status</th><th className={th}></th></tr></thead>
                <tbody>{orders.data.map((o) => (
                  <tr key={o.id} className={tr}>
                    <td className={`${th} whitespace-nowrap text-muted-foreground`}>{fmtDate(o.created_at)}</td>
                    <td className={th}>{o.resellers?.display_name ?? "—"}{o.note && <p className="text-xs text-muted-foreground">{o.note}</p>}</td>
                    <td className={th}>{o.quantity}</td>
                    <td className={th}>{o.granted_quantity ?? "—"}</td>
                    <td className={th}>{ORDER_STATUS[o.status] ?? o.status}</td>
                    <td className={`${th} text-right`}>{o.status === "pending" && <Button size="sm" onClick={() => setDecide({ order: o, granted: String(o.quantity), note: "" })}>Decidir</Button>}</td>
                  </tr>))}</tbody></table>)}
          </div>
        </TabsContent>
      </Tabs>

      <Dialog open={!!adj} onOpenChange={(o) => !o && setAdj(null)}>
        <DialogContent>
          <DialogHeader><DialogTitle>{adj?.sign === 1 ? "Adicionar créditos" : "Retirar créditos"} — {adj?.reseller.display_name}</DialogTitle></DialogHeader>
          <p className="text-sm text-muted-foreground">Saldo atual: {adj?.reseller.credits}</p>
          <div className="space-y-1.5"><Label htmlFor="q">Quantidade</Label><Input id="q" type="number" min={1} value={qty} onChange={(e) => setQty(e.target.value)} /></div>
          <div className="space-y-1.5"><Label htmlFor="n">Motivo</Label><Input id="n" maxLength={500} value={note} onChange={(e) => setNote(e.target.value)} /></div>
          <DialogFooter><Button variant="outline" onClick={() => setAdj(null)}>Cancelar</Button><Button disabled={busy} onClick={submitAdjust}>{busy && <Loader2 className="animate-spin" />}Confirmar</Button></DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!decide} onOpenChange={(o) => !o && setDecide(null)}>
        <DialogContent>
          <DialogHeader><DialogTitle>Pedido de {decide?.order.resellers?.display_name}</DialogTitle></DialogHeader>
          <p className="text-sm text-muted-foreground">Quantidade pedida: {decide?.order.quantity}</p>
          <div className="space-y-1.5"><Label htmlFor="g">Quantidade concedida</Label><Input id="g" type="number" min={1} value={decide?.granted ?? ""} onChange={(e) => decide && setDecide({ ...decide, granted: e.target.value })} /></div>
          <div className="space-y-1.5"><Label htmlFor="dn">Observação</Label><Input id="dn" maxLength={500} value={decide?.note ?? ""} onChange={(e) => decide && setDecide({ ...decide, note: e.target.value })} /></div>
          <DialogFooter><Button variant="outline" disabled={busy} onClick={() => submitDecision(false)}>Recusar</Button><Button disabled={busy} onClick={() => submitDecision(true)}>{busy && <Loader2 className="animate-spin" />}Aprovar</Button></DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
