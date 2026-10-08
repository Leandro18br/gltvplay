/* eslint-disable @typescript-eslint/no-explicit-any */
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { PlaybackField } from "./PlaybackField";
import { SourcesManager } from "./integrations/SourcesManager";
import { validatePlayback, savePlayback } from "@/lib/playback/playback.functions";
import { emptyPlayback, playbackSchema, type PlaybackValue } from "@/lib/playback/embed";
import { toast } from "sonner";
import { ArrowDown, ArrowUp, ChevronLeft, ChevronRight, Loader2, Pencil, Plus, Search, Star, Trash2 } from "lucide-react";
import { db, errMsg, slugify, STATUS_OPTIONS, type Row } from "@/lib/admin/db";
import { ImageField } from "./ImageField";
import { ConfirmDelete } from "./ConfirmDelete";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

type Opt = { value: string; label: string };
export type Field = {
  name: string;
  label: string;
  type: "text" | "textarea" | "number" | "url" | "select" | "boolean" | "image" | "relation" | "genres" | "playback" | "content";
  required?: boolean;
  placeholder?: string;
  options?: Opt[];
  folder?: string;
  aspect?: string;
  table?: string;
  select?: string;
  labelOf?: (r: Row) => string;
  joinTable?: string;
  fk?: string;
  kind?: "movie" | "series" | "episode" | "channel";
  full?: boolean;
  defaultValue?: unknown;
};

export type Column = { key: string; label: string; render?: (r: Row) => ReactNode; className?: string };

export type ResourceConfig = {
  table: string;
  title: string;
  singular: string;
  select?: string;
  fields: Field[];
  columns: Column[];
  searchCol: string;
  hasStatus?: boolean;
  hasFeatured?: boolean;
  hasActive?: boolean;
  slugFrom?: string;
  sortOptions: Opt[];
  scope?: { col: string; table: string; select?: string; label: string; labelOf: (r: Row) => string; order?: string };
  reorderCol?: string;
  rowActions?: (r: Row) => ReactNode;
};

const PAGE = 12;

function useRelation(table?: string, select?: string) {
  return useQuery({
    queryKey: ["rel", table, select],
    enabled: !!table,
    queryFn: async () => {
      const { data, error } = await db.from(table!).select(select ?? "*").limit(1000);
      if (error) throw error;
      return data as Row[];
    },
  });
}

function RelationSelect({ field, value, onChange, kindTable }: { field: Field; value: any; onChange: (v: any) => void; kindTable?: string }) {
  const table = kindTable ?? field.table;
  const { data, isLoading } = useRelation(table, field.select ?? (kindTable ? (kindTable === "channels" ? "id,name" : "id,title") : undefined));
  const labelOf = field.labelOf ?? ((r: Row) => r.title ?? r.name ?? r.id);
  return (
    <Select value={value ?? "none"} onValueChange={(v) => onChange(v === "none" ? null : v)}>
      <SelectTrigger><SelectValue placeholder={isLoading ? "Carregando…" : "Selecionar"} /></SelectTrigger>
      <SelectContent>
        <SelectItem value="none">— Nenhum —</SelectItem>
        {data?.map((r) => <SelectItem key={r.id} value={r.id}>{labelOf(r)}</SelectItem>)}
      </SelectContent>
    </Select>
  );
}

function GenresPicker({ value, onChange }: { value: string[]; onChange: (v: string[]) => void }) {
  const { data } = useRelation("genres", "id,name");
  if (!data?.length) return <p className="text-xs text-muted-foreground">Cadastre gêneros em "Gêneros".</p>;
  return (
    <div className="flex flex-wrap gap-2">
      {data.map((g) => {
        const on = value.includes(g.id);
        return (
          <button type="button" key={g.id} onClick={() => onChange(on ? value.filter((x) => x !== g.id) : [...value, g.id])}
            className={`rounded-full border px-3 py-1 text-xs transition ${on ? "border-primary bg-primary text-primary-foreground" : "border-border text-muted-foreground hover:text-foreground"}`}>
            {g.name}
          </button>
        );
      })}
    </div>
  );
}

