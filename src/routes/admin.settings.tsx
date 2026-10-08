import { createFileRoute, redirect } from "@tanstack/react-router";
import { isAdminRole as isAdminRoleGuard } from "@/lib/admin/db";
import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Loader2 } from "lucide-react";
import { db, errMsg, type Row } from "@/lib/admin/db";
import { ImageField } from "@/components/admin/ImageField";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { EmbedSettings } from "@/components/admin/EmbedSettings";

export const Route = createFileRoute("/admin/settings")({
  beforeLoad: ({ context }) => { if (!isAdminRoleGuard(context.role)) throw redirect({ to: "/admin" }); },
  head:()=>({meta:[{title:"Configurações e embeds — GLTV Plus ADM"},{name:"description",content:"Configurações da plataforma e domínios autorizados de reprodução."},{property:"og:title",content:"Configurações — GLTV Plus ADM"},{property:"og:description",content:"Gerencie identidade e permissões de embeds."},{property:"og:type",content:"website"},{name:"twitter:card",content:"summary"}]}),
  component: SettingsPage,
});

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="rounded-2xl border border-border bg-card p-5">
      <h2 className="mb-4 font-semibold">{title}</h2>
      <div className="grid gap-4 md:grid-cols-2">{children}</div>
    </section>
  );
}

function SettingsPage() {
  const qc = useQueryClient();
  const { data, isLoading } = useQuery({
    queryKey: ["admin", "settings"],
    queryFn: async () => {
      const { data, error } = await db.from("site_settings").select("*").eq("id", 1).single();
      if (error) throw error;
      return data as Row;
    },
  });
  const [s, setS] = useState<Row | null>(null);
  const [saving, setSaving] = useState(false);
  useEffect(() => { if (data) setS(structuredClone(data)); }, [data]);

  if (isLoading || !s) return <Loader2 className="animate-spin" />;

  const set = (k: string, v: unknown) => setS({ ...s, [k]: v });
  const setIn = (group: string, k: string, v: unknown) => setS({ ...s, [group]: { ...(s[group] ?? {}), [k]: v } });
  const txt = (group: string, k: string, label: string, ph?: string) => (
    <div className="space-y-1.5"><Label>{label}</Label><Input placeholder={ph} value={s[group]?.[k] ?? ""} onChange={(e) => setIn(group, k, e.target.value)} /></div>
  );

  async function save() {
    setSaving(true);
    if (!s) { setSaving(false); return; }
    const { id: _id, updated_at: _u, embed_allow_iframe: _embed, ...payload } = s;
    const { error } = await db.from("site_settings").update(payload).eq("id", 1);
    setSaving(false);
    if (error) { toast.error(errMsg(error)); return; }
    toast.success("Configurações salvas — o site público já reflete as mudanças");
    qc.invalidateQueries({ queryKey: ["admin", "settings"] });
    qc.invalidateQueries({ queryKey: ["site_settings"] });
  }

  return (
    <div className="space-y-5 pb-20">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div><h1 className="text-2xl font-bold md:text-3xl">Configurações</h1><p className="text-sm text-muted-foreground">Identidade e comportamento do site público.</p></div>
        <Button onClick={save} disabled={saving} className="rounded-full">{saving && <Loader2 className="animate-spin" />} Salvar alterações</Button>
      </div>

      <Section title="Identidade">
        <div className="space-y-1.5 md:col-span-2"><Label>Nome da plataforma</Label><Input value={s.platform_name} onChange={(e) => set("platform_name", e.target.value)} /></div>
        <div className="space-y-1.5"><Label>Logo</Label><ImageField value={s.logo_url} onChange={(v) => set("logo_url", v)} folder="brand" aspect="aspect-[3/1]" /></div>
        <div className="space-y-1.5"><Label>Favicon</Label><ImageField value={s.favicon_url} onChange={(v) => set("favicon_url", v)} folder="brand" aspect="aspect-square" /></div>
      </Section>

      <Section title="Cores">
        {[["primary", "Cor de destaque", "#9fd4f5"], ["background", "Cor de fundo", "#0b0d10"]].map(([k, label, def]) => (
          <div key={k} className="space-y-1.5">
            <Label>{label}</Label>
            <div className="flex gap-2">
              <input type="color" value={s.colors?.[k!] ?? def} onChange={(e) => setIn("colors", k!, e.target.value)} className="h-10 w-14 cursor-pointer rounded-md border border-border bg-transparent" />
              <Input value={s.colors?.[k!] ?? ""} placeholder={`Padrão ${def}`} onChange={(e) => setIn("colors", k!, e.target.value)} />
            </div>
          </div>
        ))}
      </Section>

      <Section title="Banner padrão (quando não há banners cadastrados)">
        {txt("banner", "title", "Título")}
        {txt("banner", "subtitle", "Subtítulo")}
        <div className="space-y-1.5 md:col-span-2"><Label>Imagem</Label><ImageField value={s.banner?.image_url} onChange={(v) => setIn("banner", "image_url", v)} folder="banners" /></div>
      </Section>

      <Section title="Textos">
        {txt("texts", "tagline", "Frase de apresentação", "Filmes, séries e canais em um só lugar")}
        {txt("texts", "empty_catalog", "Mensagem de catálogo vazio")}
        <div className="space-y-1.5 md:col-span-2"><Label>Texto do rodapé</Label><Textarea value={s.texts?.footer ?? ""} onChange={(e) => setIn("texts", "footer", e.target.value)} /></div>
      </Section>

      <Section title="Redes sociais">
        {txt("social_links", "instagram", "Instagram", "https://instagram.com/…")}
        {txt("social_links", "facebook", "Facebook")}
        {txt("social_links", "x", "X / Twitter")}
        {txt("social_links", "youtube", "YouTube")}
        {txt("social_links", "tiktok", "TikTok")}
      </Section>

      <EmbedSettings />
      <Section title="Geral">
        {txt("general", "contact_email", "E-mail de contato")}
        {txt("general", "support_url", "Link de suporte")}
        {[["maintenance_mode", "Modo manutenção (exibe aviso no site)"], ["allow_signup", "Permitir novos cadastros"]].map(([k, label]) => (
          <label key={k} className="flex items-center gap-3 rounded-xl border border-border p-3">
            <Switch checked={s.general?.[k!] ?? k === "allow_signup"} onCheckedChange={(v) => setIn("general", k!, v)} /><span className="text-sm">{label}</span>
          </label>
        ))}
      </Section>
    </div>
  );
}
