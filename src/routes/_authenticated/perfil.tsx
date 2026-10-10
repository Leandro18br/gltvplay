import { requireSiteAccess } from "@/lib/access/gate";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Loader2, LogOut, Plus, Trash2, Check, Baby } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { signOutSlot } from "@/lib/auth/session-vault";
import { setActiveProfileId, useActiveProfile, useWatchlist } from "@/lib/user-data";
import { nameSchema } from "@/lib/validation";
import { SiteShell, PageTitle, EmptyState } from "@/components/site/SiteShell";
import { CardGrid } from "@/components/site/ContentCard";
import { FieldError } from "@/components/site/PasswordInput";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "@/components/ui/alert-dialog";

export const Route = createFileRoute("/_authenticated/perfil")({
  beforeLoad: requireSiteAccess,
  head: () => ({
    meta: [
      { title: "Meu perfil — Streaming" },
      { name: "description", content: "Gerencie sua conta, perfis e minha lista." },
      { property: "og:title", content: "Meu perfil — Streaming" },
      { property: "og:description", content: "Gerencie sua conta, perfis e minha lista." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: Page,
});

function Page() {
  const { user } = useActiveProfile();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const signOut = async () => {
    await qc.cancelQueries();
    qc.removeQueries({ queryKey: ["me"] });
    await signOutSlot("client");
    navigate({ to: "/", replace: true });
  };
  return (
    <SiteShell>
      <PageTitle title="Meu perfil" subtitle={user?.email ?? null}>
        <Button variant="outline" className="rounded-full" onClick={signOut}><LogOut /> Sair da conta</Button>
      </PageTitle>
      <div className="mx-auto max-w-[1600px] px-4 md:px-10">
        <Tabs defaultValue="conta">
          <TabsList className="mb-6 flex w-full justify-start overflow-x-auto sm:w-fit">
            <TabsTrigger value="conta">Conta</TabsTrigger>
            <TabsTrigger value="perfis">Perfis</TabsTrigger>
            <TabsTrigger value="lista">Minha lista</TabsTrigger>
          </TabsList>
          <TabsContent value="conta"><AccountTab /></TabsContent>
          <TabsContent value="perfis"><ProfilesTab /></TabsContent>
          <TabsContent value="lista"><ListTab /></TabsContent>
        </Tabs>
      </div>
    </SiteShell>
  );
}

function AccountTab() {
  const { user } = useActiveProfile();
  const qc = useQueryClient();
  const profile = useQuery({
    queryKey: ["me", user?.id, "profile"],
    enabled: !!user,
    queryFn: async () => {
      if (!user) return null;
      const { data, error } = await supabase.from("profiles").select("name,email").eq("id", user.id).maybeSingle();
      if (error) throw error;
      return data;
    },
  });
  const [name, setName] = useState("");
  const [nameErr, setNameErr] = useState<string>();
  const [saving, setSaving] = useState(false);
  useEffect(() => { if (profile.data) setName(profile.data.name ?? ""); }, [profile.data]);

  const saveName = async () => {
    if (!user) return;
    const p = nameSchema.safeParse(name);
    if (!p.success) { setNameErr(p.error.issues[0]?.message); return; }
    setNameErr(undefined);
    setSaving(true);
    const { error } = await supabase.from("profiles").update({ name: p.data }).eq("id", user.id);
    setSaving(false);
    if (error) toast.error("Não foi possível salvar"); else { toast.success("Nome atualizado"); qc.invalidateQueries({ queryKey: ["me", user.id, "profile"] }); }
  };

  return (
    <div className="max-w-2xl">
      <section className="space-y-5 rounded-2xl border border-border bg-card p-6">
        <h2 className="text-lg font-semibold">Dados pessoais</h2>
        <div className="space-y-1.5">
          <Label htmlFor="name">Nome</Label>
          <Input id="name" value={name} onChange={(e) => setName(e.target.value)} maxLength={80} />
          <FieldError msg={nameErr} />
        </div>
        <div className="space-y-1.5">
          <Label>E-mail</Label>
          <Input value={profile.data?.email ?? user?.email ?? ""} disabled />
        </div>
        <Button onClick={saveName} disabled={saving || profile.isLoading}>{saving && <Loader2 className="animate-spin" />} Salvar</Button>
      </section>


    </div>
  );
}

function ProfilesTab() {
  const { user, profiles, active, loading } = useActiveProfile();
  const qc = useQueryClient();
  const [newName, setNewName] = useState("");
  const [kids, setKids] = useState(false);
  const [busy, setBusy] = useState(false);
  const refresh = () => qc.invalidateQueries({ queryKey: ["me", user?.id] });

  const add = async () => {
    const n = newName.trim();
    if (n.length < 1 || n.length > 40) { toast.error("O nome do perfil deve ter de 1 a 40 caracteres"); return; }
    setBusy(true);
    const { error } = await supabase.from("viewer_profiles").insert({ user_id: user!.id, name: n, is_kids: kids });
    setBusy(false);
    if (error) { toast.error(/max 5/.test(error.message) ? "Limite de 5 perfis por conta" : "Não foi possível criar o perfil"); return; }
    toast.success("Perfil criado");
    setNewName(""); setKids(false); refresh();
  };
  const rename = async (id: string, name: string) => {
    const n = name.trim();
    if (!n || n.length > 40) return;
    const { error } = await supabase.from("viewer_profiles").update({ name: n }).eq("id", id);
    if (error) toast.error("Não foi possível renomear"); else { toast.success("Perfil atualizado"); refresh(); }
  };
  const remove = async (id: string) => {
    const { error: e1 } = await supabase.from("watch_history").delete().eq("viewer_profile_id", id);
    const { error: e2 } = await supabase.from("watchlist").delete().eq("viewer_profile_id", id);
    const { error } = await supabase.from("viewer_profiles").delete().eq("id", id);
    if (e1 || e2 || error) toast.error("Não foi possível excluir o perfil"); else { toast.success("Perfil excluído"); refresh(); }
  };

  if (loading) return <Loader2 className="animate-spin text-primary" />;
  return (
    <div className="space-y-6">
      <p className="text-sm text-muted-foreground">Cada perfil tem seu próprio histórico, Minha lista e preferências. Até 5 perfis por conta.</p>
      <ul className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-5">
        {profiles.map((p) => (
          <li key={p.id} className={`space-y-3 rounded-2xl border bg-card p-4 text-center transition ${active?.id === p.id ? "border-primary shadow-glow" : "border-border"}`}>
            <button type="button" onClick={() => { setActiveProfileId(user!.id, p.id); toast.success(`Assistindo como ${p.name}`); }} className="mx-auto flex size-20 items-center justify-center rounded-2xl bg-gradient-to-br from-accent to-primary/40 font-display text-3xl font-bold">
              {p.avatar_url ? <img src={p.avatar_url} alt="" className="h-full w-full rounded-2xl object-cover" /> : p.name.slice(0, 1).toUpperCase()}
            </button>
            <Input defaultValue={p.name} maxLength={40} onBlur={(e) => e.target.value !== p.name && rename(p.id, e.target.value)} className="text-center" aria-label="Nome do perfil" />
            <div className="flex items-center justify-center gap-2 text-xs text-muted-foreground">
              {p.is_kids && <span className="flex items-center gap-1 text-primary"><Baby className="size-3" /> Infantil</span>}
              {active?.id === p.id ? <span className="flex items-center gap-1 text-primary"><Check className="size-3" /> Ativo</span> : (
                <button className="hover:text-foreground" onClick={() => setActiveProfileId(user!.id, p.id)}>Usar este</button>
              )}
            </div>
            {profiles.length > 1 && (
              <AlertDialog>
                <AlertDialogTrigger asChild><Button variant="ghost" size="sm" className="text-destructive"><Trash2 /> Excluir</Button></AlertDialogTrigger>
                <AlertDialogContent>
                  <AlertDialogHeader>
                    <AlertDialogTitle>Excluir o perfil “{p.name}”?</AlertDialogTitle>
                    <AlertDialogDescription>O histórico e a Minha lista deste perfil serão apagados. Esta ação não pode ser desfeita.</AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter><AlertDialogCancel>Cancelar</AlertDialogCancel><AlertDialogAction onClick={() => remove(p.id)}>Excluir</AlertDialogAction></AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
            )}
          </li>
        ))}
      </ul>
      {profiles.length < 5 && (
        <div className="flex max-w-xl flex-wrap items-end gap-3 rounded-2xl border border-dashed border-border p-4">
          <div className="min-w-0 flex-1 space-y-1.5"><Label htmlFor="np">Novo perfil</Label><Input id="np" placeholder="Nome do perfil" value={newName} onChange={(e) => setNewName(e.target.value)} maxLength={40} /></div>
          <label className="flex items-center gap-2 pb-2 text-sm"><Switch checked={kids} onCheckedChange={setKids} /> Infantil</label>
          <Button onClick={add} disabled={busy}>{busy ? <Loader2 className="animate-spin" /> : <Plus />} Adicionar</Button>
        </div>
      )}
    </div>
  );
}

function ListTab() {
  const wl = useWatchlist();
  if (wl.isLoading) return <Loader2 className="animate-spin text-primary" />;
  if (!wl.items.length) return <EmptyState title="Sua lista está vazia" text="Toque no + em qualquer filme ou série para salvá-lo aqui." />;
  return <div className="-mx-4 md:-mx-10"><CardGrid items={wl.items} /></div>;
}
