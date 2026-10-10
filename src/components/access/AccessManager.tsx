import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Copy, ExternalLink, KeyRound, Loader2, RefreshCw, Settings2, Trash2, UserCheck } from "lucide-react";
import { db, type Row } from "@/lib/admin/db";
import { fmtDate, resellerErr } from "@/lib/resellers/shared";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { ConfirmDelete } from "@/components/admin/ConfirmDelete";

/** Public client login link (6-digit login, then redirects to the requested title). */
export const CLIENT_LINK = "https://content-sync-stream.lovable.app/auth?redirect=%2Ffilme%2Fsaudades-te-amo";

export type Created = { id: string; login: string; password: string; kind: string; starts_at?: string; expires_at: string };

export function accessState(a: Row, now = Date.now()) {
  if (a.status === "revoked") return "Cancelado";
  if (a.status === "suspended") return "Bloqueado";
  return new Date(a.expires_at).getTime() <= now ? "Expirado" : "Ativo";
}
const kindLabel = (a: Row) => (a.kind === "normal" ? "Normal (30 dias)" : `Teste ${a.duration_hours}h`);
const copy = (t: string, l: string) => navigator.clipboard.writeText(t).then(() => toast.success(`${l} copiado`), () => toast.error("Não foi possível copiar"));
const th = "px-3 py-2";

function StateBadge({ a, now }: { a: Row; now: number }) {
  const s = accessState(a, now);
  return <Badge variant={s === "Ativo" ? "default" : s === "Expirado" ? "secondary" : "destructive"}>{s}</Badge>;
}

/**
 * Shared access list + dialogs for the owner (ADM) and reseller panels.
 * All writes go through permission-checked RPCs; passwords exist only in memory right after
 * creation/reset and are never read back from the database.
 */
