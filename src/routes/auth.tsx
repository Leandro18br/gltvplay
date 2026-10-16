import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Loader2 } from "lucide-react";
import { useServerFn } from "@tanstack/react-start";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Logo } from "@/components/site/SiteHeader";
import { PasswordInput, FieldError } from "@/components/site/PasswordInput";
import { accessLogin } from "@/lib/access/access.functions";
import { checkSiteAccess, clearSiteAccessCache } from "@/lib/access/gate";
import { claimSlot } from "@/lib/auth/session-vault";

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
      { title: "Entrar — GLTV Play" },
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
    if (sessionStorage.getItem("access_denied")) {
      sessionStorage.removeItem("access_denied");
      toast.error("Sua sessão terminou ou seu acesso está vencido ou bloqueado. Entre novamente.");
    }
    checkSiteAccess(true).then((ok) => { if (ok) navigate({ to: target, replace: true }); });
  }, [navigate, target]);

  const set = (k: "login" | "password") => (e: React.ChangeEvent<HTMLInputElement>) =>
    setForm((f) => ({ ...f, [k]: e.target.value.replace(/\D/g, "").slice(0, 6) }));

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const errs: typeof errors = {};
    if (!CODE.test(form.login)) errs.login = "O usuário tem 6 números.";
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
      await claimSlot("client");
      sessionStorage.removeItem("access_denied");
      navigate({ to: target, replace: true });
    } catch {
      toast.error("Não foi possível entrar agora. Tente novamente.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-[#000000] px-4 py-6 sm:px-6 sm:py-10">
      <div className="w-full max-w-sm animate-rise rounded-2xl border border-[#00DDFA]/35 bg-[#080808] p-6 shadow-[0_0_32px_rgba(0,221,250,0.10)] sm:p-8">
        <div className="flex justify-center"><Logo size="login" /></div>
        <h1 className="mt-6 text-2xl font-semibold">Entrar</h1>
        <p className="mt-1 text-sm text-[#B3B3B3]">Digite seu código de acesso e sua senha.</p>
        <form onSubmit={submit} noValidate autoComplete="off" className="mt-5 space-y-3.5">
          <div className="space-y-1.5">
            <Input id="l" type="text" name="user_code" placeholder="Usuário" aria-label="Usuário" inputMode="numeric" autoComplete="off" autoCapitalize="off" spellCheck={false} pattern="\d{6}" maxLength={6} value={form.login} onChange={set("login")} aria-invalid={!!errors.login} className="h-12 rounded-xl border-[#333333] bg-[#111111] px-4 font-mono tracking-widest placeholder:font-sans placeholder:tracking-normal placeholder:text-[#A3A3A3] focus-visible:border-[#00DDFA] focus-visible:ring-[#00DDFA]" />
            <FieldError msg={errors.login} />
          </div>
          <div className="space-y-1.5">
            <PasswordInput id="p" name="access_password" placeholder="Senha" aria-label="Senha" inputMode="numeric" autoComplete="current-password" maxLength={6} value={form.password} onChange={set("password")} aria-invalid={!!errors.password} className="h-12 rounded-xl border-[#333333] bg-[#111111] px-4 font-mono tracking-widest placeholder:font-sans placeholder:tracking-normal placeholder:text-[#A3A3A3] focus-visible:border-[#00DDFA] focus-visible:ring-[#00DDFA]" />
            <FieldError msg={errors.password} />
          </div>
          <FieldError msg={errors.form} />
          <Button type="submit" className="mt-1 h-12 w-full rounded-xl bg-[#00DDFA] font-semibold text-[#000000] hover:bg-[#00c7e2] focus-visible:ring-2 focus-visible:ring-[#00DDFA] focus-visible:ring-offset-2 focus-visible:ring-offset-black" disabled={loading}>
            {loading && <Loader2 className="animate-spin" />}
            Entrar
          </Button>
        </form>
      </div>
    </div>
  );
}