export function ResourceManager({ config, initialScope }: { config: ResourceConfig; initialScope?: string | undefined }) {
  const qc = useQueryClient();
  const validateSource = useServerFn(validatePlayback);
  const saveSource = useServerFn(savePlayback);
  const [search, setSearch] = useState("");
  const [debounced, setDebounced] = useState("");
  const [status, setStatus] = useState("all");
  const [scope, setScope] = useState<string>(initialScope ?? "all");
  const [sort, setSort] = useState(config.sortOptions[0]!.value);
  const [page, setPage] = useState(0);
  const [editing, setEditing] = useState<Row | null>(null);
  const [values, setValues] = useState<Row>({});
  const [saving, setSaving] = useState(false);
  const [toDelete, setToDelete] = useState<Row | null>(null);

  useEffect(() => {
    const t = setTimeout(() => { setDebounced(search); setPage(0); }, 300);
    return () => clearTimeout(t);
  }, [search]);

  const scopeRows = useRelation(config.scope?.table, config.scope?.select);
  const key = ["admin", config.table, debounced, status, scope, sort, page];

  const list = useQuery({
    queryKey: key,
    queryFn: async () => {
      const [col, dir] = sort.split(":");
      let q = db.from(config.table).select(config.select ?? "*", { count: "exact" });
      if (debounced) q = q.ilike(config.searchCol, `%${debounced}%`);
      if (config.hasStatus && status !== "all") q = q.eq("status", status);
      if (config.hasActive && status !== "all") q = q.eq("is_active", status === "active");
      if (config.scope && scope !== "all") q = q.eq(config.scope.col, scope);
      q = q.order(col, { ascending: dir === "asc" }).range(page * PAGE, page * PAGE + PAGE - 1);
      const { data, error, count } = await q;
      if (error) throw error;
      return { rows: data as Row[], count: count ?? 0 };
    },
  });

  const refresh = () => qc.invalidateQueries({ queryKey: ["admin", config.table] });
  const pages = Math.max(1, Math.ceil((list.data?.count ?? 0) / PAGE));

  async function openEdit(row: Row | null) {
    const base: Row = {};
    config.fields.forEach((f) => {
      base[f.name] = row ? row[f.name] ?? null : f.defaultValue ?? (f.type === "boolean" ? false : f.type === "genres" ? [] : null);
    });
    if (!row && config.scope && scope !== "all") base[config.scope.col] = scope;
    if (row) {
      for (const f of config.fields) {
        if (f.type === "genres") {
          const { data } = await db.from(f.joinTable!).select("genre_id").eq(f.fk!, row.id);
          base[f.name] = (data ?? []).map((d: Row) => d.genre_id);
        }
        if (f.type === "playback") {
          const { data, error } = await db.from("playback_sources").select("id,url,source_type,is_active,is_primary").eq("content_kind", f.kind).eq("content_id", row.id).order("is_primary", { ascending: false }).order("created_at", { ascending: false }).limit(1);
          if(error){toast.error("Não foi possível carregar a fonte");return;}
          const source=data?.[0];
          base[f.name] = source ? {id:source.id,input:source.url,type:source.source_type,active:source.is_active,primary:source.is_primary} : {...emptyPlayback};
        }
      }
    }
    setValues(base);
    setEditing(row ?? {});
  }

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    try {
      for(const f of config.fields.filter(f=>f.type==="playback")) {
        const value=playbackSchema.parse(values[f.name] ?? emptyPlayback);
        await validateSource({data:value});
      }
      const payload: Row = {};
      for (const f of config.fields) {
        if (f.type === "genres" || f.type === "playback") continue;
        let v = values[f.name];
        if (f.type === "number") v = v === "" || v == null ? null : Number(v);
        if (typeof v === "string" && v.trim() === "") v = null;
        payload[f.name] = v;
      }
      const isNew = !editing?.id;
      // Keep existing public links stable: only create a slug for new rows or rows that never had one.
      if (config.slugFrom && !payload.slug && payload[config.slugFrom] && (isNew || !editing?.slug)) {
        payload.slug = `${slugify(String(payload[config.slugFrom]))}-${Math.random().toString(36).slice(2, 6)}`;
      } else if (!isNew && !payload.slug) {
        delete payload.slug;
      }
      const res = isNew
        ? await db.from(config.table).insert(payload).select("id").single()
        : await db.from(config.table).update(payload).eq("id", editing!.id).select("id").single();
      if (res.error) throw res.error;
      const id = res.data.id as string;

      for (const f of config.fields) {
        if (f.type === "genres") {
          await db.from(f.joinTable!).delete().eq(f.fk!, id);
          const ids = (values[f.name] as string[]) ?? [];
          if (ids.length) {
            const { error } = await db.from(f.joinTable!).insert(ids.map((g) => ({ [f.fk!]: id, genre_id: g })));
            if (error) throw error;
          }
        }
        if (f.type === "playback") {
          if(f.kind!=="movie" && f.kind!=="episode" && f.kind!=="channel")throw new Error("Configure a reprodução por episódio");
          const result=await saveSource({data:{kind:f.kind,contentId:id,value:values[f.name] ?? emptyPlayback}});
          if(result.id) setValues((v:Row)=>({...v,[f.name]:{...v[f.name],id:result.id}}));
        }
      }
      toast.success(isNew ? `${config.singular} criado(a)` : "Alterações salvas");
      setEditing(null);
      refresh();
      qc.invalidateQueries({queryKey:["player"]});
    } catch (err) {
      toast.error(errMsg(err));
    } finally {
      setSaving(false);
    }
  }

  async function quickUpdate(row: Row, patch: Row) {
    const { error } = await db.from(config.table).update(patch).eq("id", row.id);
    if (error) toast.error(errMsg(error));
    else { toast.success("Atualizado"); refresh(); }
  }

  async function remove() {
    if (!toDelete) return;
    const { error } = await db.from(config.table).delete().eq("id", toDelete.id);
    if (error) toast.error(errMsg(error));
    else { toast.success("Excluído"); refresh(); }
    setToDelete(null);
  }

  async function move(row: Row, dir: -1 | 1) {
    const col = config.reorderCol!;
    const rows = list.data?.rows ?? [];
    const idx = rows.findIndex((r) => r.id === row.id);
    const other = rows[idx + dir];
    if (!other) return;
    const a = row[col], b = other[col];
    const r1 = await db.from(config.table).update({ [col]: -100000 - a }).eq("id", row.id);
    const r2 = await db.from(config.table).update({ [col]: a }).eq("id", other.id);
    const r3 = await db.from(config.table).update({ [col]: b }).eq("id", row.id);
    const err = r1.error || r2.error || r3.error;
    if (err) toast.error(errMsg(err)); else refresh();
  }

  const canReorder = !!config.reorderCol && config.scope && scope !== "all" && sort.startsWith(config.reorderCol);
  const set = (k: string, v: unknown) => setValues((s: Row) => ({ ...s, [k]: v }));

  const filterOptions = useMemo(() => {
    if (config.hasStatus) return STATUS_OPTIONS;
    if (config.hasActive) return [{ value: "active", label: "Ativos" }, { value: "inactive", label: "Inativos" }];
    return null;
  }, [config]);

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold md:text-3xl">{config.title}</h1>
          <p className="text-sm text-muted-foreground">{list.data?.count ?? 0} registro(s)</p>
        </div>
        <Button onClick={() => openEdit(null)} className="rounded-full"><Plus /> Novo(a) {config.singular.toLowerCase()}</Button>
      </div>

      <div className="flex flex-col gap-2 rounded-2xl border border-border bg-card p-3 md:flex-row">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input className="pl-9" placeholder="Buscar…" value={search} onChange={(e) => setSearch(e.target.value)} />
        </div>
        {config.scope && (
          <Select value={scope} onValueChange={(v) => { setScope(v); setPage(0); }}>
            <SelectTrigger className="md:w-56"><SelectValue placeholder={config.scope.label} /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Todos — {config.scope.label}</SelectItem>
              {scopeRows.data?.map((r) => <SelectItem key={r.id} value={r.id}>{config.scope!.labelOf(r)}</SelectItem>)}
            </SelectContent>
          </Select>
        )}
        {filterOptions && (
          <Select value={status} onValueChange={(v) => { setStatus(v); setPage(0); }}>
            <SelectTrigger className="md:w-40"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Todos status</SelectItem>
              {filterOptions.map((o) => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}
            </SelectContent>
          </Select>
        )}
        <Select value={sort} onValueChange={(v) => { setSort(v); setPage(0); }}>
          <SelectTrigger className="md:w-48"><SelectValue /></SelectTrigger>
          <SelectContent>{config.sortOptions.map((o) => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}</SelectContent>
        </Select>
      </div>

      <div className="overflow-hidden rounded-2xl border border-border bg-card">
        {list.isLoading ? (
          <div className="flex items-center justify-center gap-2 p-12 text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" /> Carregando…</div>
        ) : list.error ? (
          <div className="p-12 text-center text-destructive">Erro ao carregar: {errMsg(list.error)}</div>
        ) : !list.data?.rows.length ? (
          <div className="p-12 text-center text-muted-foreground">Nenhum registro encontrado.</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="border-b border-border text-left text-xs uppercase tracking-wide text-muted-foreground">
                <tr>
                  {config.columns.map((c) => <th key={c.key} className={`px-4 py-3 font-medium ${c.className ?? ""}`}>{c.label}</th>)}
                  {config.hasStatus && <th className="px-4 py-3 font-medium">Status</th>}
                  {config.hasFeatured && <th className="px-4 py-3 font-medium">Destaque</th>}
                  {config.hasActive && <th className="px-4 py-3 font-medium">Ativo</th>}
                  <th className="px-4 py-3 text-right font-medium">Ações</th>
                </tr>
              </thead>
              <tbody>
                {list.data.rows.map((r, i) => (
                  <tr key={r.id} className="border-b border-border/60 last:border-0 hover:bg-muted/40">
                    {config.columns.map((c) => <td key={c.key} className={`px-4 py-3 ${c.className ?? ""}`}>{c.render ? c.render(r) : String(r[c.key] ?? "—")}</td>)}
                    {config.hasStatus && (
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-2">
                          <Switch checked={r.status === "published"} onCheckedChange={(on) => quickUpdate(r, { status: on ? "published" : "draft" })} aria-label="Publicar" />
                          <Badge variant={r.status === "published" ? "default" : "secondary"}>{STATUS_OPTIONS.find((s) => s.value === r.status)?.label}</Badge>
                        </div>
                      </td>
                    )}
                    {config.hasFeatured && (
                      <td className="px-4 py-3">
                        <button onClick={() => quickUpdate(r, { featured: !r.featured })} aria-label="Destaque">
                          <Star className={`h-5 w-5 ${r.featured ? "fill-primary text-primary" : "text-muted-foreground"}`} />
                        </button>
                      </td>
                    )}
                    {config.hasActive && (
                      <td className="px-4 py-3"><Switch checked={r.is_active} onCheckedChange={(on) => quickUpdate(r, { is_active: on })} /></td>
                    )}
                    <td className="px-4 py-3">
                      <div className="flex justify-end gap-1">
                        {canReorder && (
                          <>
                            <Button size="icon" variant="ghost" disabled={i === 0} onClick={() => move(r, -1)} aria-label="Subir"><ArrowUp /></Button>
                            <Button size="icon" variant="ghost" disabled={i === list.data!.rows.length - 1} onClick={() => move(r, 1)} aria-label="Descer"><ArrowDown /></Button>
                          </>
                        )}
                        {config.rowActions?.(r)}
                        <Button size="icon" variant="ghost" onClick={() => openEdit(r)} aria-label="Editar"><Pencil /></Button>
                        <Button size="icon" variant="ghost" onClick={() => setToDelete(r)} aria-label="Excluir"><Trash2 className="text-destructive" /></Button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div className="flex items-center justify-end gap-2 text-sm text-muted-foreground">
        Página {page + 1} de {pages}
        <Button size="icon" variant="outline" disabled={page === 0} onClick={() => setPage(page - 1)} aria-label="Anterior"><ChevronLeft /></Button>
        <Button size="icon" variant="outline" disabled={page + 1 >= pages} onClick={() => setPage(page + 1)} aria-label="Próxima"><ChevronRight /></Button>
      </div>

      <Dialog open={!!editing} onOpenChange={(o) => !o && !saving && setEditing(null)}>
        <DialogContent className="max-h-[90vh] max-w-3xl overflow-y-auto">
          <DialogHeader><DialogTitle>{editing?.id ? `Editar ${config.singular.toLowerCase()}` : `Novo(a) ${config.singular.toLowerCase()}`}</DialogTitle></DialogHeader>
          <form onSubmit={save} className="grid gap-4 md:grid-cols-2">
            {config.fields.map((f) => (
              <div key={f.name} className={`space-y-1.5 ${f.full || ["textarea", "image", "genres", "playback"].includes(f.type) ? "md:col-span-2" : ""}`}>
                {f.type !== "boolean" && <Label>{f.label}{f.required && " *"}</Label>}
                {["text", "url", "number"].includes(f.type) && (
                  <Input type={f.type === "number" ? "number" : f.type === "url" ? "url" : "text"} required={f.required} placeholder={f.placeholder} value={values[f.name] ?? ""} onChange={(e) => set(f.name, e.target.value)} />
                )}
                {f.type === "textarea" && <Textarea rows={4} required={f.required} value={values[f.name] ?? ""} onChange={(e) => set(f.name, e.target.value)} />}
                {f.type === "select" && (
                  <Select value={values[f.name] ?? ""} onValueChange={(v) => set(f.name, v)}>
                    <SelectTrigger><SelectValue placeholder="Selecionar" /></SelectTrigger>
                    <SelectContent>{f.options!.map((o) => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}</SelectContent>
                  </Select>
                )}
                {f.type === "boolean" && (
                  <label className="flex items-center gap-3 rounded-xl border border-border p-3">
                    <Switch checked={!!values[f.name]} onCheckedChange={(v) => set(f.name, v)} /> <span className="text-sm">{f.label}</span>
                  </label>
                )}
                {f.type === "image" && <ImageField value={values[f.name]} onChange={(v) => set(f.name, v)} folder={f.folder ?? config.table} aspect={f.aspect} />}
                {f.type === "relation" && <RelationSelect field={f} value={values[f.name]} onChange={(v) => set(f.name, v)} />}
                {f.type === "content" && (
                  values.content_kind
                    ? <RelationSelect key={values.content_kind} field={f} kindTable={values.content_kind === "movie" ? "movies" : values.content_kind === "series" ? "series" : "channels"} value={values[f.name]} onChange={(v) => set(f.name, v)} />
                    : <p className="text-xs text-muted-foreground">Escolha o tipo de conteúdo primeiro.</p>
                )}
                {f.type === "genres" && <GenresPicker value={values[f.name] ?? []} onChange={(v) => set(f.name, v)} />}
                {f.type === "playback" && (
                  <PlaybackField value={values[f.name] as PlaybackValue | undefined} onChange={v=>set(f.name,v)} />
                )}
                {f.type === "playback" && (f.kind === "movie" || f.kind === "episode") && (
                  editing?.id
                    ? <SourcesManager kind={f.kind} contentId={editing.id as string} />
                    : <p className="text-xs text-muted-foreground">Salve primeiro para buscar players pela API ou adicionar players alternativos.</p>
                )}
              </div>
            ))}
            <DialogFooter className="md:col-span-2">
              <Button type="button" variant="ghost" onClick={() => setEditing(null)} disabled={saving}>Cancelar</Button>
              <Button type="submit" disabled={saving}>{saving && <Loader2 className="animate-spin" />} Salvar</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <ConfirmDelete open={!!toDelete} onOpenChange={(o) => !o && setToDelete(null)}
        title={`Excluir "${toDelete?.title ?? toDelete?.name ?? ""}"?`}
        description="Esta ação é permanente e removerá também os itens vinculados." onConfirm={remove} />
    </div>
  );
}

export function Thumb({ src, wide }: { src?: string | null; wide?: boolean }) {
  return (
    <div className={`${wide ? "aspect-video w-20" : "aspect-[2/3] w-10"} overflow-hidden rounded-md bg-muted`}>
      {src && <img src={src} alt="" className="h-full w-full object-cover" loading="lazy" />}
    </div>
  );
}
