import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { z } from "zod";
import { toast } from "sonner";
import { Eye, EyeOff, Loader2, ShieldCheck } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { claimSlot } from "@/lib/auth/session-vault";
import { checkAdminAccess, clearAdminAccessCache, primeAdminAccess, resolveRole, roleToAccess } from "@/lib/auth/admin-access";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { adminHead } from "@/lib/admin/head";
import { GLTVLogo } from "@/components/brand/GLTVLogo";

export const Route = createFileRoute("/admin_/login")({
  ssr: false,
  validateSearch: z.object({ denied: z.coerce.number().optional() }),
  head: () => adminHead("Login administrativo", "Acesso restrito à administração da plataforma."),
  component: AdminLogin,
});

function AdminLogin() {
  const navigate = useNavigate();
  const { denied } = Route.useSearch();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [show, setShow] = useState(false);
  const [loading, setLoading] = useState(false);
  const [mode, setMode] = useState<"login" | "forgot">("login");
  const busy = useRef(false);

  useEffect(() => {
    if (denied) { toast.error("Sua conta não tem permissão de administrador."); return; }
    // Already signed in to the admin area? Reuse the shared check (no duplicate queries).
    let alive = true;
    checkAdminAccess().then((a) => {
      if (alive && !busy.current && a.status === "ok") navigate({ to: "/admin", replace: true });
    });
    return () => { alive = false; };
  }, [denied, navigate]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (busy.current) return; // blocks duplicate submissions
    busy.current = true;
    setLoading(true);
    try {
      if (mode === "forgot") {
        const { error } = await supabase.auth.resetPasswordForEmail(email.trim().toLowerCase(), { redirectTo: `${window.location.origin}/reset-password` });
        if (error) throw error;
        toast.success("Se o e-mail existir, enviaremos um link de recuperação.");
        setMode("login");
        return;
      }
      clearAdminAccessCache();
      const { data, error } = await supabase.auth.signInWithPassword({ email: email.trim().toLowerCase(), password });
      if (error) {
        if (/invalid login|credentials/i.test(error.message)) throw new Error("E-mail ou senha inválidos.");
        throw new Error("Não foi possível conectar ao servidor de login. Tente novamente.");
      }
      const { role, error: roleErr } = await resolveRole();
      if (roleErr) throw new Error("Falha temporária ao verificar permissões. Tente novamente.");
      const access = roleToAccess(data.user, role);
      if (access.status !== "ok") {
        await supabase.auth.signOut({ scope: "local" });
        throw new Error("Acesso negado: esta conta não é administradora.");
      }
      // Bind this new session to the admin slot so the panel gate never restores an older one.
      await claimSlot("admin");
      primeAdminAccess(data.session.access_token, access);
      void supabase.from("profiles").update({ last_seen_at: new Date().toISOString() }).eq("id", data.user.id);
      toast.success("Bem-vindo(a) ao painel");
      await navigate({ to: "/admin", replace: true });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Erro ao entrar");
    } finally {
      busy.current = false;
      setLoading(false);
    }
  }

  return (
    <div className="relative flex min-h-screen items-center justify-center overflow-hidden bg-background px-5">
      <div className="pointer-events-none absolute -top-40 left-1/2 h-96 w-96 -translate-x-1/2 rounded-full bg-primary/20 blur-3xl" />
      <div className="animate-rise relative w-full max-w-sm rounded-2xl border border-border bg-card p-8 shadow-glow">
        <div className="mb-6 flex justify-center"><GLTVLogo size="login" /></div>
        <div className="mb-4 flex h-10 w-10 items-center justify-center rounded-xl bg-accent text-primary"><ShieldCheck className="size-5" /></div>
        <h1 className="text-2xl font-semibold">{mode === "login" ? "Acesso administrativo" : "Recuperar senha"}</h1>
        <p className="mt-1 text-sm text-muted-foreground">{mode === "login" ? "Entre com sua conta de administrador." : "Enviaremos um link para redefinir sua senha."}</p>
        <form onSubmit={submit} className="mt-6 space-y-4">
          <div className="space-y-1.5"><Label htmlFor="email">E-mail</Label><Input id="email" type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} required /></div>
          {mode === "login" && (
            <div className="space-y-1.5">
              <Label htmlFor="pw">Senha</Label>
              <div className="relative">
                <Input id="pw" type={show ? "text" : "password"} autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required className="pr-10" />
                <button type="button" onClick={() => setShow(!show)} className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground" aria-label={show ? "Ocultar senha" : "Mostrar senha"}>
                  {show ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>
            </div>
          )}
          <Button type="submit" className="w-full rounded-full" disabled={loading}>
            {loading && <Loader2 className="animate-spin" />} {mode === "login" ? "Entrar" : "Enviar link"}
          </Button>
        </form>
        <button className="mt-4 w-full text-sm text-muted-foreground hover:text-primary" onClick={() => setMode(mode === "login" ? "forgot" : "login")}>
          {mode === "login" ? "Esqueci minha senha" : "Voltar ao login"}
        </button>
      </div>
    </div>
  );
}
