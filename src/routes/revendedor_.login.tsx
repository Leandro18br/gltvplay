import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { z } from "zod";
import { toast } from "sonner";
import { Loader2, Store } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { PasswordInput, FieldError } from "@/components/site/PasswordInput";
import { useServerFn } from "@tanstack/react-start";
import { resellerLogin } from "@/lib/resellers/resellers.functions";

export const Route = createFileRoute("/revendedor_/login")({
  ssr: false,
  validateSearch: z.object({ denied: z.coerce.number().optional() }),
  head: () => ({
    meta: [
      { title: "Login de revendedor" },
      { name: "description", content: "Acesso restrito aos revendedores autorizados." },
      { property: "og:title", content: "Login de revendedor" },
      { property: "og:description", content: "Acesso restrito aos revendedores autorizados." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
      { name: "robots", content: "noindex, nofollow" },
    ],
  }),
  component: ResellerLogin,
});

async function isReseller(uid: string) {
  const { data } = await supabase.rpc("is_active_reseller", { _user_id: uid });
  return !!data;
}

function ResellerLogin() {
  const navigate = useNavigate();
  const { denied } = Route.useSearch();
  const login = useServerFn(resellerLogin);
  const [form, setForm] = useState({ login: "", password: "" });
  const [error, setError] = useState<string>();
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (denied) toast.error("Entre com uma conta de revendedor ativa.");
    supabase.auth.getUser().then(async ({ data }) => {
      if (data.user && (await isReseller(data.user.id))) navigate({ to: "/revendedor", replace: true });
    });
  }, [denied, navigate]);

  const set = (k: "login" | "password") => (e: React.ChangeEvent<HTMLInputElement>) =>
    setForm((f) => ({ ...f, [k]: e.target.value.replace(/\D/g, "").slice(0, 6) }));

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!/^\d{6}$/.test(form.login) || !/^\d{6}$/.test(form.password)) return setError("Usuário e senha têm 6 números.");
    setError(undefined); setLoading(true);
    try {
      const r = await login({ data: form });
      if (!r.ok) return setError(r.message);
      // Replaces any other session in this browser (client or admin) with the reseller session.
      const { error: se } = await supabase.auth.setSession({ access_token: r.access_token, refresh_token: r.refresh_token });
      if (se) throw se;
      navigate({ to: "/revendedor", replace: true });
    } catch {
      toast.error("Não foi possível entrar agora. Tente novamente.");
    } finally { setLoading(false); }
  }

  return (
    <div className="relative flex min-h-screen items-center justify-center overflow-hidden bg-background px-5">
      <div className="pointer-events-none absolute -top-40 left-1/2 h-96 w-96 -translate-x-1/2 rounded-full bg-primary/20 blur-3xl" />
      <div className="animate-rise relative w-full max-w-sm rounded-2xl border border-border bg-card p-8 shadow-glow">
        <div className="mb-6 flex h-12 w-12 items-center justify-center rounded-xl bg-accent text-primary"><Store /></div>
        <h1 className="text-2xl font-semibold">Painel de revenda</h1>
        <p className="mt-1 text-sm text-muted-foreground">Entre com o usuário e a senha de 6 números enviados pelo administrador.</p>
        <form onSubmit={submit} noValidate className="mt-6 space-y-4">
          <div className="space-y-1.5"><Label htmlFor="ru">Usuário</Label><Input id="ru" inputMode="numeric" autoComplete="username" maxLength={6} value={form.login} onChange={set("login")} className="font-mono tracking-widest" /></div>
          <div className="space-y-1.5"><Label htmlFor="rp">Senha</Label><PasswordInput id="rp" inputMode="numeric" autoComplete="current-password" maxLength={6} value={form.password} onChange={set("password")} className="font-mono tracking-widest" /></div>
          <FieldError msg={error} />
          <Button type="submit" className="w-full rounded-full" disabled={loading}>{loading && <Loader2 className="animate-spin" />} Entrar</Button>
        </form>
      </div>
    </div>
  );
}
