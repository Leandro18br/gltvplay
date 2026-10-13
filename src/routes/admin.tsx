import { createFileRoute, Link, Outlet, redirect, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  LayoutDashboard, LayoutTemplate, Film, Tv, Radio, Tags, Shapes, Users,
  UserCircle, LogOut, Menu, ExternalLink, Cable, Coins, Store, UserPlus,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { ensureSlot, claimSlot, signOutSlot } from "@/lib/auth/session-vault";
import { ROLE_LABEL, isAdminRole, type StaffRole } from "@/lib/admin/db";
import { adminHead } from "@/lib/admin/head";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet";

export const Route = createFileRoute("/admin")({
  ssr: false,
  head: () => adminHead("Painel", "Administração do catálogo e das fontes de reprodução autorizadas."),
  beforeLoad: async () => {
    await ensureSlot("admin");
    const { data } = await supabase.auth.getUser();
    if (!data.user) throw redirect({ to: "/admin/login" });
    const { data: role } = await supabase.rpc("my_role");
    if (role !== "super_admin" && role !== "admin" && role !== "editor") throw redirect({ to: "/admin/login", search: { denied: 1 } });
    await claimSlot("admin");
    return { user: data.user, role: role as StaffRole };
  },
  component: AdminLayout,
});

const NAV = [
  { to: "/admin", label: "Dashboard", icon: LayoutDashboard, exact: true },
  { to: "/admin/home", label: "Home do site", icon: LayoutTemplate },
  { to: "/admin/movies", label: "Filmes", icon: Film },
  { to: "/admin/series", label: "Séries", icon: Tv },
  { to: "/admin/channels", label: "Canais", icon: Radio },
  { to: "/admin/categories", label: "Categorias de filmes e séries", icon: Tags },
  { to: "/admin/channel-categories", label: "Categorias de canais", icon: Radio },
  { to: "/admin/genres", label: "Gêneros", icon: Shapes },
  { to: "/admin/users", label: "Usuários", icon: Users, adminOnly: true },
  { to: "/admin/integrations", label: "APIs e Integrações", icon: Cable, adminOnly: true },
  { to: "/admin/clients", label: "Criar cliente", icon: UserPlus, superOnly: true },
  { to: "/admin/credits", label: "Gerenciar créditos", icon: Coins, superOnly: true },
  { to: "/admin/resellers", label: "Gerenciar revendedores", icon: Store, superOnly: true },
  { to: "/admin/profile", label: "Meu perfil", icon: UserCircle },
] as const;

function Nav({ onNavigate, role }: { onNavigate?: () => void; role: StaffRole }) {
  const navigate = useNavigate();
  const qc = useQueryClient();
  async function logout() {
    await qc.cancelQueries();
    qc.clear();
    await signOutSlot("admin");
    navigate({ to: "/admin/login", replace: true });
  }
  return (
    <div className="flex h-full flex-col">
      <div className="flex h-16 items-center px-5 font-display text-lg font-bold">
        <span className="mr-2 text-primary">●</span> Painel ADM
      </div>
      <nav className="flex-1 space-y-0.5 overflow-y-auto px-3 pb-4">
        {NAV.filter((n) => (!("adminOnly" in n) || isAdminRole(role)) && (!("superOnly" in n) || role === "super_admin")).map(({ to, label, icon: Icon, ...rest }) => (
          <Link key={to} to={to} onClick={onNavigate} activeOptions={{ exact: "exact" in rest }}
            className="flex items-center gap-3 rounded-xl px-3 py-2 text-sm text-sidebar-foreground/70 transition hover:bg-sidebar-accent hover:text-sidebar-foreground"
            activeProps={{ className: "!bg-sidebar-accent !text-primary font-medium" }}>
            <Icon className="h-4 w-4" /> {label}
          </Link>
        ))}
      </nav>
      <div className="space-y-1 border-t border-sidebar-border p-3">
        <Link to="/" className="flex items-center gap-3 rounded-xl px-3 py-2 text-sm text-sidebar-foreground/70 hover:bg-sidebar-accent"><ExternalLink className="h-4 w-4" /> Ver site</Link>
        <button onClick={logout} className="flex w-full items-center gap-3 rounded-xl px-3 py-2 text-sm text-sidebar-foreground/70 hover:bg-sidebar-accent hover:text-destructive"><LogOut className="h-4 w-4" /> Sair</button>
      </div>
    </div>
  );
}

function AdminLayout() {
  const { user, role } = Route.useRouteContext();
  const [open, setOpen] = useState(false);
  return (
    <div className="min-h-screen bg-background">
      <aside className="fixed inset-y-0 left-0 hidden w-64 border-r border-sidebar-border bg-sidebar lg:block"><Nav role={role} /></aside>
      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent side="left" className="w-64 bg-sidebar p-0">
          <SheetTitle className="sr-only">Menu</SheetTitle>
          <Nav role={role} onNavigate={() => setOpen(false)} />
        </SheetContent>
      </Sheet>
      <div className="lg:pl-64">
        <header className="sticky top-0 z-30 flex h-16 items-center justify-between border-b border-border bg-background/85 px-4 backdrop-blur md:px-8">
          <Button variant="ghost" size="icon" className="lg:hidden" onClick={() => setOpen(true)} aria-label="Abrir menu"><Menu /></Button>
          <div className="ml-auto flex min-w-0 items-center gap-2 text-sm text-muted-foreground"><span className="shrink-0 rounded-full border border-primary/40 bg-accent px-2 py-0.5 text-xs text-accent-foreground">{ROLE_LABEL[role]}</span><span className="truncate">{user.email}</span></div>
        </header>
        <main className="mx-auto max-w-7xl p-4 md:p-8"><Outlet /></main>
      </div>
    </div>
  );
}
