import { createFileRoute, redirect } from "@tanstack/react-router";
import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { Loader2, Plus, Search } from "lucide-react";
import { db, type Row } from "@/lib/admin/db";
import { adminHead } from "@/lib/admin/head";
import { createResellerAccount } from "@/lib/resellers/resellers.functions";
import { fmtDate, resellerErr, TX_REASON, ORDER_STATUS, CONTENT_STATUS } from "@/lib/resellers/shared";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { PasswordInput } from "@/components/site/PasswordInput";

export const Route = createFileRoute("/admin/resellers")({
  head: () => adminHead("Gerenciar revendedores", "Cadastro, bloqueio e consulta dos revendedores e seus pedidos."),
  beforeLoad: ({ context }) => { if (context.role !== "super_admin") throw redirect({ to: "/admin" }); },
  component: ResellersPage,
});

const th = "px-4 py-3";
const head = "border-b border-border text-left text-xs uppercase text-muted-foreground";
const tr = "border-b border-border/60 last:border-0";

function ResellersPage() {
  const qc = useQueryClient();
  const refresh = () => qc.invalidateQueries({ queryKey: ["admin", "resellers"] });
  const [q, setQ] = useState("");
  const list = useQuery({
    queryKey: ["admin", "resellers", "list"],
    queryFn: async () => {
      const { data, error } = await db.from("resellers").select("*, profiles(email,name)").order("created_at", { ascending: false });
      if (error) throw error; return data as Row[];
    },
  });
  const requests = useQuery({
    queryKey: ["admin", "resellers", "content"],
    queryFn: async () => {
      const { data, error } = await db.from("content_requests").select("*, resellers(display_name, profiles(email))").order("created_at", { ascending: false }).limit(300);
      if (error) throw error; return data as Row[];
    },
  });
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<Row | null>(null);
  const [viewing, setViewing] = useState<Row | null>(null);

  async function setStatus(r: Row, status: string) {
    const { error } = await db.rpc("admin_upsert_reseller", { _user_id: r.user_id, _display_name: r.display_name ?? r.profiles?.name ?? "", _status: status });
    if (error) toast.error(resellerErr(error)); else { toast.success(status === "active" ? "Revendedor reativado" : "Revendedor bloqueado"); refresh(); }
  }
  async function setRequestStatus(id: string, status: string) {
    const { error } = await db.rpc("set_content_request_status", { _id: id, _status: status, _note: null });
    if (error) toast.error(resellerErr(error)); else { toast.success("Pedido atualizado"); refresh(); }
  }

  const term = q.trim().toLowerCase();
  const rows = (list.data ?? []).filter((r) => !term || `${r.display_name} ${r.profiles?.email}`.toLowerCase().includes(term));

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div><h1 className="text-2xl font-bold md:text-3xl">Gerenciar revendedores</h1>
          <p className="text-sm text-muted-foreground">{list.data?.length ?? 0} revendedor(es). Cada revendedor tem conta própria, separada dos logins dos clientes.</p></div>
        <Button onClick={() => setCreating(true)}><Plus /> Novo revendedor</Button>
      </div>
      <Tabs defaultValue="list">
        <TabsList className="flex-wrap h-auto"><TabsTrigger value="list">Revendedores</TabsTrigger><TabsTrigger value="content">Pedidos de conteúdo</TabsTrigger></TabsList>
        <TabsContent value="list" className="space-y-4">
          <div className="relative rounded-2xl border border-border bg-card p-3">
            <Search className="absolute left-6 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input className="pl-9" placeholder="Buscar por nome ou e-mail…" value={q} onChange={(e) => setQ(e.target.value)} />
          </div>
          <div className="overflow-x-auto rounded-2xl border border-border bg-card">
            {list.isLoading ? <div className="flex justify-center p-12"><Loader2 className="animate-spin" /></div> : !rows.length ? <p className="p-12 text-center text-muted-foreground">Nenhum revendedor.</p> : (
              <table className="w-full text-sm"><thead className={head}><tr><th className={th}>Revendedor</th><th className={th}>Cadastro</th><th className={th}>Saldo</th><th className={th}>Status</th><th className={th}></th></tr></thead>
                <tbody>{rows.map((r) => (
                  <tr key={r.user_id} className={tr}>
                    <td className={th}><p className="font-medium">{r.display_name ?? "—"}</p><p className="text-xs text-muted-foreground">{r.profiles?.email}</p></td>
                    <td className={`${th} text-muted-foreground`}>{new Date(r.created_at).toLocaleDateString("pt-BR")}</td>
                    <td className={`${th} font-semibold`}>{r.credits}</td>
                    <td className={th}>{r.status === "active" ? "Ativo" : <span className="text-destructive">Bloqueado</span>}</td>
                    <td className={`${th} whitespace-nowrap text-right`}>
                      <Button size="sm" variant="ghost" onClick={() => setViewing(r)}>Consultar</Button>
                      <Button size="sm" variant="ghost" onClick={() => setEditing(r)}>Editar</Button>
                      {r.status === "active"
                        ? <Button size="sm" variant="outline" onClick={() => setStatus(r, "suspended")}>Bloquear</Button>
                        : <Button size="sm" onClick={() => setStatus(r, "active")}>Reativar</Button>}
                    </td>
                  </tr>))}</tbody></table>)}
          </div>
        </TabsContent>
        <TabsContent value="content">
          <div className="overflow-x-auto rounded-2xl border border-border bg-card">
            {requests.isLoading ? <div className="flex justify-center p-12"><Loader2 className="animate-spin" /></div> : !requests.data?.length ? <p className="p-12 text-center text-muted-foreground">Nenhum pedido de conteúdo.</p> : (
              <table className="w-full text-sm"><thead className={head}><tr><th className={th}>Data</th><th className={th}>Solicitante</th><th className={th}>Tipo</th><th className={th}>Título</th><th className={th}>Status</th></tr></thead>
                <tbody>{requests.data.map((c) => (
                  <tr key={c.id} className={tr}>
                    <td className={`${th} whitespace-nowrap text-muted-foreground`}>{fmtDate(c.created_at)}</td>
                    <td className={th}>{c.resellers?.display_name ?? "—"}<p className="text-xs text-muted-foreground">{c.resellers?.profiles?.email}</p></td>
                    <td className={th}>{c.kind === "movie" ? "Filme" : "Série"}</td>
                    <td className={th}><p className="font-medium">{c.title}{c.release_year ? ` (${c.release_year})` : ""}</p>{c.note && <p className="text-xs text-muted-foreground">{c.note}</p>}</td>
                    <td className={th}>
                      <Select value={c.status} onValueChange={(v) => setRequestStatus(c.id, v)}>
                        <SelectTrigger className="w-40"><SelectValue /></SelectTrigger>
                        <SelectContent>{Object.entries(CONTENT_STATUS).map(([v, l]) => <SelectItem key={v} value={v}>{l}</SelectItem>)}</SelectContent>
                      </Select>
                    </td>
                  </tr>))}</tbody></table>)}
          </div>
        </TabsContent>
      </Tabs>
      {creating && <CreateDialog onClose={() => setCreating(false)} onDone={refresh} />}
      {editing && <EditDialog row={editing} onClose={() => setEditing(null)} onDone={refresh} />}
      {viewing && <DetailsDialog row={viewing} onClose={() => setViewing(null)} />}
    </div>
  );
}

