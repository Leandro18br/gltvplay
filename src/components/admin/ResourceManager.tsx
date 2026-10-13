import { safeImageUrl } from "@/lib/tmdb/completion";
/* eslint-disable @typescript-eslint/no-explicit-any */
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Checkbox } from "@/components/ui/checkbox";
import { BULK_TABLES, runBulk, summarize, type BulkAction } from "@/lib/admin/bulk";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { PlaybackField } from "./PlaybackField";
import { SourcesManager } from "./integrations/SourcesManager";
import { TmdbRefreshButton, TmdbCompleteEpisodesButton } from "./tmdb/TmdbTools";
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
  type: "text" | "textarea" | "number" | "url" | "select" | "boolean" | "image" | "relation" | "genres" | "playback" | "content" | "sources";
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
  /** Hidden when creating; new rows use defaultValue. */
  editOnly?: boolean;
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
  addLabel?: string;
  /** After creating, keep the form open so related items (e.g. players) can be added. */
  stayOpenAfterCreate?: boolean;
  /** Fixed query filters and values for scoped resource managers. */
  fixedFilters?: Record<string, string>;
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

export function ResourceManager({ config, initialScope, lockScope, editId, title }: { config: ResourceConfig; initialScope?: string | undefined; lockScope?: boolean; editId?: string | undefined; title?: string }) {
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
  const [tmdbBusy, setTmdbBusy] = useState(false);
  const [toDelete, setToDelete] = useState<Row | null>(null);

  useEffect(() => {
    const t = setTimeout(() => { setDebounced(search); setPage(0); }, 300);
    return () => clearTimeout(t);
  }, [search]);

  const scopeRows = useRelation(config.scope?.table, config.scope?.select);
  const key = ["admin", config.table, debounced, status, scope, sort, page];
  const bulkKind = BULK_TABLES[config.table];
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [allMode, setAllMode] = useState(false);
  const [bulkAsk, setBulkAsk] = useState<BulkAction | null>(null);
  const [bulkBusy, setBulkBusy] = useState<string | null>(null);
  const [typed, setTyped] = useState("");
  const busyRef = useRef(false);

  function applyFilters(q: any) {
    if (debounced) q = q.ilike(config.searchCol, `%${debounced}%`);
    if (config.hasStatus && status !== "all") q = q.eq("status", status);
    if (config.hasActive && status !== "all") q = q.eq("is_active", status === "active");
    if (config.scope && scope !== "all") q = q.eq(config.scope.col, scope);
    for (const [column, value] of Object.entries(config.fixedFilters ?? {})) q = q.eq(column, value);
    return q;
  }

  // Filters changed: drop the selection so it never targets rows the user no longer sees.
  useEffect(() => { setSelected(new Set()); setAllMode(false); }, [debounced, status, scope]);

  const list = useQuery({
    queryKey: key,
    queryFn: async () => {
      const [col, dir] = sort.split(":");
      let q = applyFilters(db.from(config.table).select(config.select ?? "*", { count: "exact" }));
      q = q.order(col, { ascending: dir === "asc" }).range(page * PAGE, page * PAGE + PAGE - 1);
      const { data, error, count } = await q;
      // After deleting, the current page may no longer exist: jump back to the last valid one.
      if (error?.code === "PGRST103" || (error && /range/i.test(error.message))) { setPage(0); return { rows: [], count: 0 }; }
      if (error) throw error;
      return { rows: data as Row[], count: count ?? 0 };
    },
  });

  const total = list.data?.count ?? 0;
  const selCount = allMode ? total : selected.size;
  const pageIds = (list.data?.rows ?? []).map((r) => r.id as string);
  const pageAllOn = pageIds.length > 0 && (allMode || pageIds.every((id) => selected.has(id)));

  function togglePage() {
    if (allMode) { setAllMode(false); setSelected(new Set()); return; }
    setSelected((s) => { const n = new Set(s); pageIds.forEach((id) => (pageAllOn ? n.delete(id) : n.add(id))); return n; });
  }
  function toggleOne(id: string) {
    if (allMode) { setAllMode(false); setSelected(new Set(allModeIdsFallback(id))); return; }
    setSelected((s) => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });
  }
  // Leaving "all results" mode by unchecking a row keeps the rest of the current page selected.
  function allModeIdsFallback(id: string) { return pageIds.filter((x) => x !== id); }

  async function collectIds(): Promise<string[]> {
    if (!allMode) return [...selected];
    const ids: string[] = [];
    for (let from = 0; ; from += 1000) {
      const { data, error } = await applyFilters(db.from(config.table).select("id")).order("id").range(from, from + 999);
      if (error) throw error;
      ids.push(...(data as Row[]).map((r) => r.id as string));
      if ((data as Row[]).length < 1000) break;
    }
    return ids;
  }

  async function runBulkAction(action: BulkAction) {
    if (!bulkKind || busyRef.current) return;
    busyRef.current = true;
    setBulkAsk(null); setTyped("");
    try {
      setBulkBusy("Preparando seleção…");
      const ids = await collectIds();
      const res = await runBulk(bulkKind, action, ids, (d) => setBulkBusy(`Processando ${d} de ${ids.length}…`));
      const s = summarize(res, action, config.title.toLowerCase());
      (s.ok ? toast.success : toast.error)(s.text, { duration: 10000 });
      setSelected(new Set(res.failed)); setAllMode(false);
    } catch (err) {
      toast.error(errMsg(err));
    } finally {
      busyRef.current = false; setBulkBusy(null); refresh(); qc.invalidateQueries({ queryKey: ["admin"] });
    }
  }
  const bigDelete = selCount > 50;

  // Opens a record directly (e.g. "Editar série" from the series page).
  useEffect(() => {
    if (!editId) return;
    db.from(config.table).select(config.select ?? "*").eq("id", editId).maybeSingle().then(({ data }: { data: Row | null }) => { if (data) openEdit(data); });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editId]);

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
      const payload: Row = { ...(config.fixedFilters ?? {}) };
      for (const f of config.fields) {
        if (f.type === "genres" || f.type === "playback" || f.type === "sources") continue;
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
      if (isNew && config.stayOpenAfterCreate) { setEditing({ ...payload, id }); toast.info("Agora adicione as fontes / players abaixo."); }
      else setEditing(null);
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
          <h1 className="text-2xl font-bold md:text-3xl">{title ?? config.title}</h1>
          <p className="text-sm text-muted-foreground">{list.data?.count ?? 0} registro(s)</p>
        </div>
        <Button onClick={() => openEdit(null)} className="rounded-full"><Plus /> {config.addLabel ?? `Novo(a) ${config.singular.toLowerCase()}`}</Button>
      </div>

      <div className="flex flex-col gap-2 rounded-2xl border border-border bg-card p-3 md:flex-row">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input className="pl-9" placeholder="Buscar…" value={search} onChange={(e) => setSearch(e.target.value)} />
        </div>
        {config.scope && !lockScope && (
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

      {bulkKind && total > 0 && (
        <div className="sticky top-2 z-20 flex flex-wrap items-center gap-2 rounded-2xl border border-border bg-card/95 p-3 text-sm backdrop-blur">
          <span className="font-medium">{selCount} selecionado(s)</span>
          <span className="text-muted-foreground">{allMode ? `— todos os ${total} resultados (todas as páginas)` : selCount ? "— apenas os marcados" : ""}</span>
          <div className="ml-auto flex flex-wrap gap-2">
            <Button size="sm" variant="outline" disabled={!!bulkBusy || allMode} onClick={() => { setAllMode(true); setSelected(new Set()); }}>Selecionar todos ({total})</Button>
            <Button size="sm" variant="ghost" disabled={!!bulkBusy || !selCount} onClick={() => { setAllMode(false); setSelected(new Set()); }}>Limpar seleção</Button>
            <Button size="sm" variant="secondary" disabled={!!bulkBusy || !selCount} onClick={() => setBulkAsk("draft")}>Mover para rascunho</Button>
            <Button size="sm" variant="destructive" disabled={!!bulkBusy || !selCount} onClick={() => setBulkAsk("delete")}><Trash2 /> Excluir selecionados</Button>
          </div>
          {bulkBusy && <div className="flex w-full items-center gap-2 text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" /> {bulkBusy}</div>}
        </div>
      )}

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
                  {bulkKind && <th className="w-10 px-4 py-3"><Checkbox checked={pageAllOn} onCheckedChange={togglePage} aria-label="Selecionar página" /></th>}
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
                    {bulkKind && <td className="w-10 px-4 py-3"><Checkbox checked={allMode || selected.has(r.id)} onCheckedChange={() => toggleOne(r.id)} aria-label="Selecionar" /></td>}
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

      <Dialog open={!!editing} onOpenChange={(o) => !o && !saving && !tmdbBusy && setEditing(null)}>
        <DialogContent className="max-h-[90vh] max-w-3xl overflow-y-auto">
          <DialogHeader><DialogTitle>{editing?.id ? `Editar ${config.singular.toLowerCase()}` : `Novo(a) ${config.singular.toLowerCase()}`}</DialogTitle></DialogHeader>
          <form onSubmit={save} className="grid gap-4 md:grid-cols-2">
            {editing?.id && (config.table === "movies" || config.table === "series") && (
              <div className="flex min-w-0 flex-wrap items-start gap-3 md:col-span-2">
                <TmdbRefreshButton key={editing.id} kind={config.table === "movies" ? "movie" : "series"} id={editing.id as string} disabled={saving || tmdbBusy} onBusyChange={setTmdbBusy} onDone={async (result) => {
                  const id = editing.id;
                  const join = config.table === "movies" ? "movie_genres" : "series_genres";
                  const fk = config.table === "movies" ? "movie_id" : "series_id";
                  const { data: genres } = await db.from(join).select("genre_id").eq(fk, id);
                  setValues((current: Row) => {
                    const next = { ...current };
                    for (const [name, value] of Object.entries(result.fields)) {
                      if (current[name] === editing[name] || current[name] == null || current[name] === "") next[name] = value;
                    }
                    next.genres = [...new Set([...(current.genres ?? []), ...(genres ?? []).map((g: Row) => g.genre_id)])];
                    return next;
                  });
                  setEditing((current: Row | null) => current?.id === id ? { ...current, ...result.fields } : current);
                }} />
                {config.table === "series" && <TmdbCompleteEpisodesButton key={`episodes-${editing.id}`} seriesId={editing.id as string} disabled={saving || tmdbBusy} onBusyChange={setTmdbBusy} />}
              </div>
            )}
            {config.fields.filter((f) => !(lockScope && f.name === config.scope?.col) && !(f.editOnly && !editing?.id)).map((f) => (
              <div key={f.name} className={`space-y-1.5 ${f.full || ["textarea", "image", "genres", "playback", "sources"].includes(f.type) ? "md:col-span-2" : ""}`}>
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
                {f.type === "sources" && (f.kind === "movie" || f.kind === "episode") && (
                  editing?.id
                    ? <SourcesManager kind={f.kind} contentId={editing.id as string} />
                    : <p className="rounded-xl border border-dashed border-border p-3 text-xs text-muted-foreground">Clique em Salvar para criar o episódio; o formulário continua aberto para você adicionar as fontes / players.</p>
                )}
                {f.type === "playback" && (f.kind === "movie" || f.kind === "episode") && (
                  editing?.id
                    ? <SourcesManager kind={f.kind} contentId={editing.id as string} />
                    : <p className="text-xs text-muted-foreground">Salve primeiro para buscar players pela API ou adicionar players alternativos.</p>
                )}
              </div>
            ))}
            <DialogFooter className="md:col-span-2">
              <Button type="button" variant="ghost" onClick={() => setEditing(null)} disabled={saving || tmdbBusy}>Cancelar</Button>
              <Button type="submit" disabled={saving || tmdbBusy}>{saving && <Loader2 className="animate-spin" />} Salvar</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog open={!!bulkAsk} onOpenChange={(o) => { if (!o) { setBulkAsk(null); setTyped(""); } }}>
        <DialogContent>
          <DialogHeader><DialogTitle>{bulkAsk === "delete" ? `Excluir ${selCount} ${config.title.toLowerCase()}?` : `Mover ${selCount} ${config.title.toLowerCase()} para rascunho?`}</DialogTitle></DialogHeader>
          {bulkAsk === "delete" ? (
            <div className="space-y-3 text-sm text-muted-foreground">
              <p>Serão excluídos permanentemente <b className="text-foreground">{selCount}</b> registro(s) de <b className="text-foreground">{config.title}</b>{allMode ? " (todos os resultados do filtro atual, em todas as páginas)" : ""}, junto com seus players.</p>
              {config.table === "series" && <p className="text-destructive">Todas as temporadas e episódios dessas séries também serão removidos.</p>}
              <p className="font-medium text-destructive">Esta operação é permanente e não pode ser desfeita.</p>
              {bigDelete && (
                <div className="space-y-1.5"><Label>Grande volume: digite EXCLUIR para confirmar</Label><Input value={typed} onChange={(e) => setTyped(e.target.value)} autoFocus /></div>
              )}
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">Os registros saem do site público, mas continuam salvos com todos os dados e podem ser publicados de novo.{config.table === "series" ? " Temporadas e episódios dessas séries também ficam ocultos no site." : ""}</p>
          )}
          <DialogFooter>
            <Button variant="ghost" onClick={() => setBulkAsk(null)}>Cancelar</Button>
            <Button variant={bulkAsk === "delete" ? "destructive" : "default"} disabled={!!bulkBusy || (bulkAsk === "delete" && bigDelete && typed.trim().toUpperCase() !== "EXCLUIR")} onClick={() => runBulkAction(bulkAsk!)}>
              {bulkAsk === "delete" ? "Excluir definitivamente" : "Mover para rascunho"}
            </Button>
          </DialogFooter>
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
      {safeImageUrl(src) && <img src={safeImageUrl(src)!} alt="" className="h-full w-full object-cover" loading="lazy" onError={(e) => { e.currentTarget.style.display = "none"; }} />}
    </div>
  );
}
