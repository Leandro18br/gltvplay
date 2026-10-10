import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { z } from "zod";
import { toast } from "sonner";
import { Loader2, Store } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { PasswordInput } from "@/components/site/PasswordInput";

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
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (denied) toast.error("Esta conta não é de um revendedor ativo.");
    supabase.auth.getUser().then(async ({ data }) => {
      if (data.user && (await isReseller(data.user.id))) navigate({ to: "/revendedor", replace: true });
    });
  }, [denied, navigate]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    try {
      const { data, error } = await supabase.auth.signInWithPassword({ email: email.trim(), password });
      if (error) throw new Error("E-mail ou senha inválidos");
      if (!(await isReseller(data.user.id))) {
        await supabase.auth.signOut();
        throw new Error("Acesso negado: conta não é de revendedor ou está bloqueada.");
      }
      navigate({ to: "/revendedor", replace: true });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Erro ao entrar");
    } finally { setLoading(false); }
  }

  return (
    <div className="relative flex min-h-screen items-center justify-center overflow-hidden bg-background px-5">
      <div className="pointer-events-none absolute -top-40 left-1/2 h-96 w-96 -translate-x-1/2 rounded-full bg-primary/20 blur-3xl" />
      <div className="animate-rise relative w-full max-w-sm rounded-2xl border border-border bg-card p-8 shadow-glow">
        <div className="mb-6 flex h-12 w-12 items-center justify-center rounded-xl bg-accent text-primary"><Store /></div>
        <h1 className="text-2xl font-semibold">Painel de revenda</h1>
        <p className="mt-1 text-sm text-muted-foreground">Entre com a conta de revendedor criada pelo administrador.</p>
        <form onSubmit={submit} className="mt-6 space-y-4">
          <div className="space-y-1.5"><Label htmlFor="email">E-mail</Label><Input id="email" type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} required /></div>
          <div className="space-y-1.5"><Label htmlFor="pw">Senha</Label><PasswordInput id="pw" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required /></div>
          <Button type="submit" className="w-full rounded-full" disabled={loading}>{loading && <Loader2 className="animate-spin" />} Entrar</Button>
        </form>
      </div>
    </div>
  );
}
