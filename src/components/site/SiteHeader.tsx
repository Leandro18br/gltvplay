import { Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Search, User, LogOut, ListVideo, LayoutDashboard } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { signOutSlot } from "@/lib/auth/session-vault";
import { siteSettingsQuery } from "@/lib/catalog";
import { useAuthUser } from "@/lib/user-data";
import { greetingFor } from "@/lib/access/greeting";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

const NAV = [
  { to: "/", label: "Início" },
  { to: "/filmes", label: "Filmes" },
  { to: "/series", label: "Séries" },
  { to: "/canais", label: "Canais" },
  { to: "/categorias", label: "Categorias" },
  { to: "/minha-lista", label: "Minha lista" },
] as const;

export function Logo() {
  const { data: settings } = useQuery(siteSettingsQuery);
  const name = settings?.platform_name ?? "Streaming";
  return (
    <Link to="/" className="flex shrink-0 items-center gap-2" aria-label={name}>
      {settings?.logo_url ? (
        <img src={settings.logo_url} alt={name} className="h-7 w-auto" />
      ) : (
        <span className="font-display text-xl font-bold tracking-tight">
          <span className="text-primary">●</span> {name}
        </span>
      )}
    </Link>
  );
}

export function SiteHeader() {
  const { user } = useAuthUser();
  const [scrolled, setScrolled] = useState(false);
  const [staff, setStaff] = useState(false);
  const navigate = useNavigate();
  const qc = useQueryClient();

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 20);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  useEffect(() => {
    if (!user) return setStaff(false);
    supabase.rpc("is_staff", { _user_id: user.id }).then(({ data }) => setStaff(!!data));
  }, [user]);

  // Name comes from the authenticated client's own access record (server-side RPC).
  const nameQ = useQuery({
    queryKey: ["me", user?.id, "client-name"],
    enabled: !!user,
    staleTime: 30_000,
    refetchInterval: 60_000,
    refetchOnWindowFocus: true,
    queryFn: async () => {
      const { data, error } = await supabase.rpc("my_client_name");
      if (error) return null;
      return (data as string | null) ?? null;
    },
  });
  const clientName = nameQ.data ?? null;
  const greeting = user && nameQ.isSuccess ? greetingFor(clientName) : null;

  const signOut = async () => {
    await qc.cancelQueries();
    qc.removeQueries({ queryKey: ["me"] });
    await signOutSlot("client");
    navigate({ to: "/", replace: true });
  };

  return (
    <header
      className={`fixed inset-x-0 top-0 z-50 transition-colors duration-300 ${scrolled ? "border-b border-border bg-background/90 backdrop-blur-md" : "bg-gradient-to-b from-background/80 to-transparent"}`}
    >
      <div className="mx-auto flex h-16 max-w-[1600px] items-center gap-8 px-4 md:px-10">
        <Logo />
        <nav aria-label="Principal" className="hidden items-center gap-1 lg:flex">
          {NAV.map((n) => (
            <Link
              key={n.to}
              to={n.to}
              activeOptions={{ exact: n.to === "/" }}
              className="rounded-full px-3 py-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground"
              activeProps={{ className: "!text-foreground font-semibold" }}
            >
              {n.label}
            </Link>
          ))}
        </nav>
        <div className="ml-auto flex items-center gap-1.5">
          <Button asChild variant="ghost" size="icon" className="rounded-full" aria-label="Buscar">
            <Link to="/buscar" search={{ q: "" }}><Search className="size-5" /></Link>
          </Button>
          {user && greeting && <span data-testid="greeting" className="hidden max-w-[14rem] truncate text-sm font-medium sm:inline">{greeting}</span>}
          {user ? (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button aria-label="Perfil" className="flex size-9 items-center justify-center rounded-full bg-accent text-sm font-semibold text-accent-foreground ring-1 ring-primary/30 transition hover:ring-primary">
                  {(clientName ?? user.email ?? "?").slice(0, 1).toUpperCase()}
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-56">
                <DropdownMenuLabel className="truncate font-normal text-muted-foreground">{greeting ?? user.email}</DropdownMenuLabel>
                <DropdownMenuSeparator />
                <DropdownMenuItem asChild><Link to="/perfil"><User /> Meu perfil</Link></DropdownMenuItem>
                <DropdownMenuItem asChild><Link to="/minha-lista"><ListVideo /> Minha lista</Link></DropdownMenuItem>
                {staff && <DropdownMenuItem asChild><Link to="/admin"><LayoutDashboard /> Painel ADM</Link></DropdownMenuItem>}
                <DropdownMenuSeparator />
                <DropdownMenuItem onClick={signOut}><LogOut /> Sair</DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          ) : (
            <Button asChild size="sm" className="rounded-full">
              <Link to="/auth">Entrar</Link>
            </Button>
          )}
        </div>
      </div>
    </header>
  );
}
