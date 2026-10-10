import { createFileRoute, redirect } from "@tanstack/react-router";
import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Loader2 } from "lucide-react";
import { db, type Row } from "@/lib/admin/db";
import { adminHead } from "@/lib/admin/head";
import { resellerErr } from "@/lib/resellers/shared";
import { OwnerBalance } from "@/components/admin/OwnerBalance";
import { AccessManager, type Created } from "@/components/access/AccessManager";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

export const Route = createFileRoute("/admin/clients")({
  head: () => adminHead("Criar cliente", "Crie e gerencie acessos de clientes finais diretamente pelo painel."),
  beforeLoad: ({ context }) => { if (context.role !== "super_admin") throw redirect({ to: "/admin" }); },
  component: ClientsPage,
});

function ClientsPage() {
  const qc = useQueryClient();
  const refresh = () => qc.invalidateQueries({ queryKey: ["admin", "owner-accesses"] });
  const accs = useQuery({
    queryKey: ["admin", "owner-accesses"],
    queryFn: async () => {
      const { data, error } = await db.from("access_accounts").select("id,login,kind,duration_hours,status,created_at,expires_at,note,reseller_id")
        .is("reseller_id", null).order("created_at", { ascending: false }).limit(500);
      if (error) throw error; return data as Row[];
    },
  });
  const [kind, setKind] = useState<"normal" | "trial">("normal");
  const [hours, setHours] = useState("3");
  const [busy, setBusy] = useState(false);
  const [created, setCreated] = useState<Created | null>(null);
  const [filter, setFilter] = useState("");

  async function create() {
    if (busy) return;
    setBusy(true);
    const { data, error } = await db.rpc("create_access", { _kind: kind, _hours: kind === "trial" ? Number(hours) : null, _reseller_id: null, _note: null });
    setBusy(false);
    if (error) { toast.error(resellerErr(error)); return; }
    setCreated(data as Created); refresh();
  }

  const f = filter.trim();
  const shown = (accs.data ?? []).filter((a) => !f || a.login.includes(f));

  return (
    <div className="space-y-5">
      <div><h1 className="text-2xl font-bold md:text-3xl">Criar cliente</h1>
        <p className="text-sm text-muted-foreground">Acessos e testes criados diretamente por você, sem revendedor.</p></div>
      <div className="grid gap-4 md:grid-cols-2">
        <OwnerBalance />
        <div className="space-y-3 rounded-2xl border border-border bg-card p-4">
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
          <Button className="w-full" disabled={busy} onClick={create}>{busy && <Loader2 className="animate-spin" />}{kind === "trial" ? "Criar teste" : "Criar acesso"}</Button>
        </div>
      </div>

      <Input placeholder="Buscar por usuário…" inputMode="numeric" value={filter} onChange={(e) => setFilter(e.target.value.replace(/\D/g, ""))} className="max-w-xs" />
      {accs.error ? <p className="p-10 text-center text-destructive">{resellerErr(accs.error)}</p> :
        <AccessManager rows={shown} loading={accs.isLoading} owner created={created} onChanged={refresh} />}
    </div>
  );
}
