/* eslint-disable @typescript-eslint/no-explicit-any */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { linkCategories } from "./categories";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { extractPlayer, mapCatalog, maskSecret, VARIABLES, type CatalogItem } from "./engine";

type Ctx = { supabase: any; userId: string };
async function assertRole(ctx: Ctx, fn: "is_admin" | "is_staff") {
  const { data, error } = await ctx.supabase.rpc(fn, { _user_id: ctx.userId });
  if (error || !data) throw new Error("Acesso negado");
}
const varsSchema = z.object(Object.fromEntries(VARIABLES.map(v => [v, z.string().trim().max(300).optional()]))).partial();
const uuid = z.string().uuid();

export const saveCredentials = createServerFn({ method: "POST" }).middleware([requireSupabaseAuth])
  .inputValidator(z.object({ integrationId: uuid, apiKey: z.string().max(4000).optional(), token: z.string().max(4000).optional(), clear: z.boolean().optional() }))
  .handler(async ({ data, context }) => {
    await assertRole(context, "is_admin");
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const db = supabaseAdmin as any;
    const { data: cur } = await db.from("api_credentials").select("api_key,token").eq("integration_id", data.integrationId).maybeSingle();
    const api_key = data.clear ? null : data.apiKey?.trim() ? data.apiKey.trim() : cur?.api_key ?? null;
    const token = data.clear ? null : data.token?.trim() ? data.token.trim() : cur?.token ?? null;
    const r = await db.from("api_credentials").upsert({ integration_id: data.integrationId, api_key, token, updated_at: new Date().toISOString() });
    if (r.error) throw new Error("Não foi possível salvar as credenciais");
    await db.from("api_integrations").update({ key_hint: api_key ? maskSecret(api_key) : null, token_hint: token ? maskSecret(token) : null }).eq("id", data.integrationId);
    return { ok: true };
  });

export const testIntegration = createServerFn({ method: "POST" }).middleware([requireSupabaseAuth])
  .inputValidator(z.object({ integrationId: uuid, endpointId: uuid.optional(), vars: varsSchema, noCache: z.boolean().optional() }))
  .handler(async ({ data, context }) => {
    await assertRole(context, "is_admin");
    const R = await import("./runner.server");
    const integ = await R.loadIntegration(data.integrationId);
    let ep: any = null;
    if (data.endpointId) {
      const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
      const q = await (supabaseAdmin as any).from("api_endpoints").select("*").eq("id", data.endpointId).eq("integration_id", integ.id).maybeSingle();
      if (!q.data) throw new Error("Endpoint não encontrado");
      ep = q.data;
    }
    const r = await R.runEndpoint(integ, ep, data.vars as any, { actorId: context.userId, label: `Teste: ${ep?.name ?? "conexão"}`, useCache: !data.noCache });
    const player = r.ok && ep ? extractPlayer(r.body, ep.mapping ?? {}) : null;
    const items = r.ok && ep && !["movie_player", "episode_player"].includes(ep.kind) ? mapCatalog(r.body, ep.mapping ?? {}).slice(0, 10) : [];
    return { ok: r.ok, status: r.status, ms: r.ms, cached: r.cached, error: r.error, json: JSON.stringify(r.body ?? null, null, 2).slice(0, 100000), player, items };
  });

export const findPlayer = createServerFn({ method: "POST" }).middleware([requireSupabaseAuth])
  .inputValidator(z.object({ kind: z.enum(["movie", "episode"]), contentId: uuid, integrationId: uuid.optional() }))
  .handler(async ({ data, context }) => {
    await assertRole(context, "is_staff");
    const R = await import("./runner.server");
    const r = await R.resolvePlayer(data.kind, data.contentId, context.userId, data.integrationId);
    return { player: r.player, integrationId: r.integrationId, integrationName: r.integrationName, attempts: r.attempts };
  });

export const addPlayerSource = createServerFn({ method: "POST" }).middleware([requireSupabaseAuth])
  .inputValidator(z.object({ kind: z.enum(["movie", "episode"]), contentId: uuid, type: z.enum(["embed", "hls", "url"]), url: z.string().url().max(2048), label: z.string().trim().max(60).nullable(), integrationId: uuid.nullable() }))
  .handler(async ({ data, context }) => {
    await assertRole(context, "is_staff");
    const u = new URL(data.url);
    if (u.protocol !== "https:" || u.username || u.password) throw new Error("Use uma URL HTTPS");
    const R = await import("./runner.server");
    return R.attachSource(data.kind, data.contentId, { type: data.type, url: u.href }, data.label, data.integrationId);
  });

