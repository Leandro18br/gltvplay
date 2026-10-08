import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Loader2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { PasswordInput, PasswordChecklist, FieldError } from "@/components/site/PasswordInput";
import { authErrorMessage, fieldErrors, newPasswordSchema } from "@/lib/validation";

export const Route = createFileRoute("/reset-password")({
  ssr: false,
  head: () => ({
    meta: [
      { title: "Redefinir senha — Streaming" },
      { name: "description", content: "Defina uma nova senha para sua conta." },
      { property: "og:title", content: "Redefinir senha — Streaming" },
      { property: "og:description", content: "Defina uma nova senha para sua conta." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: ResetPassword,
});

function ResetPassword() {
  const navigate = useNavigate();
  const [pw, setPw] = useState("");
  const [pw2, setPw2] = useState("");
  const [errors, setErrors] = useState<Partial<Record<"name" | "email" | "password" | "confirm" | "current", string>>>({});
  const [loading, setLoading] = useState(false);
  const [ready, setReady] = useState<boolean | null>(null);

  useEffect(() => {
    const isRecovery = window.location.hash.includes("type=recovery");
    supabase.auth.getSession().then(({ data }) => setReady(!!data.session || isRecovery));
    const { data } = supabase.auth.onAuthStateChange((e) => { if (e === "PASSWORD_RECOVERY" || e === "SIGNED_IN") setReady(true); });
    return () => data.subscription.unsubscribe();
  }, []);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const parsed = newPasswordSchema.safeParse({ password: pw, confirm: pw2 });
    if (!parsed.success) { setErrors(fieldErrors(parsed.error)); return; }
    setErrors({});
    setLoading(true);
    const { error } = await supabase.auth.updateUser({ password: parsed.data.password });
    setLoading(false);
    if (error) { toast.error(authErrorMessage(error.message)); return; }
    toast.success("Senha atualizada com sucesso");
    navigate({ to: "/", replace: true });
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-5">
      {ready === false ? (
        <div className="w-full max-w-sm space-y-4 rounded-2xl border border-border bg-card p-8 text-center">
          <h1 className="text-xl font-semibold">Link inválido ou expirado</h1>
          <p className="text-sm text-muted-foreground">Solicite um novo link de redefinição na tela de login.</p>
          <Button className="w-full rounded-full" onClick={() => navigate({ to: "/auth" })}>Ir para o login</Button>
        </div>
      ) : (
        <form onSubmit={submit} noValidate className="w-full max-w-sm space-y-4 rounded-2xl border border-border bg-card p-8 shadow-glow">
          <h1 className="text-2xl font-semibold">Nova senha</h1>
          <div className="space-y-1.5">
            <Label htmlFor="np">Nova senha</Label>
            <PasswordInput id="np" autoComplete="new-password" value={pw} onChange={(e) => setPw(e.target.value)} maxLength={72} />
            <FieldError msg={errors.password} />
            {pw && <PasswordChecklist value={pw} />}
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="nc">Confirmar senha</Label>
            <PasswordInput id="nc" autoComplete="new-password" value={pw2} onChange={(e) => setPw2(e.target.value)} maxLength={72} />
            <FieldError msg={errors.confirm} />
          </div>
          <Button className="w-full rounded-full" disabled={loading || ready === null}>{loading && <Loader2 className="animate-spin" />} Salvar nova senha</Button>
        </form>
      )}
    </div>
  );
}
