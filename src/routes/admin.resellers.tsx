import { createFileRoute, redirect } from "@tanstack/react-router";
import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { Copy, KeyRound, Loader2, Plus, Search, Settings2 } from "lucide-react";
import { db, type Row } from "@/lib/admin/db";
import { adminHead } from "@/lib/admin/head";
import { createResellerAccount, deleteResellerAccount, resetResellerPassword, updateResellerAccount } from "@/lib/resellers/resellers.functions";
import { fmtDate, resellerErr, TX_REASON, ORDER_STATUS, CONTENT_STATUS } from "@/lib/resellers/shared";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { ConfirmDelete } from "@/components/admin/ConfirmDelete";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

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
      const { data, error } = await db.from("resellers").select("*, profiles(email,name)").neq("status", "deleted").order("created_at", { ascending: false });
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
  const [managing, setManaging] = useState<string | null>(null);
  const [sharing, setSharing] = useState<Row | null>(null);

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
                    <td className={th}><p className="font-medium">{r.display_name ?? "—"}</p><p className="text-xs text-muted-foreground">{shownEmail(r.profiles?.email)}</p></td>
                    <td className={`${th} text-muted-foreground`}>{new Date(r.created_at).toLocaleDateString("pt-BR")}</td>
                    <td className={`${th} font-semibold`}>{r.credits}</td>
                    <td className={th}>{r.status === "active" ? "Ativo" : <span className="text-destructive">Bloqueado</span>}</td>
                    <td className={`${th} text-right`}><div className="flex flex-wrap justify-end gap-1">
                      <Button size="sm" variant="ghost" onClick={() => setSharing(r)}><KeyRound />Ver acesso</Button>
                      <Button size="sm" variant="ghost" onClick={() => setManaging(r.user_id)}><Settings2 />Gerenciar</Button>
                      {r.status === "active"
                        ? <Button size="sm" variant="outline" onClick={() => setStatus(r, "suspended")}>Bloquear</Button>
                        : <Button size="sm" onClick={() => setStatus(r, "active")}>Desbloquear</Button>}
                    </div></td>
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
                    <td className={th}>{c.resellers?.display_name ?? "—"}<p className="text-xs text-muted-foreground">{shownEmail(c.resellers?.profiles?.email)}</p></td>
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
      {managing && list.data?.find((r) => r.user_id === managing) && <ManageDialog row={list.data.find((r) => r.user_id === managing)!} onClose={() => setManaging(null)} onDone={refresh} onStatus={setStatus} />}
      {sharing && <AccessDialog row={sharing} onClose={() => setSharing(null)} />}
    </div>
  );
}

const shownEmail = (e?: string | null) => (e && !e.endsWith(".invalid") ? e : "Sem e-mail definido");
const hasEmail = (e?: string | null) => !!e && !e.endsWith(".invalid");

const RESELLER_LOGIN_URL = "https://content-sync-stream.lovable.app/revendedor/login";

function copy(text: string, label: string) {
  navigator.clipboard.writeText(text).then(() => toast.success(`${label} copiado`), () => toast.error("Não foi possível copiar"));
}

function shareText(name: string, email: string, password?: string) {
  return [`Olá, ${name}! Seu acesso ao painel de revenda:`, `Link: ${RESELLER_LOGIN_URL}`, `E-mail: ${email}`, ...(password ? [`Senha: ${password}`] : [])].join("\n");
}

function CopyRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-2 rounded-xl border border-border p-3">
      <div className="min-w-0"><p className="text-xs text-muted-foreground">{label}</p><p className="break-all font-mono text-sm">{value}</p></div>
      <Button size="icon" variant="outline" aria-label={`Copiar ${label}`} onClick={() => copy(value, label)}><Copy className="h-4 w-4" /></Button>
    </div>
  );
}

/** Shows the real access data of one reseller. A password appears only right after it was set. */
function AccessView({ name, email, password }: { name: string; email: string; password?: string | undefined }) {
  return (
    <div className="space-y-3">
      <CopyRow label="Nome" value={name} />
      <CopyRow label="E-mail" value={email} />
      {password && <CopyRow label="Senha" value={password} />}
      <CopyRow label="Link" value={RESELLER_LOGIN_URL} />
      {password
        ? <p className="text-sm text-muted-foreground">Envie esta senha ao revendedor agora: ela não poderá ser exibida novamente.</p>
        : <p className="text-sm text-muted-foreground">A senha não é guardada em texto e não pode ser consultada. Para enviar uma senha, use “Redefinir senha”.</p>}
      <Button className="w-full" onClick={() => copy(shareText(name, email, password), "Acesso")}><Copy className="h-4 w-4" /> Copiar informações</Button>
    </div>
  );
}