export const catalogSearch = createServerFn({ method: "POST" }).middleware([requireSupabaseAuth])
  .inputValidator(z.object({ integrationId: uuid, kind: z.enum(["movie", "series"]), query: z.string().trim().max(200), year: z.string().trim().max(4).optional(), externalId: z.string().trim().max(100).optional() }))
  .handler(async ({ data, context }) => {
    await assertRole(context, "is_staff");
    const R = await import("./runner.server");
    const integ = await R.loadIntegration(data.integrationId);
    const byId = !!data.externalId;
    const ep = R.pickEndpoint({ ...integ, api_endpoints: (await R.integrationsFor("catalog")).find((i: any) => i.id === integ.id)?.api_endpoints ?? [] }, byId ? (data.kind === "movie" ? "movie_by_id" : "series_by_id") : (data.kind === "movie" ? "search_movies" : "search_series"));
    if (!ep) throw new Error("Esta API não tem um endpoint ativo para essa busca");
    const vars: any = { query: data.query, title: data.query, year: data.year, external_id: data.externalId, tmdb_id: data.externalId, imdb_id: data.externalId, movie_id: data.externalId, series_id: data.externalId };
    const r = await R.runEndpoint(integ, ep, Object.fromEntries(Object.entries(vars).filter(([, v]) => v)) as any, { actorId: context.userId, label: `Busca: ${data.query || data.externalId}` });
    if (!r.ok) throw new Error(r.error ?? "Falha na busca");
    let items = mapCatalog(r.body, ep.mapping ?? {});
    if (data.year) items = items.filter(i => !i.release_year || String(i.release_year) === data.year);
    return items.map(i => ({ ...i, key: keyOf(integ.id, data.kind, i) }));
  });

function keyOf(integrationId: string, kind: "movie" | "series", i: CatalogItem) {
  return i.tmdb_id ? { source: "tmdb", id: `${kind === "movie" ? "movie" : "tv"}:${i.tmdb_id}` } : { source: `api:${integrationId}`, id: i.external_id };
}

const itemSchema = z.object({
  external_id: z.string().max(200), tmdb_id: z.string().max(50).nullable(), title: z.string().min(1).max(200), original_title: z.string().max(200).nullable(),
  description: z.string().max(5000).nullable(), poster_url: z.string().max(2048).nullable(), backdrop_url: z.string().max(2048).nullable(),
  release_year: z.number().int().nullable(), duration_minutes: z.number().nullable(), rating: z.number().nullable(), genres: z.array(z.string()).max(10),
  season_number: z.number().nullable(), episode_number: z.number().nullable(), thumbnail_url: z.string().nullable(),
});

