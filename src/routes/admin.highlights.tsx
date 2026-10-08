import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Loader2, Star } from "lucide-react";
import { db, errMsg, type Row } from "@/lib/admin/db";
import { Thumb } from "@/components/admin/ResourceManager";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";

export const Route = createFileRoute("/admin/highlights")({ component: Highlights });

const TABS = [
  { v: "movies", label: "Filmes", name: "title", img: "poster_url" },
  { v: "series", label: "Séries", name: "title", img: "poster_url" },
  { v: "channels", label: "Canais", name: "name", img: "logo_url" },
] as const;

function Highlights() {
  const qc = useQueryClient();
  const [tab, setTab] = useState<(typeof TABS)[number]["v"]>("movies");
  const cfg = TABS.find((t) => t.v === tab)!;
  const list = useQuery({
    queryKey: ["admin", "highlights", tab],
    queryFn: async () => {
      const { data, error } = await db.from(tab).select(`id, ${cfg.name}, ${cfg.img}, featured, sort_order, status`).order("featured", { ascending: false }).order("sort_order").limit(200);
      if (error) throw error;
      return data as Row[];
    },
  });

  async function update(id: string, patch: Row) {
    const { error } = await db.from(tab).update(patch).eq("id", id);
    if (error) toast.error(errMsg(error)); else { toast.success("Destaques atualizados"); qc.invalidateQueries({ queryKey: ["admin", "highlights", tab] }); }
  }

  return (
    <div className="space-y-5">
      <div><h1 className="text-2xl font-bold md:text-3xl">Destaques</h1><p className="text-sm text-muted-foreground">Escolha o que aparece em destaque na página inicial e a ordem de exibição.</p></div>
      <Tabs value={tab} onValueChange={(v) => setTab(v as typeof tab)}>
        <TabsList>{TABS.map((t) => <TabsTrigger key={t.v} value={t.v}>{t.label}</TabsTrigger>)}</TabsList>
      </Tabs>
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {list.isLoading && <Loader2 className="animate-spin" />}
        {list.data?.length === 0 && <p className="text-muted-foreground">Nenhum item cadastrado.</p>}
        {list.data?.map((r) => (
          <div key={r.id} className={`flex items-center gap-3 rounded-2xl border bg-card p-3 transition ${r.featured ? "border-primary/50 shadow-glow" : "border-border"}`}>
            <Thumb src={r[cfg.img]} wide={tab === "channels"} />
            <div className="min-w-0 flex-1">
              <p className="truncate font-medium">{r[cfg.name]}</p>
              <p className="text-xs text-muted-foreground">{r.status === "published" ? "Publicado" : "Não publicado"}</p>
            </div>
            <Input type="number" className="w-16" defaultValue={r.sort_order} onBlur={(e) => Number(e.target.value) !== r.sort_order && update(r.id, { sort_order: Number(e.target.value) })} aria-label="Ordem" />
            <div className="flex flex-col items-center gap-1">
              <Star className={`h-4 w-4 ${r.featured ? "fill-primary text-primary" : "text-muted-foreground"}`} />
              <Switch checked={r.featured} onCheckedChange={(v) => update(r.id, { featured: v })} />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
