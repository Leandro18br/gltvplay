import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import { Loader2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { ImageField } from "@/components/admin/ImageField";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export const Route = createFileRoute("/admin/profile")({ component: Profile });

function Profile() {
  const { user } = Route.useRouteContext();
  const { data } = useQuery({
    queryKey: ["admin", "me", user.id],
    queryFn: async () => (await supabase.from("profiles").select("*").eq("id", user.id).single()).data,
  });
  const [name, setName] = useState("");
  const [avatar, setAvatar] = useState<string | null>(null);
  const [pw, setPw] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => { if (data) { setName(data.name ?? ""); setAvatar(data.avatar_url); } }, [data]);

  async function saveProfile(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    const { error } = await supabase.from("profiles").update({ name, avatar_url: avatar }).eq("id", user.id);
    setBusy(false);
    if (error) toast.error(error.message); else toast.success("Perfil atualizado");
  }
  async function savePw(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    const { error } = await supabase.auth.updateUser({ password: pw });
    setBusy(false);
    if (error) toast.error(error.message); else { toast.success("Senha alterada"); setPw(""); }
  }

  return (
    <div className="max-w-2xl space-y-5">
      <h1 className="text-2xl font-bold md:text-3xl">Meu perfil</h1>
      <form onSubmit={saveProfile} className="space-y-4 rounded-2xl border border-border bg-card p-5">
        <div className="space-y-1.5"><Label>E-mail</Label><Input value={user.email ?? ""} disabled /></div>
        <div className="space-y-1.5"><Label>Nome</Label><Input value={name} onChange={(e) => setName(e.target.value)} /></div>
        <div className="max-w-xs space-y-1.5"><Label>Avatar</Label><ImageField value={avatar} onChange={setAvatar} folder="avatars" aspect="aspect-square" /></div>
        <Button disabled={busy}>{busy && <Loader2 className="animate-spin" />} Salvar perfil</Button>
      </form>
      <form onSubmit={savePw} className="space-y-4 rounded-2xl border border-border bg-card p-5">
        <h2 className="font-semibold">Alterar senha</h2>
        <div className="space-y-1.5"><Label>Nova senha</Label><Input type="password" minLength={8} value={pw} onChange={(e) => setPw(e.target.value)} required /></div>
        <Button disabled={busy} variant="secondary">Alterar senha</Button>
      </form>
    </div>
  );
}