export const importCatalog = createServerFn({ method: "POST" }).middleware([requireSupabaseAuth])
  .inputValidator(z.object({ integrationId: uuid, kind: z.enum(["movie", "series"]), items: z.array(itemSchema).min(1).max(20), autoPlayer: z.boolean() }))
  .handler(async ({ data, context }) => {
    await assertRole(context, "is_staff");
    const R = await import("./runner.server");
    const integ = await R.loadIntegration(data.integrationId);
    const full = (await R.integrationsFor("catalog")).find((i: any) => i.id === integ.id) ?? { ...integ, api_endpoints: [] };
    const sb = context.supabase; // writes run as the staff user, so RLS and audit apply
    const table = data.kind === "movie" ? "movies" : "series";
    const report = { created: 0, updated: 0, seasons: 0, episodes: 0, players: 0, playerErrors: [] as string[] };
    let budget = 60; // max player lookups per import
    const https = (u: string | null) => (u && /^https:\/\//.test(u) ? u : null);
    for (const it of data.items) {
      const k = keyOf(integ.id, data.kind, it as CatalogItem);
      const row: any = { title: it.title, original_title: it.original_title, description: it.description, poster_url: https(it.poster_url), backdrop_url: https(it.backdrop_url), release_year: it.release_year, external_source: k.source, external_id: k.id };
      if (data.kind === "movie" && it.duration_minutes) row.duration_minutes = Math.round(it.duration_minutes);
      const { data: ex } = await sb.from(table).select("id").eq("external_source", k.source).eq("external_id", k.id).maybeSingle();
      let id: string;
      if (ex) { const u = await sb.from(table).update(row).eq("id", ex.id); if (u.error) throw new Error(u.error.message); id = ex.id; report.updated++; }
      else {
        const slug = `${it.title.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "")}-${Math.random().toString(36).slice(2, 6)}`;
        const ins = await sb.from(table).insert({ ...row, slug, status: "published" }).select("id").single();
        if (ins.error) throw new Error(ins.error.message); id = ins.data.id; report.created++;
      }
      await linkCategories(sb, data.kind, id, it.genres ?? []);
      if (data.kind === "movie") {
        if (data.autoPlayer && budget-- > 0) await autoPlayer("movie", id);
        continue;
      }
      // Series: seasons → episodes → one player per episode.
      const seasonsEp = R.pickEndpoint(full, "seasons"), episodesEp = R.pickEndpoint(full, "episodes");
      if (!episodesEp) continue;
      const baseVars: any = { series_id: it.external_id, external_id: it.external_id, ...(it.tmdb_id ? { tmdb_id: it.tmdb_id, series_tmdb_id: it.tmdb_id } : {}), title: it.title };
      let seasonNums: number[] = [1];
      if (seasonsEp) {
        const sr = await R.runEndpoint(full, seasonsEp, baseVars, { actorId: context.userId, label: `Temporadas: ${it.title}` });
        if (sr.ok) seasonNums = [...new Set(mapCatalog(sr.body, seasonsEp.mapping ?? {}).map(s => s.season_number).filter((n): n is number => n != null && n > 0))].sort((a, b) => a - b).slice(0, 30);
      }
      for (const sn of seasonNums) {
        let { data: season } = await sb.from("seasons").select("id").eq("series_id", id).eq("season_number", sn).maybeSingle();
        if (!season) { const s = await sb.from("seasons").insert({ series_id: id, season_number: sn, title: `Temporada ${sn}` }).select("id").single(); if (s.error) throw new Error(s.error.message); season = s.data; report.seasons++; }
        const er = await R.runEndpoint(full, episodesEp, { ...baseVars, season: String(sn) }, { actorId: context.userId, label: `Episódios: ${it.title} T${sn}` });
        if (!er.ok) continue;
        const eps = mapCatalog(er.body, episodesEp.mapping ?? {}).filter(e => e.episode_number != null && (e.season_number == null || e.season_number === sn)).slice(0, 100);
        const { data: have } = await sb.from("episodes").select("id,episode_number").eq("season_id", season.id);
        const map = new Map<number, string>((have ?? []).map((e: any) => [e.episode_number, e.id]));
        for (const e of eps) {
          let eid = map.get(e.episode_number!);
          if (!eid) {
            const ins = await sb.from("episodes").insert({ season_id: season.id, episode_number: e.episode_number!, title: e.title || `Episódio ${e.episode_number}`, description: e.description, thumbnail_url: https(e.thumbnail_url), duration_minutes: e.duration_minutes ? Math.round(e.duration_minutes) : null, status: "published" }).select("id").single();
            if (ins.error) continue; eid = ins.data.id as string; report.episodes++;
          }
          if (data.autoPlayer && budget-- > 0) await autoPlayer("episode", eid);
        }
      }
    }
    if (data.autoPlayer && budget < 0) report.playerErrors.push("Limite de buscas automáticas por importação atingido (60). Rode a importação de novo para continuar.");
    return report;

    async function autoPlayer(kind: "movie" | "episode", id: string) {
      try {
        const r = await R.resolvePlayer(kind, id, context.userId);
        if (!r.player) { report.playerErrors.push(`${kind === "movie" ? "Filme" : "Episódio"}: player não encontrado`); return; }
        const a = await R.attachSource(kind, id, r.player, null, r.integrationId);
        if (!a.duplicate) report.players++;
      } catch (e) { report.playerErrors.push(e instanceof Error ? e.message : "Erro ao buscar player"); }
    }
  });
