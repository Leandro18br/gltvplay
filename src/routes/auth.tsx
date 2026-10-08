import { createFileRoute, useNavigate, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Loader2, MailCheck } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { lovable } from "@/integrations/lovable/index";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Logo } from "@/components/site/SiteHeader";
import { PasswordInput, PasswordChecklist, FieldError } from "@/components/site/PasswordInput";
import { authErrorMessage, emailSchema, fieldErrors, signInSchema, signUpSchema } from "@/lib/validation";

type Mode = "in" | "up" | "forgot";
const safeRedirect = (r: unknown) => (typeof r === "string" && r.startsWith("/") && !r.startsWith("//") ? r : "/");

export const Route = createFileRoute("/auth")({
  validateSearch: (s: Record<string, unknown>) => ({
    redirect: typeof s["redirect"] === "string" ? (s["redirect"] as string) : undefined,
    mode: s["mode"] === "up" ? ("up" as const) : undefined,
  }),
  head: () => ({
    meta: [
      { title: "Entrar ou criar conta — Streaming" },
      { name: "description", content: "Acesse sua conta ou cadastre-se para assistir filmes, séries e canais." },
      { property: "og:title", content: "Entrar ou criar conta — Streaming" },
      { property: "og:description", content: "Acesse sua conta ou cadastre-se para assistir filmes, séries e canais." },
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
  const [mode, setMode] = useState<Mode>(search.mode ?? "in");
  const [form, setForm] = useState({ name: "", email: "", password: "", confirm: "" });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(false);
  const [sent, setSent] = useState<null | "confirm" | "reset">(null);

  // Already signed in → go straight to destination
  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => { if (data.session) navigate({ to: target, replace: true }); });
  }, [navigate, target]);

  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement>) => setForm((f) => ({ ...f, [k]: e.target.value }));
  const switchMode = (m: Mode) => { setMode(m); setErrors({}); setSent(null); };

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setErrors({});
    try {
      if (mode === "up") {
        const parsed = signUpSchema.safeParse(form);
        if (!parsed.success) return setErrors(fieldErrors(parsed.error));
        setLoading(true);
        const { data, error } = await supabase.auth.signUp({
          email: parsed.data.email,
          password: parsed.data.password,
          options: { emailRedirectTo: window.location.origin, data: { name: parsed.data.name } },
        });
        if (error) throw error;
        // Duplicate e-mail: auth returns a user with no identities instead of an error
        if (data.user && (data.user.identities?.length ?? 0) === 0) {
          setErrors({ email: "Este e-mail já está cadastrado. Faça login ou recupere sua senha." });
          return;
        }
        if (data.session) navigate({ to: target, replace: true });
        else setSent("confirm");
      } else if (mode === "in") {
        const parsed = signInSchema.safeParse(form);
        if (!parsed.success) return setErrors(fieldErrors(parsed.error));
        setLoading(true);
        const { data, error } = await supabase.auth.signInWithPassword(parsed.data);
        if (error) throw error;
        const { data: p } = await supabase.from("profiles").select("status").eq("id", data.user.id).maybeSingle();
        if (p && p.status !== "active") {
          await supabase.auth.signOut();
          toast.error(p.status === "banned" ? "Esta conta foi banida." : "Esta conta está suspensa. Fale com o suporte.");
          return;
        }
        await supabase.from("profiles").update({ last_seen_at: new Date().toISOString() }).eq("id", data.user.id);
        toast.success("Bem-vindo de volta!");
        navigate({ to: target, replace: true });
      } else {
        const parsed = emailSchema.safeParse(form.email);
        if (!parsed.success) return setErrors({ email: parsed.error.issues[0]?.message ?? "E-mail inválido" });
        setLoading(true);
        const { error } = await supabase.auth.resetPasswordForEmail(parsed.data, { redirectTo: `${window.location.origin}/reset-password` });
        if (error) throw error;
        setSent("reset");
      }
    } catch (err) {
      toast.error(authErrorMessage(err instanceof Error ? err.message : ""));
    } finally {
      setLoading(false);
    }
  }

  async function google() {
    if (target !== "/") sessionStorage.setItem("post_auth_redirect", target);
    const r = await lovable.auth.signInWithOAuth("google", { redirect_uri: window.location.origin });
    if (r.error) toast.error("Não foi possível entrar com Google");
    else if (!r.redirected) navigate({ to: target, replace: true });
  }

  const title = mode === "in" ? "Entrar" : mode === "up" ? "Criar conta" : "Recuperar senha";

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-5 py-10">
      <div className="w-full max-w-sm animate-rise rounded-2xl border border-border bg-card p-8 shadow-glow">
        <Logo />
        {sent ? (
          <div className="mt-8 space-y-4 text-center">
            <div className="mx-auto flex size-14 items-center justify-center rounded-2xl bg-accent text-primary"><MailCheck /></div>
            <h1 className="text-xl font-semibold">Verifique seu e-mail</h1>
            <p className="text-sm text-muted-foreground">
              {sent === "confirm"
                ? `Enviamos um link de confirmação para ${form.email}. Clique nele para ativar sua conta.`
                : `Se existir uma conta com ${form.email}, você receberá um link para redefinir a senha.`}
            </p>
            <Button variant="secondary" className="w-full rounded-full" onClick={() => switchMode("in")}>Voltar ao login</Button>
          </div>
        ) : (
          <>
            <h1 className="mt-6 text-2xl font-semibold">{title}</h1>
            {mode === "forgot" && <p className="mt-1 text-sm text-muted-foreground">Informe seu e-mail para receber o link de redefinição.</p>}
            <form onSubmit={submit} noValidate className="mt-6 space-y-4">
              {mode === "up" && (
                <div className="space-y-1.5">
                  <Label htmlFor="n">Nome</Label>
                  <Input id="n" autoComplete="name" value={form.name} onChange={set("name")} maxLength={80} aria-invalid={!!errors.name} />
                  <FieldError msg={errors.name} />
                </div>
              )}
              <div className="space-y-1.5">
                <Label htmlFor="e">E-mail</Label>
                <Input id="e" type="email" autoComplete="email" value={form.email} onChange={set("email")} maxLength={255} aria-invalid={!!errors.email} />
                <FieldError msg={errors.email} />
              </div>
              {mode !== "forgot" && (
                <div className="space-y-1.5">
                  <div className="flex items-center justify-between">
                    <Label htmlFor="p">Senha</Label>
                    {mode === "in" && <button type="button" onClick={() => switchMode("forgot")} className="text-xs text-primary hover:underline">Esqueci minha senha</button>}
                  </div>
                  <PasswordInput id="p" autoComplete={mode === "up" ? "new-password" : "current-password"} value={form.password} onChange={set("password")} maxLength={72} aria-invalid={!!errors.password} />
                  <FieldError msg={errors.password} />
                  {mode === "up" && form.password && <PasswordChecklist value={form.password} />}
                </div>
              )}
              {mode === "up" && (
                <div className="space-y-1.5">
                  <Label htmlFor="c">Confirmar senha</Label>
                  <PasswordInput id="c" autoComplete="new-password" value={form.confirm} onChange={set("confirm")} maxLength={72} aria-invalid={!!errors.confirm} />
                  <FieldError msg={errors.confirm} />
                </div>
              )}
              <Button type="submit" className="w-full rounded-full" disabled={loading}>
                {loading && <Loader2 className="animate-spin" />}
                {mode === "in" ? "Entrar" : mode === "up" ? "Cadastrar" : "Enviar link"}
              </Button>
            </form>
            {mode !== "forgot" && <Button variant="outline" className="mt-3 w-full rounded-full" onClick={google}>Continuar com Google</Button>}
            <div className="mt-5 text-center text-sm text-muted-foreground">
              {mode === "in" && <button onClick={() => switchMode("up")} className="hover:text-foreground">Não tem conta? <span className="text-primary">Cadastre-se</span></button>}
              {mode === "up" && <button onClick={() => switchMode("in")} className="hover:text-foreground">Já tem conta? <span className="text-primary">Entrar</span></button>}
              {mode === "forgot" && <button onClick={() => switchMode("in")} className="hover:text-foreground">Voltar ao login</button>}
            </div>
            <p className="mt-4 text-center text-xs text-muted-foreground"><Link to="/" className="hover:text-foreground">Voltar ao início</Link></p>
          </>
        )}
      </div>
    </div>
  );
}
