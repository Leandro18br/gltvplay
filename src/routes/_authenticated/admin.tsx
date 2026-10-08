import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { Film, Tv, Radio, Tags, Users, ScrollText, ShieldAlert } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";

export const Route = createFileRoute("/_authenticated/admin")({
  head: () => ({
    meta: [
      { title: "Painel administrativo — Streaming" },
      { name: "description", content: "Gerencie catálogo, canais e configurações da plataforma." },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: AdminHome,
});

const tables = [
  { key: "movies", label: "Filmes", icon: Film },
  { key: "series", label: "Séries", icon: Tv },
  { key: "channels", label: "Canais", icon: Radio },
  { key: "categories", label: "Categorias", icon: Tags },
  { key: "profiles", label: "Usuários", icon: Users },
  { key: "audit_logs", label: "Registros de auditoria", icon: ScrollText },
] as const;

function AdminHome() {
  const { user } = Route.useRouteContext();

  const staff = useQuery({
    queryKey: ["is_staff", user.id],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("is_staff", { _user_id: user.id });
      if (error) throw error;
      return data;
    },
  });

  const counts = useQuery({
    queryKey: ["admin", "counts"],
    enabled: staff.data === true,
    queryFn: async () => {
      const res = await Promise.all(
        tables.map((t) => supabase.from(t.key).select("*", { count: "exact", head: true })),
      );
      return Object.fromEntries(tables.map((t, i) => [t.key, res[i].count ?? 0]));
    },
  });

  if (staff.isLoading) return <div className="p-10 text-muted-foreground">Carregando…</div>;
  if (!staff.data)
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-3 p-10 text-center">
        <ShieldAlert className="text-primary" />
        <h1 className="text-xl font-semibold">Acesso restrito</h1>
        <p className="text-muted-foreground">Sua conta não tem permissão de administrador.</p>
        <Link to="/" className="text-primary hover:underline">Voltar ao site</Link>
      </div>
    );

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b border-border">
        <div className="mx-auto flex h-16 max-w-6xl items-center justify-between px-6">
          <span className="font-display font-bold"><span className="text-primary">●</span> Painel ADM</span>
          <Link to="/" className="text-sm text-muted-foreground hover:text-foreground">Ver site</Link>
        </div>
      </header>
      <main className="mx-auto max-w-6xl px-6 py-10">
        <h1 className="text-3xl font-bold">Visão geral</h1>
        <p className="mt-1 text-muted-foreground">Base do painel pronta. Módulos de gestão serão adicionados nas próximas etapas.</p>
        <div className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {tables.map(({ key, label, icon: Icon }) => (
            <div key={key} className="animate-rise rounded-2xl border border-border bg-card p-6 transition hover:shadow-glow">
              <div className="flex items-center justify-between">
                <span className="text-sm text-muted-foreground">{label}</span>
                <Icon className="h-5 w-5 text-primary" />
              </div>
              <p className="mt-3 font-display text-3xl font-semibold">{counts.data?.[key] ?? "—"}</p>
            </div>
          ))}
        </div>
      </main>
    </div>
  );
}