function AccessDialog({ row, onClose }: { row: Row; onClose: () => void }) {
  const reset = useServerFn(resetResellerPassword);
  const [busy, setBusy] = useState(false);
  const [pass, setPass] = useState<string>();
  const name = row.display_name ?? "—";
  const email = row.profiles?.email as string | undefined;
  async function doReset() {
    setBusy(true);
    try { const r = await reset({ data: { userId: row.user_id } }); setPass(r.password); toast.success("Nova senha definida"); }
    catch (e) { toast.error(resellerErr(e)); } finally { setBusy(false); }
  }
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[90dvh] overflow-y-auto">
        <DialogHeader><DialogTitle>Informações de acesso</DialogTitle></DialogHeader>
        {hasEmail(email)
          ? <AccessView name={name} email={email!} password={pass} />
          : <p className="text-sm text-muted-foreground">Este revendedor ainda não tem e-mail. Defina um em “Gerenciar” → Dados.</p>}
        <DialogFooter>
          {hasEmail(email) && !pass && <Button variant="outline" disabled={busy} onClick={doReset}>{busy && <Loader2 className="animate-spin" />}Redefinir senha</Button>}
          <Button variant="outline" onClick={onClose}>Fechar</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function PasswordField({ id, value, onChange }: { id: string; value: string; onChange: (v: string) => void }) {
  return (
    <div className="space-y-1.5">
      <Label htmlFor={id}>Senha (opcional)</Label>
      <Input id={id} type="text" autoComplete="new-password" placeholder="Em branco = gerar senha forte" value={value} onChange={(e) => onChange(e.target.value)} />
      <p className="text-xs text-muted-foreground">Mínimo de 10 caracteres. Senhas comuns ou vazadas são recusadas.</p>
    </div>
  );
}

const emailOk = (e: string) => /^\S+@\S+\.\S+$/.test(e.trim());

function CreateDialog({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const create = useServerFn(createResellerAccount);
  const [f, setF] = useState({ name: "", email: "", password: "", credits: "0" });
  const [busy, setBusy] = useState(false);
  const [creds, setCreds] = useState<{ email: string; password: string } | null>(null);
  async function submit() {
    if (busy) return;
    if (f.name.trim().length < 2) return void toast.error("Informe o nome.");
    if (!emailOk(f.email)) return void toast.error("Informe um e-mail válido.");
    if (f.password && f.password.length < 10) return void toast.error("A senha precisa de pelo menos 10 caracteres.");
    const credits = Number(f.credits || 0);
    if (!Number.isInteger(credits) || credits < 0) return void toast.error("Saldo inicial inválido.");
    setBusy(true);
    try {
      const r = await create({ data: { name: f.name, email: f.email, password: f.password || undefined, credits } });
      if (r.warning) toast.warning(r.warning); else toast.success("Revendedor cadastrado");
      setCreds({ email: r.email, password: r.password });
      onDone();
    } catch (e) { toast.error(resellerErr(e)); } finally { setBusy(false); }
  }
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement>) => setF({ ...f, [k]: e.target.value });
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[90dvh] overflow-y-auto">
        <DialogHeader><DialogTitle>{creds ? "Revendedor criado" : "Novo revendedor"}</DialogTitle></DialogHeader>
        {creds ? (<><AccessView name={f.name.trim()} {...creds} /><DialogFooter><Button variant="outline" onClick={onClose}>Fechar</Button></DialogFooter></>) : (<>
          <div className="space-y-1.5"><Label htmlFor="rn">Nome</Label><Input id="rn" maxLength={120} value={f.name} onChange={set("name")} /></div>
          <div className="space-y-1.5"><Label htmlFor="re">E-mail</Label><Input id="re" type="email" value={f.email} onChange={set("email")} /></div>
          <PasswordField id="rp" value={f.password} onChange={(v) => setF({ ...f, password: v })} />
          <div className="space-y-1.5"><Label htmlFor="rc">Saldo inicial</Label><Input id="rc" type="number" min={0} value={f.credits} onChange={set("credits")} /></div>
          <DialogFooter><Button variant="outline" onClick={onClose}>Cancelar</Button><Button disabled={busy} onClick={submit}>{busy && <Loader2 className="animate-spin" />}Cadastrar</Button></DialogFooter>
        </>)}
      </DialogContent>
    </Dialog>
  );
}