function CreateDialog({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const create = useServerFn(createResellerAccount);
  const [f, setF] = useState({ name: "", email: "", password: "", credits: "0" });
  const [busy, setBusy] = useState(false);
  async function submit() {
    if (busy) return;
    if (f.name.trim().length < 2) return void toast.error("Informe o nome.");
    if (!/^\S+@\S+\.\S+$/.test(f.email.trim())) return void toast.error("E-mail inválido.");
    if (f.password.length < 8) return void toast.error("A senha precisa ter ao menos 8 caracteres.");
    const credits = Number(f.credits || 0);
    if (!Number.isInteger(credits) || credits < 0) return void toast.error("Saldo inicial inválido.");
    setBusy(true);
    try {
      const r = await create({ data: { name: f.name, email: f.email, password: f.password, credits } });
      if ("warning" in r && r.warning) toast.warning(r.warning); else toast.success("Revendedor cadastrado");
      onDone(); onClose();
    } catch (e) { toast.error(resellerErr(e)); } finally { setBusy(false); }
  }
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement>) => setF({ ...f, [k]: e.target.value });
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader><DialogTitle>Novo revendedor</DialogTitle></DialogHeader>
        <div className="space-y-1.5"><Label htmlFor="rn">Nome</Label><Input id="rn" maxLength={120} value={f.name} onChange={set("name")} /></div>
        <div className="space-y-1.5"><Label htmlFor="re">E-mail de acesso</Label><Input id="re" type="email" maxLength={255} value={f.email} onChange={set("email")} /></div>
        <div className="space-y-1.5"><Label htmlFor="rp">Senha</Label><PasswordInput id="rp" autoComplete="new-password" maxLength={72} value={f.password} onChange={set("password")} /></div>
        <div className="space-y-1.5"><Label htmlFor="rc">Saldo inicial</Label><Input id="rc" type="number" min={0} value={f.credits} onChange={set("credits")} /></div>
        <DialogFooter><Button variant="outline" onClick={onClose}>Cancelar</Button><Button disabled={busy} onClick={submit}>{busy && <Loader2 className="animate-spin" />}Cadastrar</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function EditDialog({ row, onClose, onDone }: { row: Row; onClose: () => void; onDone: () => void }) {
  const [name, setName] = useState<string>(row.display_name ?? "");
  const [busy, setBusy] = useState(false);
  async function save() {
    if (name.trim().length < 2) return void toast.error("Informe o nome.");
    setBusy(true);
    const { error } = await db.rpc("admin_upsert_reseller", { _user_id: row.user_id, _display_name: name, _status: row.status });
    setBusy(false);
    if (error) toast.error(resellerErr(error)); else { toast.success("Revendedor atualizado"); onDone(); onClose(); }
  }
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader><DialogTitle>Editar revendedor</DialogTitle></DialogHeader>
        <p className="text-sm text-muted-foreground">{row.profiles?.email}</p>
        <div className="space-y-1.5"><Label htmlFor="en">Nome</Label><Input id="en" maxLength={120} value={name} onChange={(e) => setName(e.target.value)} /></div>
        <DialogFooter><Button variant="outline" onClick={onClose}>Cancelar</Button><Button disabled={busy} onClick={save}>Salvar</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function DetailsDialog({ row, onClose }: { row: Row; onClose: () => void }) {
  const d = useQuery({
    queryKey: ["admin", "resellers", "detail", row.user_id],
    queryFn: async () => {
      const id = row.user_id;
      const [acc, tx, ord, cr] = await Promise.all([
        db.from("access_accounts").select("id,login,kind,duration_hours,status,created_at,expires_at").eq("reseller_id", id).order("created_at", { ascending: false }).limit(100),
        db.from("credit_transactions").select("*").eq("reseller_id", id).order("created_at", { ascending: false }).limit(100),
        db.from("credit_orders").select("*").eq("reseller_id", id).order("created_at", { ascending: false }).limit(100),
        db.from("content_requests").select("*").eq("reseller_id", id).order("created_at", { ascending: false }).limit(100),
      ]);
      const err = acc.error || tx.error || ord.error || cr.error; if (err) throw err;
      return { acc: acc.data as Row[], tx: tx.data as Row[], ord: ord.data as Row[], cr: cr.data as Row[] };
    },
  });
  const normal = d.data?.acc.filter((a) => a.kind === "normal").length ?? 0;
  const trial = d.data?.acc.filter((a) => a.kind === "trial").length ?? 0;
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[90dvh] max-w-3xl overflow-y-auto">
        <DialogHeader><DialogTitle>{row.display_name}</DialogTitle></DialogHeader>
        <div className="grid grid-cols-3 gap-3 text-center">
          {[["Saldo", row.credits], ["Acessos", normal], ["Testes", trial]].map(([l, v]) => (
            <div key={l} className="rounded-xl border border-border p-3"><p className="text-xs text-muted-foreground">{l}</p><p className="text-xl font-bold">{v}</p></div>))}
        </div>
        {d.isLoading ? <div className="flex justify-center p-8"><Loader2 className="animate-spin" /></div> : d.data && (
          <Tabs defaultValue="acc">
            <TabsList className="flex-wrap h-auto"><TabsTrigger value="acc">Acessos e testes</TabsTrigger><TabsTrigger value="tx">Histórico</TabsTrigger><TabsTrigger value="ord">Pedidos de crédito</TabsTrigger><TabsTrigger value="cr">Pedidos de conteúdo</TabsTrigger></TabsList>
            <TabsContent value="acc"><Mini rows={d.data.acc} cols={[["Login", (a) => a.login], ["Tipo", (a) => a.kind === "normal" ? "30 dias" : `Teste ${a.duration_hours}h`], ["Status", (a) => a.status], ["Expira", (a) => fmtDate(a.expires_at)]]} /></TabsContent>
            <TabsContent value="tx"><Mini rows={d.data.tx} cols={[["Data", (t) => fmtDate(t.created_at)], ["Qtd.", (t) => (t.delta > 0 ? `+${t.delta}` : t.delta)], ["Saldo", (t) => t.balance_after], ["Motivo", (t) => `${TX_REASON[t.reason] ?? t.reason}${t.note ? ` — ${t.note}` : ""}`]]} /></TabsContent>
            <TabsContent value="ord"><Mini rows={d.data.ord} cols={[["Data", (o) => fmtDate(o.created_at)], ["Pedido", (o) => o.quantity], ["Concedido", (o) => o.granted_quantity ?? "—"], ["Status", (o) => ORDER_STATUS[o.status] ?? o.status]]} /></TabsContent>
            <TabsContent value="cr"><Mini rows={d.data.cr} cols={[["Data", (c) => fmtDate(c.created_at)], ["Título", (c) => c.title], ["Tipo", (c) => (c.kind === "movie" ? "Filme" : "Série")], ["Status", (c) => CONTENT_STATUS[c.status] ?? c.status]]} /></TabsContent>
          </Tabs>
        )}
      </DialogContent>
    </Dialog>
  );
}

function Mini({ rows, cols }: { rows: Row[]; cols: [string, (r: Row) => React.ReactNode][] }) {
  if (!rows.length) return <p className="p-6 text-center text-sm text-muted-foreground">Nada registrado.</p>;
  return (
    <div className="overflow-x-auto rounded-xl border border-border">
      <table className="w-full text-sm"><thead className={head}><tr>{cols.map(([l]) => <th key={l} className="px-3 py-2">{l}</th>)}</tr></thead>
        <tbody>{rows.map((r) => <tr key={r.id} className={tr}>{cols.map(([l, f]) => <td key={l} className="px-3 py-2">{f(r)}</td>)}</tr>)}</tbody></table>
    </div>
  );
}
