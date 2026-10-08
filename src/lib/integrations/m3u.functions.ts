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

export const saveM3uList = createServerFn({ method: "POST" }).middleware([requireSupabaseAuth])
  .inputValidator(z.object({ id: z.string().uuid().optional(), name: z.string().trim().min(1).max(80), url: z.string().trim().max(4000).optional(), list_type: z.enum(["auto", "m3u", "m3u_plus"]), is_active: z.boolean(), enrich_tmdb: z.boolean() }))
  .handler(async ({ data, context }) => {
    await assertAdmin(context);
    if (!data.id && !data.url) throw new Error("Informe a URL da lista");
    if (data.url) assertSafeListUrl(data.url);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const db = supabaseAdmin as any;
    const row: any = { name: data.name, list_type: data.list_type, is_active: data.is_active, enrich_tmdb: data.enrich_tmdb };
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

export const startM3uSync = createServerFn({ method: "POST" }).middleware([requireSupabaseAuth])
  .inputValidator(z.object({ listId: z.string().uuid() }))
  .handler(async ({ data, context }) => {
    await assertAdmin(context);
    const S = await import("./m3u.server");
    try { return { ok: true as const, ...(await S.startSync(data.listId)) }; } catch (e) { return { ok: false as const, error: msg(e) }; }
  });

export const processM3uChunk = createServerFn({ method: "POST" }).middleware([requireSupabaseAuth])
  .inputValidator(z.object({ listId: z.string().uuid() }))
  .handler(async ({ data, context }) => {
    await assertAdmin(context);
    const S = await import("./m3u.server");
    return S.processChunk(data.listId);
  });
