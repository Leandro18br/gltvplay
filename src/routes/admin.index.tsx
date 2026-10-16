import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { Area, AreaChart, Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { Film, Tv, PlaySquare, Radio, Users, CheckCircle2, Clock, Star, Eye, Activity, Loader2 } from "lucide-react";
import { supabase } from "@/lib/auth/area-client";

export const Route = createFileRoute("/admin/")({ component: Dashboard });

type Stats = Record<string, number> & { views_by_day: { day: string; views: number }[]; by_kind: { name: string; value: number }[] };

const CARDS = [
  { k: "movies", label: "Filmes", icon: Film },
  { k: "series", label: "Séries", icon: Tv },
  { k: "episodes", label: "Episódios", icon: PlaySquare },
  { k: "channels", label: "Canais", icon: Radio },
  { k: "users", label: "Usuários", icon: Users },
  { k: "published", label: "Publicados", icon: CheckCircle2 },
  { k: "pending", label: "Pendentes", icon: Clock },
  { k: "featured", label: "Em destaque", icon: Star },
  { k: "views", label: "Visualizações", icon: Eye },
  { k: "active_users", label: "Usuários ativos (30d)", icon: Activity },
] as const;

const tip = { background: "var(--popover)", border: "1px solid var(--border)", borderRadius: 12, color: "var(--foreground)" };

function Dashboard() {
  const { data, isLoading, error } = useQuery({
    queryKey: ["admin", "stats"],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("admin_stats");
      if (error) throw error;
      return data as unknown as Stats;
    },
  });

  if (isLoading) return <div className="flex items-center gap-2 p-10 text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" /> Carregando indicadores…</div>;
  if (error || !data) return <div className="p-10 text-destructive">Não foi possível carregar os indicadores.</div>;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold md:text-3xl">Dashboard</h1>
        <p className="text-sm text-muted-foreground">Visão geral da plataforma em tempo real.</p>
      </div>
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-5">
        {CARDS.map(({ k, label, icon: Icon }, i) => (
          <div key={k} className="animate-rise rounded-2xl border border-border bg-card p-4 transition hover:shadow-glow" style={{ animationDelay: `${i * 30}ms` }}>
            <div className="flex items-center justify-between text-xs text-muted-foreground">{label}<Icon className="h-4 w-4 text-primary" /></div>
            <p className="mt-2 font-display text-2xl font-semibold md:text-3xl">{Number(data[k] ?? 0).toLocaleString("pt-BR")}</p>
          </div>
        ))}
      </div>
      <div className="grid gap-4 lg:grid-cols-3">
        <div className="rounded-2xl border border-border bg-card p-5 lg:col-span-2">
          <h2 className="mb-4 font-semibold">Visualizações — últimos 14 dias</h2>
          <div className="h-64">
            <ResponsiveContainer>
              <AreaChart data={data.views_by_day}>
                <defs>
                  <linearGradient id="g" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="var(--primary)" stopOpacity={0.5} />
                    <stop offset="100%" stopColor="var(--primary)" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid stroke="var(--border)" vertical={false} />
                <XAxis dataKey="day" stroke="var(--muted-foreground)" fontSize={11} tickLine={false} axisLine={false} />
                <YAxis allowDecimals={false} stroke="var(--muted-foreground)" fontSize={11} tickLine={false} axisLine={false} width={30} />
                <Tooltip contentStyle={tip} />
                <Area type="monotone" dataKey="views" name="Visualizações" stroke="var(--primary)" strokeWidth={2} fill="url(#g)" />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </div>
        <div className="rounded-2xl border border-border bg-card p-5">
          <h2 className="mb-4 font-semibold">Catálogo por tipo</h2>
          <div className="h-64">
            <ResponsiveContainer>
              <BarChart data={data.by_kind}>
                <CartesianGrid stroke="var(--border)" vertical={false} />
                <XAxis dataKey="name" stroke="var(--muted-foreground)" fontSize={11} tickLine={false} axisLine={false} />
                <YAxis allowDecimals={false} stroke="var(--muted-foreground)" fontSize={11} tickLine={false} axisLine={false} width={30} />
                <Tooltip contentStyle={tip} cursor={{ fill: "var(--muted)" }} />
                <Bar dataKey="value" name="Total" fill="var(--primary)" radius={[8, 8, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>
    </div>
  );
}
