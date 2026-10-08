import { Link, useRouter } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { Home, Search, Film, Tv, ListVideo, User } from "lucide-react";
import { siteSettingsQuery } from "@/lib/catalog";
import { SiteHeader } from "./SiteHeader";

const MOBILE = [
  { to: "/", label: "Início", icon: Home, exact: true },
  { to: "/buscar", label: "Buscar", icon: Search },
  { to: "/filmes", label: "Filmes", icon: Film },
  { to: "/series", label: "Séries", icon: Tv },
  { to: "/minha-lista", label: "Lista", icon: ListVideo },
  { to: "/perfil", label: "Perfil", icon: User },
] as const;

function MobileNav() {
  return (
    <nav aria-label="Navegação inferior" className="fixed inset-x-0 bottom-0 z-50 border-t border-border bg-background/95 pb-[env(safe-area-inset-bottom)] backdrop-blur-md lg:hidden">
      <ul className="grid grid-cols-6">
        {MOBILE.map((n) => (
          <li key={n.to}>
            <Link
              to={n.to}
              {...(n.to === "/buscar" ? { search: { q: "" } } : {})}
              activeOptions={{ exact: "exact" in n }}
              className="flex flex-col items-center gap-1 py-2.5 text-[10px] text-muted-foreground transition-colors"
              activeProps={{ className: "!text-primary" }}
            >
              <n.icon className="size-5" />
              {n.label}
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}

export function SiteFooter() {
  const { data: settings } = useQuery(siteSettingsQuery);
  const texts = (settings?.texts ?? {}) as { footer?: string };
  const social = (settings?.social_links ?? {}) as Record<string, string>;
  return (
    <footer className="border-t border-border px-5 pb-28 pt-10 text-sm text-muted-foreground md:px-10 lg:pb-10">
      <div className="mx-auto flex max-w-[1600px] flex-wrap items-center justify-between gap-4">
        <p>{texts.footer || `© ${new Date().getFullYear()} ${settings?.platform_name ?? "Streaming"}`}</p>
        <nav aria-label="Rodapé" className="flex flex-wrap gap-4">
          <Link to="/filmes" className="hover:text-primary">Filmes</Link>
          <Link to="/series" className="hover:text-primary">Séries</Link>
          <Link to="/canais" className="hover:text-primary">Canais</Link>
          <Link to="/categorias" className="hover:text-primary">Categorias</Link>
          {Object.entries(social).filter(([, v]) => v).map(([k, v]) => (
            <a key={k} href={v} target="_blank" rel="noreferrer" className="capitalize hover:text-primary">{k}</a>
          ))}
        </nav>
      </div>
    </footer>
  );
}

export function SiteShell({ children, padTop = true }: { children: ReactNode; padTop?: boolean }) {
  return (
    <div className="min-h-screen bg-background">
      <SiteHeader />
      <main className={padTop ? "pt-20 md:pt-24" : ""}>{children}</main>
      <SiteFooter />
      <MobileNav />
    </div>
  );
}

export function PageTitle({ title, subtitle, children }: { title: string; subtitle?: string | null | undefined; children?: ReactNode }) {
  return (
    <div className="mx-auto flex max-w-[1600px] flex-col gap-4 px-4 pb-6 md:flex-row md:items-end md:justify-between md:px-10">
      <div className="min-w-0">
        <h1 className="text-3xl font-bold md:text-4xl">{title}</h1>
        {subtitle && <p className="mt-2 max-w-2xl text-muted-foreground">{subtitle}</p>}
      </div>
      {children}
    </div>
  );
}

export function EmptyState({ title, text, icon }: { title: string; text?: string; icon?: ReactNode }) {
  return (
    <div className="mx-auto my-20 max-w-md px-5 text-center">
      {icon && <div className="mx-auto mb-5 flex size-14 items-center justify-center rounded-2xl bg-accent text-primary shadow-glow">{icon}</div>}
      <h2 className="text-xl font-semibold">{title}</h2>
      {text && <p className="mt-2 text-muted-foreground">{text}</p>}
    </div>
  );
}

/** Error state for route loaders: explains timeouts/offline and lets the user retry. */
export function RetryState({ title }: { title: string }) {
  const router = useRouter();
  return (
    <SiteShell>
      <div className="mx-auto my-20 max-w-md px-5 text-center">
        <h2 className="text-xl font-semibold">{title}</h2>
        <p className="mt-2 text-muted-foreground">O servidor demorou ou está indisponível no momento. Verifique sua conexão e tente novamente.</p>
        <button onClick={() => router.invalidate()} className="mt-5 rounded-full bg-primary px-5 py-2 text-sm font-medium text-primary-foreground">Tentar novamente</button>
      </div>
    </SiteShell>
  );
}