export function AccessManager({ rows, loading, owner, created, onChanged }: {
  rows: Row[]; loading?: boolean; owner: boolean; created?: Created | null; onChanged: () => void;
}) {
  const [pw, setPw] = useState<Record<string, string>>({});
  const [sel, setSel] = useState<Row | null>(null);
  const [convert, setConvert] = useState<{ acc: Row; requestId: string } | null>(null);
  const [renewing, setRenewing] = useState<{ acc: Row; requestId: string } | null>(null);
  const [del, setDel] = useState<Row | null>(null);
  const [busy, setBusy] = useState(false);
  const now = Date.now();

  useEffect(() => {
    if (!created) return;
    setPw((p) => ({ ...p, [created.id]: created.password }));
    setSel({ id: created.id, login: created.login, kind: created.kind, status: "active", created_at: created.starts_at ?? new Date().toISOString(), expires_at: created.expires_at, duration_hours: created.kind === "normal" ? 720 : Math.round((+new Date(created.expires_at) - Date.now()) / 3600000) });
  }, [created]);

  // keep the open dialog in sync with refreshed data
  const current = sel ? rows.find((r) => r.id === sel.id) ?? sel : null;

  async function run<T>(fn: () => PromiseLike<{ data: T; error: unknown }>, ok: (d: T) => void) {
    if (busy) return; setBusy(true);
    const { data, error } = await fn();
    setBusy(false);
    if (error) { toast.error(resellerErr(error)); onChanged(); return; }
    ok(data); onChanged();
  }
  const doConvert = () => convert && run(() => db.rpc("convert_trial_access", { _access_id: convert.acc.id, _request_id: convert.requestId }), (d: Row) => {
    toast.success(d.duplicate ? "Este acesso já era normal; nada foi cobrado." : `Convertido em cliente até ${fmtDate(d.expires_at)}`); setConvert(null);
  });
  const doRenew = () => renewing && run(() => db.rpc("renew_access", { _access_id: renewing.acc.id, _request_id: renewing.requestId }), (d: Row) => {
    toast.success(`Renovado até ${fmtDate(d.expires_at)}`); setRenewing(null);
  });
  const doDelete = () => del && run(() => db.rpc("delete_trial_access", { _access_id: del.id }), () => {
    toast.success("Teste excluído"); if (sel?.id === del.id) setSel(null); setDel(null);
  });
  const doReset = (a: Row) => run(() => db.rpc("reset_access_password", { _access_id: a.id }), (d: Row) => {
    setPw((p) => ({ ...p, [a.id]: d.password })); toast.success("Nova senha gerada. Copie agora.");
  });
  const setStatus = (a: Row, status: string, label: string) => {
    if (status === "revoked" && !window.confirm(`Cancelar o acesso ${a.login}?${owner ? "" : " Só o administrador poderá reativá-lo."}`)) return;
    run(() => db.rpc("set_access_status", { _access_id: a.id, _status: status }), () => toast.success(label));
  };

  const actions = (a: Row, inDialog = false) => (
    <>
      {!inDialog && <Button size="sm" variant="outline" onClick={() => setSel(a)}><Settings2 />Gerenciar</Button>}
      {a.kind === "trial" && a.status !== "revoked" && <Button size="sm" variant="ghost" onClick={() => setConvert({ acc: a, requestId: crypto.randomUUID() })}><UserCheck />Converter em cliente</Button>}
      {a.kind === "normal" && a.status === "active" && <Button size="sm" variant="ghost" onClick={() => setRenewing({ acc: a, requestId: crypto.randomUUID() })}><RefreshCw />Renovar</Button>}
      {a.kind === "trial" && <Button size="sm" variant="ghost" className="text-destructive" onClick={() => setDel(a)}><Trash2 />Excluir teste</Button>}
    </>
  );

  const a = current; const p = a ? pw[a.id] : undefined;
  const all = a ? `Acesso ao streaming\nUsuário: ${a.login}${p ? `\nSenha: ${p}` : ""}\nTipo: ${kindLabel(a)}\nVálido até: ${fmtDate(a.expires_at)}\nEntrar: ${CLIENT_LINK}` : "";

  return (
    <>
      <div className="rounded-2xl border border-border bg-card">
        {loading ? <div className="flex justify-center p-10"><Loader2 className="animate-spin" /></div> : !rows.length ? <p className="p-10 text-center text-muted-foreground">Nenhum acesso.</p> : (
          <>
            {/* mobile cards */}
            <ul className="divide-y divide-border md:hidden">
              {rows.map((r) => (
                <li key={r.id} className="space-y-2 p-4">
                  <div className="flex items-center justify-between gap-2"><span className="font-mono text-lg font-semibold">{r.login}</span><StateBadge a={r} now={now} /></div>
                  <p className="text-xs text-muted-foreground">{kindLabel(r)} · criado {fmtDate(r.created_at)}<br />expira {fmtDate(r.expires_at)}</p>
                  <div className="flex flex-wrap gap-1">{actions(r)}</div>
                </li>))}
            </ul>
            <div className="hidden overflow-x-auto md:block">
              <table className="w-full text-sm">
                <thead className="border-b border-border text-left text-xs uppercase text-muted-foreground"><tr><th className={th}>Usuário</th><th className={th}>Tipo</th><th className={th}>Criação</th><th className={th}>Expiração</th><th className={th}>Status</th><th className={th}></th></tr></thead>
                <tbody>{rows.map((r) => (
                  <tr key={r.id} className="border-b border-border/60 last:border-0">
                    <td className={`${th} font-mono font-semibold`}>{r.login}</td>
                    <td className={th}>{kindLabel(r)}</td>
                    <td className={`${th} whitespace-nowrap text-muted-foreground`}>{fmtDate(r.created_at)}</td>
                    <td className={`${th} whitespace-nowrap`}>{fmtDate(r.expires_at)}</td>
                    <td className={th}><StateBadge a={r} now={now} /></td>
                    <td className={`${th} whitespace-nowrap text-right`}>{actions(r)}</td>
                  </tr>))}</tbody>
              </table>
            </div>
          </>)}
      </div>

      <Dialog open={!!a} onOpenChange={(o) => !o && setSel(null)}>
        <DialogContent className="max-h-[100dvh] overflow-y-auto sm:max-h-[90dvh]">
          <DialogHeader><DialogTitle>Gerenciar acesso {a?.login}</DialogTitle>
            <DialogDescription>{a?.note ? a.note : a?.kind === "trial" ? "Teste gratuito" : "Cliente final"}</DialogDescription></DialogHeader>
          {a && <div className="space-y-3">
            <div className="grid grid-cols-2 gap-2 text-sm">
              <Info l="Tipo" v={kindLabel(a)} /><Info l="Status" v={<StateBadge a={a} now={now} />} />
              <Info l="Criação" v={fmtDate(a.created_at)} /><Info l="Expiração" v={fmtDate(a.expires_at)} />
            </div>
            <Field l="Usuário" v={a.login} onCopy={() => copy(a.login, "Usuário")} />
            {p ? <Field l="Senha (visível só agora)" v={p} onCopy={() => copy(p, "Senha")} /> : (
              <div className="rounded-xl border border-dashed border-border p-3 text-sm text-muted-foreground">
                A senha é guardada de forma protegida e não pode ser exibida. {a.status !== "revoked" && "Gere uma nova se precisar enviá-la ao cliente."}
              </div>)}
            {a.status !== "revoked" && <Button variant="secondary" className="w-full" disabled={busy} onClick={() => doReset(a)}><KeyRound />{p ? "Gerar outra senha" : "Redefinir senha"}</Button>}
            <div className="rounded-xl border border-border p-3">
              <p className="text-xs text-muted-foreground">Link do site</p>
              <p className="break-all text-sm">{CLIENT_LINK}</p>
              <div className="mt-2 flex gap-2">
                <Button size="sm" variant="outline" onClick={() => copy(CLIENT_LINK, "Link")}><Copy />Copiar link</Button>
                <Button size="sm" variant="outline" asChild><a href={CLIENT_LINK} target="_blank" rel="noopener noreferrer"><ExternalLink />Abrir</a></Button>
              </div>
            </div>
            <Button className="w-full" onClick={() => copy(all, "Informações de acesso")}><Copy />Copiar todas as informações</Button>
            <div className="flex flex-wrap gap-1 border-t border-border pt-3">
              {actions(a, true)}
              {a.status === "active" && <Button size="sm" variant="ghost" onClick={() => setStatus(a, "suspended", "Acesso bloqueado")}>Bloquear</Button>}
              {(a.status === "suspended" || (owner && a.status === "revoked")) && <Button size="sm" variant="ghost" onClick={() => setStatus(a, "active", "Acesso reativado")}>{a.status === "revoked" ? "Reativar" : "Desbloquear"}</Button>}
              {a.status !== "revoked" && a.kind === "normal" && <Button size="sm" variant="ghost" className="text-destructive" onClick={() => setStatus(a, "revoked", "Acesso cancelado")}>Cancelar acesso</Button>}
            </div>
          </div>}
        </DialogContent>
      </Dialog>

      <Dialog open={!!convert} onOpenChange={(o) => !o && setConvert(null)}>
        <DialogContent>
          <DialogHeader><DialogTitle>Converter teste {convert?.acc.login} em cliente</DialogTitle></DialogHeader>
          <p className="text-sm text-muted-foreground">Isso ativa um acesso <b className="text-foreground">normal de 30 dias</b> a partir de agora, mantendo o mesmo usuário e senha. {owner && !convert?.acc.reseller_id ? "Seus créditos são ilimitados." : "Será descontado 1 crédito do revendedor."} Repetir a ação não cobra novamente.</p>
          <DialogFooter><Button variant="outline" onClick={() => setConvert(null)}>Voltar</Button><Button disabled={busy} onClick={doConvert}>{busy && <Loader2 className="animate-spin" />}Confirmar conversão</Button></DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!renewing} onOpenChange={(o) => !o && setRenewing(null)}>
        <DialogContent>
          <DialogHeader><DialogTitle>Renovar acesso {renewing?.acc.login}</DialogTitle></DialogHeader>
          <p className="text-sm text-muted-foreground">Adiciona 30 dias {renewing && new Date(renewing.acc.expires_at).getTime() > now ? "ao vencimento atual" : "a partir de agora"}. {owner && !renewing?.acc.reseller_id ? "Seus créditos são ilimitados." : "Consome 1 crédito."}</p>
          <DialogFooter><Button variant="outline" onClick={() => setRenewing(null)}>Voltar</Button><Button disabled={busy} onClick={doRenew}>{busy && <Loader2 className="animate-spin" />}Confirmar renovação</Button></DialogFooter>
        </DialogContent>
      </Dialog>

      <ConfirmDelete open={!!del} onOpenChange={(o) => !o && setDel(null)} title={`Excluir teste ${del?.login ?? ""}?`}
        description="O teste será removido e o login deixará de funcionar. Outros clientes e históricos não são afetados." onConfirm={doDelete} />
    </>
  );
}

function Info({ l, v }: { l: string; v: React.ReactNode }) {
  return <div className="rounded-xl border border-border p-2.5"><p className="text-xs text-muted-foreground">{l}</p><div className="font-medium">{v}</div></div>;
}
function Field({ l, v, onCopy }: { l: string; v: string; onCopy: () => void }) {
  return (
    <div className="flex items-center justify-between rounded-xl border border-border p-3">
      <div><p className="text-xs text-muted-foreground">{l}</p><p className="font-mono text-2xl font-bold tracking-widest">{v}</p></div>
      <Button size="icon" variant="ghost" aria-label={`Copiar ${l}`} onClick={onCopy}><Copy /></Button>
    </div>
  );
}
