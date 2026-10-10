import { createFileRoute, redirect } from "@tanstack/react-router";
import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Copy, Loader2, RefreshCw } from "lucide-react";
import { db, type Row } from "@/lib/admin/db";
import { adminHead } from "@/lib/admin/head";
import { fmtDate, resellerErr } from "@/lib/resellers/shared";
import { OwnerBalance } from "@/components/admin/OwnerBalance";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

export const Route = createFileRoute("/admin/clients")({
  head: () => adminHead("Criar cliente", "Crie e gerencie acessos de clientes finais diretamente pelo painel."),
  beforeLoad: ({ context }) => { if (context.role !== "super_admin") throw redirect({ to: "/admin" }); },
  component: ClientsPage,
});

type Creds = { login: string; password: string; kind: string; expires_at: string };
const th = "px-3 py-2";
const head = "border-b border-border text-left text-xs uppercase text-muted-foreground";
const tr = "border-b border-border/60 last:border-0";
const card = "rounded-2xl border border-border bg-card";

function state(a: Row, now: number) {
  if (a.status === "revoked") return "Cancelado";
  if (a.status === "suspended") return "Bloqueado";
  return new Date(a.expires_at).getTime() <= now ? "Vencido" : "Ativo";
}

function ClientsPage() {
  const qc = useQueryClient();
  const refresh = () => qc.invalidateQueries({ queryKey: ["admin", "owner-accesses"] });
  const accs = useQuery({
    queryKey: ["admin", "owner-accesses"],
    queryFn: async () => {
      const { data, error } = await db.from("access_accounts").select("id,login,kind,duration_hours,status,created_at,expires_at")
        .is("reseller_id", null).order("created_at", { ascending: false }).limit(500);
      if (error) throw error; return data as Row[];
    },
  });
  const [kind, setKind] = useState<"normal" | "trial">("normal");
  const [hours, setHours] = useState("3");
  const [busy, setBusy] = useState(false);
  const [creds, setCreds] = useState<Creds | null>(null);
  const [filter, setFilter] = useState("");
  const [renewing, setRenewing] = useState<{ acc: Row; requestId: string } | null>(null);

  async function create() {
    if (busy) return;
    setBusy(true);
    const { data, error } = await db.rpc("create_access", { _kind: kind, _hours: kind === "trial" ? Number(hours) : null, _reseller_id: null, _note: null });
    setBusy(false);
    if (error) { toast.error(resellerErr(error)); return; }
    setCreds(data as Creds); refresh();
  }
  async function setStatus(a: Row, status: string, label: string) {
    if (status === "revoked" && !window.confirm(`Cancelar o acesso ${a.login}?`)) return;
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
  const copy = (t: string, l: string) => navigator.clipboard.writeText(t).then(() => toast.success(`${l} copiado`), () => toast.error("Não foi possível copiar"));

  const now = Date.now();
  const f = filter.trim();
  const shown = (accs.data ?? []).filter((a) => !f || a.login.includes(f));

  return (
    <div className="space-y-5">
      <div><h1 className="text-2xl font-bold md:text-3xl">Criar cliente</h1>
        <p className="text-sm text-muted-foreground">Acessos criados diretamente por você, sem revendedor.</p></div>
      <div className="grid gap-4 md:grid-cols-2">
        <OwnerBalance />
        <div className={`${card} space-y-3 p-4`}>
          <div className="grid gap-3 sm:grid-cols-2">
            <Select value={kind} onValueChange={(v) => setKind(v as "normal" | "trial")}>
              <SelectTrigger aria-label="Tipo de acesso"><SelectValue /></SelectTrigger>
              <SelectContent><SelectItem value="normal">Normal (30 dias)</SelectItem><SelectItem value="trial">Teste grátis</SelectItem></SelectContent>
            </Select>
            {kind === "trial" && <Select value={hours} onValueChange={setHours}>
              <SelectTrigger aria-label="Duração do teste"><SelectValue /></SelectTrigger>
              <SelectContent><SelectItem value="3">3 horas</SelectItem><SelectItem value="6">6 horas</SelectItem><SelectItem value="12">12 horas</SelectItem></SelectContent>
            </Select>}
          </div>
          <Button className="w-full" disabled={busy} onClick={create}>{busy && <Loader2 className="animate-spin" />}Criar acesso</Button>
        </div>
      </div>

      <Input placeholder="Buscar por login…" inputMode="numeric" value={filter} onChange={(e) => setFilter(e.target.value.replace(/\D/g, ""))} className="max-w-xs" />
      <div className={`${card} overflow-x-auto`}>
        {accs.isLoading ? <div className="flex justify-center p-10"><Loader2 className="animate-spin" /></div> : accs.error ? <p className="p-10 text-center text-destructive">{resellerErr(accs.error)}</p> : !shown.length ? <p className="p-10 text-center text-muted-foreground">Nenhum acesso.</p> : (
          <table className="w-full text-sm"><thead className={head}><tr><th className={th}>Login</th><th className={th}>Tipo</th><th className={th}>Criação</th><th className={th}>Vencimento</th><th className={th}>Status</th><th className={th}></th></tr></thead>
            <tbody>{shown.map((a) => (
              <tr key={a.id} className={tr}>
                <td className={`${th} font-mono font-semibold`}>{a.login}</td>
                <td className={th}>{a.kind === "normal" ? "30 dias" : `Teste ${a.duration_hours}h`}</td>
                <td className={`${th} whitespace-nowrap text-muted-foreground`}>{fmtDate(a.created_at)}</td>
                <td className={`${th} whitespace-nowrap`}>{fmtDate(a.expires_at)}</td>
                <td className={th}>{state(a, now)}</td>
                <td className={`${th} whitespace-nowrap text-right`}>
                  {a.kind === "normal" && a.status === "active" && <Button size="sm" variant="ghost" onClick={() => setRenewing({ acc: a, requestId: crypto.randomUUID() })}><RefreshCw />Renovar</Button>}
                  {a.status === "active" && <Button size="sm" variant="ghost" onClick={() => setStatus(a, "suspended", "Acesso bloqueado")}>Bloquear</Button>}
                  {a.status !== "active" && <Button size="sm" variant="ghost" onClick={() => setStatus(a, "active", "Acesso reativado")}>{a.status === "revoked" ? "Reativar" : "Desbloquear"}</Button>}
                  {a.status !== "revoked" && <Button size="sm" variant="ghost" className="text-destructive" onClick={() => setStatus(a, "revoked", "Acesso cancelado")}>Cancelar</Button>}
                </td>
              </tr>))}</tbody></table>)}
      </div>

      <Dialog open={!!creds} onOpenChange={(o) => !o && setCreds(null)}>
        <DialogContent>
          <DialogHeader><DialogTitle>{creds?.kind === "trial" ? "Teste criado" : "Acesso criado"}</DialogTitle></DialogHeader>
          <p className="text-sm text-muted-foreground">Copie agora: a senha não poderá ser exibida novamente.</p>
          {creds && <div className="space-y-2">
            {([["Login", creds.login], ["Senha", creds.password]] as const).map(([l, v]) => (
              <div key={l} className="flex items-center justify-between rounded-xl border border-border p-3">
                <div><p className="text-xs text-muted-foreground">{l}</p><p className="font-mono text-2xl font-bold tracking-widest">{v}</p></div>
                <Button size="icon" variant="ghost" aria-label={`Copiar ${l}`} onClick={() => copy(v, l)}><Copy /></Button>
              </div>))}
            <p className="text-sm">Vence em: <b>{fmtDate(creds.expires_at)}</b></p>
            <Button variant="outline" className="w-full" onClick={() => copy(`Login: ${creds.login}\nSenha: ${creds.password}\nVence em: ${fmtDate(creds.expires_at)}`, "Acesso")}><Copy />Copiar tudo</Button>
          </div>}
        </DialogContent>
      </Dialog>

      <Dialog open={!!renewing} onOpenChange={(o) => !o && setRenewing(null)}>
        <DialogContent>
          <DialogHeader><DialogTitle>Renovar acesso {renewing?.acc.login}</DialogTitle></DialogHeader>
          <p className="text-sm text-muted-foreground">Adiciona 30 dias {renewing && new Date(renewing.acc.expires_at).getTime() > now ? "ao vencimento atual" : "a partir de agora"}. Seus créditos são ilimitados.</p>
          <DialogFooter><Button variant="outline" onClick={() => setRenewing(null)}>Cancelar</Button><Button disabled={busy} onClick={renew}>{busy && <Loader2 className="animate-spin" />}Confirmar renovação</Button></DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
