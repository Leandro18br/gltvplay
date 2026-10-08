import { createFileRoute, redirect } from "@tanstack/react-router";
import { isAdminRole as isAdminRoleGuard } from "@/lib/admin/db";
import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { ChevronLeft, ChevronRight, Loader2, Search } from "lucide-react";
import { db, errMsg, type Row } from "@/lib/admin/db";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

export const Route = createFileRoute("/admin/users")({
  beforeLoad: ({ context }) => { if (!isAdminRoleGuard(context.role)) throw redirect({ to: "/admin" }); },
  component: UsersPage,
});

const PAGE = 15;

function UsersPage() {
  const qc = useQueryClient();
  const [search, setSearch] = useState("");
  const [q, setQ] = useState("");
  const [page, setPage] = useState(0);
  useEffect(() => { const t = setTimeout(() => { setQ(search); setPage(0); }, 300); return () => clearTimeout(t); }, [search]);

  const list = useQuery({
    queryKey: ["admin", "users", q, page],
    queryFn: async () => {
      let query = db.from("profiles").select("*", { count: "exact" }).order("created_at", { ascending: false }).range(page * PAGE, page * PAGE + PAGE - 1);
      if (q) query = query.or(`name.ilike.%${q}%,email.ilike.%${q}%`);
      const { data, error, count } = await query;
      if (error) throw error;
      const ids = (data as Row[]).map((r) => r.id);
      const { data: roles } = ids.length ? await db.from("user_roles").select("user_id, role").in("user_id", ids) : { data: [] };
      return { rows: data as Row[], roles: (roles ?? []) as Row[], count: count ?? 0 };
    },
  });
  const refresh = () => qc.invalidateQueries({ queryKey: ["admin", "users"] });

  async function setStatus(id: string, status: string) {
    const { error } = await db.from("profiles").update({ status }).eq("id", id);
    if (error) toast.error(errMsg(error)); else { toast.success("Status atualizado"); refresh(); }
  }
  async function setRole(id: string, role: string, enabled: boolean) {
    const { error } = await db.rpc("admin_set_role", { _user_id: id, _role: role, _enabled: enabled });
    if (error) toast.error(errMsg(error)); else { toast.success("Permissão atualizada"); refresh(); }
  }
  const has = (id: string, role: string) => list.data?.roles.some((r) => r.user_id === id && r.role === role);
  const pages = Math.max(1, Math.ceil((list.data?.count ?? 0) / PAGE));

  return (
    <div className="space-y-5">
      <div><h1 className="text-2xl font-bold md:text-3xl">Usuários</h1><p className="text-sm text-muted-foreground">{list.data?.count ?? 0} conta(s). Super admin: acesso total e gerencia administradores. Administrador: conteúdo e editores. Editor: cria e edita conteúdo.</p></div>
      <div className="relative rounded-2xl border border-border bg-card p-3">
        <Search className="absolute left-6 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <Input className="pl-9" placeholder="Buscar por nome ou e-mail…" value={search} onChange={(e) => setSearch(e.target.value)} />
      </div>
      <div className="overflow-x-auto rounded-2xl border border-border bg-card">
        {list.isLoading ? <div className="flex justify-center p-12"><Loader2 className="animate-spin" /></div> : !list.data?.rows.length ? (
          <p className="p-12 text-center text-muted-foreground">Nenhum usuário.</p>
        ) : (
          <table className="w-full text-sm">
            <thead className="border-b border-border text-left text-xs uppercase text-muted-foreground">
              <tr><th className="px-4 py-3">Usuário</th><th className="px-4 py-3">Criado</th><th className="px-4 py-3">Último acesso</th><th className="px-4 py-3">Status</th><th className="px-4 py-3">Super admin</th><th className="px-4 py-3">Admin</th><th className="px-4 py-3">Editor</th></tr>
            </thead>
            <tbody>
              {list.data.rows.map((u) => (
                <tr key={u.id} className="border-b border-border/60 last:border-0">
                  <td className="px-4 py-3"><p className="font-medium">{u.name ?? "—"}</p><p className="text-xs text-muted-foreground">{u.email}</p></td>
                  <td className="px-4 py-3 text-muted-foreground">{new Date(u.created_at).toLocaleDateString("pt-BR")}</td>
                  <td className="px-4 py-3 text-muted-foreground">{u.last_seen_at ? new Date(u.last_seen_at).toLocaleString("pt-BR") : "—"}</td>
                  <td className="px-4 py-3">
                    <Select value={u.status} onValueChange={(v) => setStatus(u.id, v)}>
                      <SelectTrigger className="w-32"><SelectValue /></SelectTrigger>
                      <SelectContent><SelectItem value="active">Ativo</SelectItem><SelectItem value="suspended">Suspenso</SelectItem><SelectItem value="banned">Banido</SelectItem></SelectContent>
                    </Select>
                  </td>
                  <td className="px-4 py-3"><Switch checked={!!has(u.id, "super_admin")} onCheckedChange={(v) => setRole(u.id, "super_admin", v)} /></td>
                  <td className="px-4 py-3"><Switch checked={!!has(u.id, "admin")} onCheckedChange={(v) => setRole(u.id, "admin", v)} /></td>
                  <td className="px-4 py-3"><Switch checked={!!has(u.id, "editor")} onCheckedChange={(v) => setRole(u.id, "editor", v)} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
      <div className="flex items-center justify-end gap-2 text-sm text-muted-foreground">
        Página {page + 1} de {pages}
        <Button size="icon" variant="outline" disabled={page === 0} onClick={() => setPage(page - 1)}><ChevronLeft /></Button>
        <Button size="icon" variant="outline" disabled={page + 1 >= pages} onClick={() => setPage(page + 1)}><ChevronRight /></Button>
      </div>
    </div>
  );
}
