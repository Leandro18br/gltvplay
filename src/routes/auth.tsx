import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Loader2 } from "lucide-react";
import { useServerFn } from "@tanstack/react-start";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Logo } from "@/components/site/SiteHeader";
import { PasswordInput, FieldError } from "@/components/site/PasswordInput";
import { accessLogin } from "@/lib/access/access.functions";
import { checkSiteAccess, clearSiteAccessCache } from "@/lib/access/gate";

const safeRedirect = (r: unknown) => (typeof r === "string" && r.startsWith("/") && !r.startsWith("//") && !r.startsWith("/auth") ? r : "/");
const CODE = /^\d{6}$/;

export const Route = createFileRoute("/auth")({
  ssr: false,
  validateSearch: (s: Record<string, unknown>): { redirect?: string | undefined; mode?: "up" | undefined } => ({
    redirect: typeof s["redirect"] === "string" ? (s["redirect"] as string) : undefined,
    mode: undefined,
  }),
  head: () => ({
    meta: [
      { title: "Entrar — Streaming" },
      { name: "description", content: "Entre com seu login e senha de acesso para assistir filmes, séries e canais." },
      { property: "og:title", content: "Entrar — Streaming" },
      { property: "og:description", content: "Entre com seu login e senha de acesso para assistir filmes, séries e canais." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: AuthPage,
});

function AuthPage() {
  const navigate = useNavigate();
  const search = Route.useSearch();
  const target = safeRedirect(search.redirect);
  const login = useServerFn(accessLogin);
  const [form, setForm] = useState({ login: "", password: "" });
  const [errors, setErrors] = useState<{ login?: string; password?: string; form?: string }>({});
  const [loading, setLoading] = useState(false);

  // Already signed in with a valid access → go straight to destination
  useEffect(() => {
    checkSiteAccess(true).then((ok) => { if (ok) navigate({ to: target, replace: true }); });
  }, [navigate, target]);

  const set = (k: "login" | "password") => (e: React.ChangeEvent<HTMLInputElement>) =>
    setForm((f) => ({ ...f, [k]: e.target.value.replace(/\D/g, "").slice(0, 6) }));

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const errs: typeof errors = {};
    if (!CODE.test(form.login)) errs.login = "O login tem 6 números.";
    if (!CODE.test(form.password)) errs.password = "A senha tem 6 números.";
    setErrors(errs);
    if (Object.keys(errs).length) return;
    setLoading(true);
    try {
      const r = await login({ data: form });
      if (!r.ok) { setErrors({ form: r.message }); return; }
      // Replace any other session (e.g. a staff account) with the access session.
      const { error } = await supabase.auth.setSession({ access_token: r.access_token, refresh_token: r.refresh_token });
      if (error) throw error;
      clearSiteAccessCache();
      navigate({ to: target, replace: true });
    } catch {
      toast.error("Não foi possível entrar agora. Tente novamente.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-5 py-10">
      <div className="w-full max-w-sm animate-rise rounded-2xl border border-border bg-card p-8 shadow-glow">
        <Logo />
        <h1 className="mt-6 text-2xl font-semibold">Entrar</h1>
        <p className="mt-1 text-sm text-muted-foreground">Use o login e a senha de 6 números fornecidos pelo seu revendedor.</p>
        <form onSubmit={submit} noValidate className="mt-6 space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="l">Login</Label>
            <Input id="l" inputMode="numeric" autoComplete="username" pattern="\d{6}" maxLength={6} value={form.login} onChange={set("login")} aria-invalid={!!errors.login} className="font-mono tracking-widest" />
            <FieldError msg={errors.login} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="p">Senha</Label>
            <PasswordInput id="p" inputMode="numeric" autoComplete="current-password" maxLength={6} value={form.password} onChange={set("password")} aria-invalid={!!errors.password} className="font-mono tracking-widest" />
            <FieldError msg={errors.password} />
          </div>
          <FieldError msg={errors.form} />
          <Button type="submit" className="w-full rounded-full" disabled={loading}>
            {loading && <Loader2 className="animate-spin" />}
            Entrar
          </Button>
        </form>
      </div>
    </div>
  );
}
