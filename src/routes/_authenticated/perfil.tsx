import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Loader2, LogOut } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuthUser } from "@/lib/user-data";
import { SiteShell, PageTitle } from "@/components/site/SiteShell";
import { ContinueWatchingRow, MyListRow } from "@/components/site/UserRows";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export const Route = createFileRoute("/_authenticated/perfil")({
  head: () => ({
    meta: [
      { title: "Meu perfil — Streaming" },
      { name: "description", content: "Gerencie sua conta e veja o que você está assistindo." },
      { property: "og:title", content: "Meu perfil — Streaming" },
      { property: "og:description", content: "Gerencie sua conta e veja o que você está assistindo." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: Page,
});

function Page() {
  const { user } = useAuthUser();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const profile = useQuery({
    queryKey: ["me", user?.id, "profile"],
    enabled: !!user,
    queryFn: async () => {
      const { data, error } = await supabase.from("profiles").select("name,email,avatar_url").eq("id", user!.id).maybeSingle();
      if (error) throw error;
      return data;
    },
  });
  const [name, setName] = useState("");
  const [saving, setSaving] = useState(false);
  useEffect(() => { if (profile.data) setName(profile.data.name ?? ""); }, [profile.data]);

  const save = async () => {
    if (!user) return;
    setSaving(true);
    const { error } = await supabase.from("profiles").update({ name: name.trim().slice(0, 80) }).eq("id", user.id);
    setSaving(false);
    if (error) toast.error("Não foi possível salvar"); else { toast.success("Perfil atualizado"); qc.invalidateQueries({ queryKey: ["me", user.id, "profile"] }); }
  };
  const signOut = async () => {
    await qc.cancelQueries();
    qc.removeQueries({ queryKey: ["me"] });
    await supabase.auth.signOut();
    navigate({ to: "/", replace: true });
  };

  return (
    <SiteShell>
      <PageTitle title="Meu perfil" subtitle={user?.email} />
      <div className="mx-auto max-w-[1600px] px-4 md:px-10">
        <div className="max-w-md space-y-4 rounded-2xl border border-border bg-card p-6">
          <div className="space-y-2">
            <Label htmlFor="name">Nome</Label>
            <Input id="name" value={name} onChange={(e) => setName(e.target.value)} maxLength={80} />
          </div>
          <div className="flex flex-wrap gap-2">
            <Button onClick={save} disabled={saving || profile.isLoading}>{saving && <Loader2 className="animate-spin" />} Salvar</Button>
            <Button variant="outline" onClick={signOut}><LogOut /> Sair</Button>
          </div>
        </div>
      </div>
      <div className="space-y-6 py-10">
        <ContinueWatchingRow />
        <MyListRow />
      </div>
    </SiteShell>
  );
}
