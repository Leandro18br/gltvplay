import { createFileRoute, redirect } from "@tanstack/react-router";
import { isAdminRole as isAdminRoleGuard } from "@/lib/admin/db";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ChevronLeft, ChevronRight, Loader2 } from "lucide-react";
import { db, type Row } from "@/lib/admin/db";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

export const Route = createFileRoute("/admin/logs")({
  beforeLoad: ({ context }) => { if (!isAdminRoleGuard(context.role)) throw redirect({ to: "/admin" }); },
  component: Logs,
});

const PAGE = 20;
const ENTITIES = ["movies", "series", "seasons", "episodes", "channels", "categories", "genres", "banners", "playback_sources", "site_settings", "user_roles", "profiles"];
const ACTION: Record<string, string> = { insert: "Criou", update: "Editou", delete: "Excluiu" };

function Logs() {
  const [page, setPage] = useState(0);
  const [entity, setEntity] = useState("all");
  const [open, setOpen] = useState<Row | null>(null);
  const list = useQuery({
    queryKey: ["admin", "logs", page, entity],
    queryFn: async () => {
      let q = db.from("audit_logs").select("*", { count: "exact" }).order("created_at", { ascending: false }).range(page * PAGE, page * PAGE + PAGE - 1);
      if (entity !== "all") q = q.eq("entity", entity);
      const { data, error, count } = await q;
      if (error) throw error;
      const ids = [...new Set((data as Row[]).map((r) => r.actor_id).filter(Boolean))];
      const { data: people } = ids.length ? await db.from("profiles").select("id,email").in("id", ids) : { data: [] };
      const map = Object.fromEntries(((people ?? []) as Row[]).map((p) => [p.id, p.email]));
      return { rows: data as Row[], map, count: count ?? 0 };
    },
  });
  const pages = Math.max(1, Math.ceil((list.data?.count ?? 0) / PAGE));

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div><h1 className="text-2xl font-bold md:text-3xl">Logs de auditoria</h1><p className="text-sm text-muted-foreground">Todas as ações administrativas são registradas automaticamente.</p></div>
        <Select value={entity} onValueChange={(v) => { setEntity(v); setPage(0); }}>
          <SelectTrigger className="w-48"><SelectValue /></SelectTrigger>
          <SelectContent><SelectItem value="all">Todas as áreas</SelectItem>{ENTITIES.map((e) => <SelectItem key={e} value={e}>{e}</SelectItem>)}</SelectContent>
        </Select>
      </div>
      <div className="overflow-x-auto rounded-2xl border border-border bg-card">
        {list.isLoading ? <div className="flex justify-center p-12"><Loader2 className="animate-spin" /></div> : !list.data?.rows.length ? (
          <p className="p-12 text-center text-muted-foreground">Nenhum registro.</p>
        ) : (
          <table className="w-full text-sm">
            <thead className="border-b border-border text-left text-xs uppercase text-muted-foreground"><tr><th className="px-4 py-3">Data</th><th className="px-4 py-3">Quem</th><th className="px-4 py-3">Ação</th><th className="px-4 py-3">Área</th><th className="px-4 py-3">Descrição</th></tr></thead>
            <tbody>
              {list.data.rows.map((r) => {
                const item = r.changes?.new ?? r.changes?.old ?? {};
                return (
                  <tr key={r.id} onClick={() => setOpen(r)} className="cursor-pointer border-b border-border/60 last:border-0 hover:bg-muted/40">
                    <td className="whitespace-nowrap px-4 py-3 text-muted-foreground">{new Date(r.created_at).toLocaleString("pt-BR")}</td>
                    <td className="px-4 py-3">{list.data.map[r.actor_id] ?? "Sistema"}</td>
                    <td className="px-4 py-3"><Badge variant={r.action === "delete" ? "destructive" : r.action === "insert" ? "default" : "secondary"}>{ACTION[r.action] ?? r.action}</Badge></td>
                    <td className="px-4 py-3">{r.entity}</td>
                    <td className="max-w-md px-4 py-3 text-muted-foreground">{r.summary ?? item.title ?? item.name ?? item.platform_name ?? r.entity_id}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
      <div className="flex items-center justify-end gap-2 text-sm text-muted-foreground">
        Página {page + 1} de {pages}
        <Button size="icon" variant="outline" disabled={page === 0} onClick={() => setPage(page - 1)}><ChevronLeft /></Button>
        <Button size="icon" variant="outline" disabled={page + 1 >= pages} onClick={() => setPage(page + 1)}><ChevronRight /></Button>
      </div>
      <Dialog open={!!open} onOpenChange={(o) => !o && setOpen(null)}>
        <DialogContent className="max-h-[85vh] max-w-2xl overflow-y-auto">
          <DialogHeader><DialogTitle>Detalhes da alteração</DialogTitle></DialogHeader>
          <pre className="overflow-x-auto rounded-xl bg-muted p-4 text-xs">{JSON.stringify(open?.changes, null, 2)}</pre>
        </DialogContent>
      </Dialog>
    </div>
  );
}