function ManageDialog({ row, onClose, onDone, onStatus }: { row: Row; onClose: () => void; onDone: () => void; onStatus: (r: Row, s: string) => Promise<void> }) {
  const qc = useQueryClient();
  const update = useServerFn(updateResellerAccount);
  const reset = useServerFn(resetResellerPassword);
  const del = useServerFn(deleteResellerAccount);
  const [name, setName] = useState<string>(row.display_name ?? "");
  const [email, setEmail] = useState<string>(hasEmail(row.profiles?.email) ? row.profiles.email : "");
  const [pass, setPass] = useState("");
  const [newPass, setNewPass] = useState<string>();
  const [amount, setAmount] = useState("1");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [confirmDel, setConfirmDel] = useState(false);
  const [reqId, setReqId] = useState(() => crypto.randomUUID());

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
      const ids = [...new Set((tx.data as Row[]).map((t) => t.actor_id).filter(Boolean))];
      const { data: ps } = ids.length ? await db.from("profiles").select("id,name,email").in("id", ids) : { data: [] };
      const who = Object.fromEntries(((ps ?? []) as Row[]).map((p) => [p.id, p.name || p.email]));
      return { acc: acc.data as Row[], tx: (tx.data as Row[]).map((t) => ({ ...t, who: who[t.actor_id] ?? "—" })), ord: ord.data as Row[], cr: cr.data as Row[] };
    },
  });
  const refreshAll = () => { onDone(); qc.invalidateQueries({ queryKey: ["admin", "resellers", "detail", row.user_id] }); };

  async function run(fn: () => Promise<unknown>, ok: string) {
    setBusy(true);
    try { await fn(); toast.success(ok); refreshAll(); return true; }
    catch (e) { toast.error(resellerErr(e)); return false; } finally { setBusy(false); }
  }
  const saveData = () => {
    if (name.trim().length < 2) return void toast.error("Informe o nome.");
    if (!emailOk(email)) return void toast.error("Informe um e-mail válido.");
    void run(() => update({ data: { userId: row.user_id, name, email } }), "Dados atualizados");
  };
  const doReset = () => {
    if (pass && pass.length < 10) return void toast.error("A senha precisa de pelo menos 10 caracteres.");
    void run(async () => { const r = await reset({ data: { userId: row.user_id, password: pass || undefined } }); setNewPass(r.password); setPass(""); }, "Senha redefinida");
  };
  const addCredits = () => {
    const n = Number(amount);
    if (!Number.isInteger(n) || n < 1 || n > 100000) return void toast.error("Informe uma quantidade inteira positiva.");
    void run(async () => {
      const { error } = await db.rpc("admin_adjust_credits", { _reseller_id: row.user_id, _delta: n, _note: note.trim() || null, _request_id: reqId });
      if (error) throw error;
      setReqId(crypto.randomUUID()); setNote(""); setAmount("1");
    }, "Créditos adicionados");
  };
  const doDelete = () => void run(() => del({ data: { userId: row.user_id } }), "Revendedor excluído").then((ok) => ok && onClose());

  const normal = d.data?.acc.filter((a) => a.kind === "normal").length ?? 0;
  const trial = d.data?.acc.filter((a) => a.kind === "trial").length ?? 0;
  const active = row.status === "active";
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[90dvh] max-w-3xl overflow-y-auto">
        <DialogHeader><DialogTitle>{row.display_name ?? "Revendedor"}</DialogTitle></DialogHeader>
        <div className="grid grid-cols-3 gap-3 text-center">
          {[["Saldo", row.credits], ["Acessos", normal], ["Testes", trial]].map(([l, v]) => (
            <div key={l} className="rounded-xl border border-border p-3"><p className="text-xs text-muted-foreground">{l}</p><p className="text-xl font-bold">{v}</p></div>))}
        </div>
        <Tabs defaultValue="data">
          <TabsList className="flex-wrap h-auto"><TabsTrigger value="data">Dados</TabsTrigger><TabsTrigger value="pass">Senha</TabsTrigger><TabsTrigger value="credits">Créditos</TabsTrigger><TabsTrigger value="acc">Clientes</TabsTrigger><TabsTrigger value="req">Pedidos</TabsTrigger></TabsList>
          <TabsContent value="data" className="space-y-4">
            <div className="space-y-1.5"><Label htmlFor="mn">Nome</Label><Input id="mn" maxLength={120} value={name} onChange={(e) => setName(e.target.value)} /></div>
            <div className="space-y-1.5"><Label htmlFor="me">E-mail de login</Label><Input id="me" type="email" value={email} onChange={(e) => setEmail(e.target.value)} /></div>
            <Button disabled={busy} onClick={saveData}>{busy && <Loader2 className="animate-spin" />}Salvar dados</Button>
            <div className="flex flex-wrap items-center gap-2 border-t border-border pt-4">
              <span className="text-sm">Status: {active ? "Ativo" : <span className="text-destructive">Bloqueado</span>}</span>
              {active
                ? <Button size="sm" variant="outline" disabled={busy} onClick={() => onStatus(row, "suspended")}>Bloquear</Button>
                : <Button size="sm" disabled={busy} onClick={() => onStatus(row, "active")}>Desbloquear</Button>}
              <Button size="sm" variant="outline" className="ml-auto text-destructive" disabled={busy} onClick={() => setConfirmDel(true)}>Excluir revendedor</Button>
            </div>
          </TabsContent>
          <TabsContent value="pass" className="space-y-4">
            {newPass && hasEmail(email)
              ? <AccessView name={name.trim()} email={email.trim().toLowerCase()} password={newPass} />
              : <>
                <p className="text-sm text-muted-foreground">A senha atual não pode ser consultada. Defina uma nova e envie ao revendedor.</p>
                <PasswordField id="mp" value={pass} onChange={setPass} />
                <Button disabled={busy || !hasEmail(row.profiles?.email)} onClick={doReset}>{busy && <Loader2 className="animate-spin" />}Redefinir senha</Button>
                {!hasEmail(row.profiles?.email) && <p className="text-xs text-destructive">Defina e salve um e-mail na aba Dados antes.</p>}
              </>}
          </TabsContent>
          <TabsContent value="credits" className="space-y-4">
            <div className="grid gap-3 sm:grid-cols-[8rem_1fr_auto] sm:items-end">
              <div className="space-y-1.5"><Label htmlFor="ca">Quantidade</Label><Input id="ca" type="number" min={1} value={amount} onChange={(e) => setAmount(e.target.value)} /></div>
              <div className="space-y-1.5"><Label htmlFor="cn">Observação</Label><Input id="cn" maxLength={300} value={note} onChange={(e) => setNote(e.target.value)} /></div>
              <Button disabled={busy} onClick={addCredits}>Adicionar créditos</Button>
            </div>
            {d.isLoading ? <Loader2 className="mx-auto animate-spin" /> : d.data && <Mini rows={d.data.tx} cols={[["Data", (t) => fmtDate(t.created_at)], ["Qtd.", (t) => (t.delta > 0 ? `+${t.delta}` : t.delta)], ["Saldo", (t) => t.balance_after], ["Por", (t) => t.who], ["Motivo", (t) => `${TX_REASON[t.reason] ?? t.reason}${t.note ? ` — ${t.note}` : ""}`]]} />}
          </TabsContent>
          <TabsContent value="acc">
            {d.isLoading ? <Loader2 className="mx-auto animate-spin" /> : d.data && <Mini rows={d.data.acc} cols={[["Login", (a) => a.login], ["Tipo", (a) => a.kind === "normal" ? "30 dias" : `Teste ${a.duration_hours}h`], ["Status", (a) => a.status], ["Expira", (a) => fmtDate(a.expires_at)]]} />}
          </TabsContent>
          <TabsContent value="req" className="space-y-4">
            {d.data && <>
              <p className="text-sm font-medium">Pedidos de crédito</p>
              <Mini rows={d.data.ord} cols={[["Data", (o) => fmtDate(o.created_at)], ["Pedido", (o) => o.quantity], ["Concedido", (o) => o.granted_quantity ?? "—"], ["Status", (o) => ORDER_STATUS[o.status] ?? o.status]]} />
              <p className="text-sm font-medium">Pedidos de conteúdo</p>
              <Mini rows={d.data.cr} cols={[["Data", (c) => fmtDate(c.created_at)], ["Título", (c) => c.title], ["Tipo", (c) => (c.kind === "movie" ? "Filme" : "Série")], ["Status", (c) => CONTENT_STATUS[c.status] ?? c.status]]} />
            </>}
          </TabsContent>
        </Tabs>
        <ConfirmDelete open={confirmDel} onOpenChange={setConfirmDel} title="Excluir revendedor?"
          description={`O login de ${row.display_name ?? "revendedor"} será desativado e ele sai da lista. Os ${d.data?.acc.length ?? 0} cliente(s), o histórico de créditos e os pedidos são mantidos. Saldo restante: ${row.credits}.`}
          onConfirm={doDelete} />
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
