/* eslint-disable @typescript-eslint/no-explicit-any */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { assertSafeListUrl, maskListUrl } from "./m3u";

async function assertAdmin(ctx: { supabase: any; userId: string }) {
  const { data, error } = await ctx.supabase.rpc("is_admin", { _user_id: ctx.userId });
  if (error || !data) throw new Error("Acesso negado");
}
const msg = (e: unknown) => (e instanceof Error ? e.message : "Erro inesperado");

const filter = z.object({
  listId: z.string().uuid(),
  kind: z.enum(["all", "movie", "series", "channel"]),
  status: z.enum(["all", "imported", "not_imported", "error", "missing"]),
  group: z.string().max(200).nullish(),
  q: z.string().max(200).optional(),
});

export const saveM3uList = createServerFn({ method: "POST" }).middleware([requireSupabaseAuth])
  .inputValidator(z.object({ id: z.string().uuid().optional(), name: z.string().trim().min(1).max(80), url: z.string().trim().max(4000).optional(), list_type: z.enum(["auto", "m3u", "m3u_plus"]), is_active: z.boolean(), enrich_tmdb: z.boolean(), index_batch_size: z.union([z.literal(100), z.literal(250), z.literal(500), z.literal(1000)]).optional() }))
  .handler(async ({ data, context }) => {
    await assertAdmin(context);
    if (!data.id && !data.url) throw new Error("Informe a URL da lista");
    if (data.url) assertSafeListUrl(data.url);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const db = supabaseAdmin as any;
    const row: any = { name: data.name, list_type: data.list_type, is_active: data.is_active, enrich_tmdb: data.enrich_tmdb };
    if (data.index_batch_size) row.index_batch_size = data.index_batch_size;
    if (data.url) row.url_hint = maskListUrl(data.url);
    let id = data.id;
    if (id) { const r = await context.supabase.from("m3u_lists").update(row).eq("id", id); if (r.error) throw new Error("Não foi possível salvar"); }
    else { const r = await context.supabase.from("m3u_lists").insert(row).select("id").single(); if (r.error) throw new Error("Não foi possível salvar"); id = r.data.id; }
    if (data.url) await db.from("m3u_list_secrets").upsert({ list_id: id, url: data.url, updated_at: new Date().toISOString() });
    return { id };
  });

export const testM3uList = createServerFn({ method: "POST" }).middleware([requireSupabaseAuth])
  .inputValidator(z.object({ listId: z.string().uuid().optional(), url: z.string().trim().max(4000).optional() }))
  .handler(async ({ data, context }) => {
    await assertAdmin(context);
    const S = await import("./m3u.server");
    try { return await S.testList(data); } catch (e) { return { ok: false as const, error: msg(e) }; }
  });

/** One resumable indexing step (catalog only; never imports into the main catalog). */
export const indexM3uStep = createServerFn({ method: "POST" }).middleware([requireSupabaseAuth])
  .inputValidator(z.object({ listId: z.string().uuid(), restart: z.boolean().default(false) }))
  .handler(async ({ data, context }) => {
    await assertAdmin(context);
    const S = await import("./m3u.server");
    try { return { ok: true as const, ...(await S.indexStep(data.listId, data.restart)) }; } catch (e) { return { ok: false as const, error: msg(e) }; }
  });

export const exploreM3u = createServerFn({ method: "POST" }).middleware([requireSupabaseAuth])
  .inputValidator(filter.extend({ page: z.number().int().min(1).max(100000), pageSize: z.number().int().min(10).max(100) }))
  .handler(async ({ data, context }) => {
    await assertAdmin(context);
    const S = await import("./m3u.server");
    return S.explore(data);
  });

export const m3uGroups = createServerFn({ method: "POST" }).middleware([requireSupabaseAuth])
  .inputValidator(z.object({ listId: z.string().uuid(), kind: z.enum(["all", "movie", "series", "channel"]) }))
  .handler(async ({ data, context }) => {
    await assertAdmin(context);
    const S = await import("./m3u.server");
    return S.groups(data.listId, data.kind);
  });

/** Next N not-imported ids for "Importar por lote" (max 500 per operation). */
export const pickM3uItems = createServerFn({ method: "POST" }).middleware([requireSupabaseAuth])
  .inputValidator(filter.extend({ limit: z.union([z.literal(50), z.literal(100), z.literal(250), z.literal(500)]) }))
  .handler(async ({ data, context }) => {
    await assertAdmin(context);
    const S = await import("./m3u.server");
    return S.pickIds(data, data.limit);
  });

/** Imports up to 10 items per request; series continue as "partial" until all episodes are in. */
export const importM3uItems = createServerFn({ method: "POST" }).middleware([requireSupabaseAuth])
  .inputValidator(z.object({ listId: z.string().uuid(), ids: z.array(z.number().int().positive()).min(1).max(10), jobStart: z.string().datetime(), batchId: z.string().max(80) }))
  .handler(async ({ data, context }) => {
    await assertAdmin(context);
    const S = await import("./m3u.server");
    return S.importItems(data.listId, data.ids, data.jobStart, data.batchId);
  });
