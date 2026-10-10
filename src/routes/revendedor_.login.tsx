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
  const [form, setForm] = useState({ email: "", password: "" });
  const [error, setError] = useState<string>();
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (denied) toast.error("Entre com uma conta de revendedor ativa.");
    supabase.auth.getUser().then(async ({ data }) => {
      if (data.user && (await isReseller(data.user.id))) navigate({ to: "/revendedor", replace: true });
    });
  }, [denied, navigate]);

  const set = (k: "email" | "password") => (e: React.ChangeEvent<HTMLInputElement>) =>
    setForm((f) => ({ ...f, [k]: e.target.value }));

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const email = form.email.trim().toLowerCase();
    if (!/^\S+@\S+\.\S+$/.test(email) || !form.password) return setError("Informe o e-mail e a senha.");
    setError(undefined); setLoading(true);
    try {
      const { data, error: se } = await supabase.auth.signInWithPassword({ email, password: form.password });
      if (se || !data.user) return setError(/rate|too many/i.test(se?.message ?? "") ? "Muitas tentativas. Aguarde alguns minutos." : "E-mail ou senha incorretos.");
      if (!(await isReseller(data.user.id))) {
        await supabase.auth.signOut();
        return setError("Esta conta não é de um revendedor ativo.");
      }
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
        <p className="mt-1 text-sm text-muted-foreground">Entre com o e-mail e a senha cadastrados pelo administrador.</p>
        <form onSubmit={submit} noValidate className="mt-6 space-y-4">
          <div className="space-y-1.5"><Label htmlFor="ru">E-mail</Label><Input id="ru" type="email" autoComplete="username" value={form.email} onChange={set("email")} /></div>
          <div className="space-y-1.5"><Label htmlFor="rp">Senha</Label><PasswordInput id="rp" autoComplete="current-password" value={form.password} onChange={set("password")} /></div>
          <FieldError msg={error} />
          <Button type="submit" className="w-full rounded-full" disabled={loading}>{loading && <Loader2 className="animate-spin" />} Entrar</Button>
        </form>
      </div>
    </div>
  );
}
