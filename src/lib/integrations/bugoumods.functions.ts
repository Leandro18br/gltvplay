/* eslint-disable @typescript-eslint/no-explicit-any */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { assertStaff, uniqueSlug } from "@/lib/tmdb/tmdb.functions";
import { parseBugouName, parseBugouDetails, type BugouSeries, type BugouDetails } from "./bugoumods";

/**
 * BugouMods VIP series list — METADATA ONLY (id, name/year, cover, category).
 * The vtoken stays server-side (BUGOUMODS_VTOKEN; a full VIP link is accepted too)
 * and the provider "link" (which embeds the token) is never returned or stored.
 */
type Ctx = { supabase: any; userId: string };
const SOURCE = "bugoumods";

function token() {
  const raw = (process.env["BUGOUMODS_VTOKEN"] ?? "").trim().replace(/^"|"$/g, "");
  const m = raw.match(/vtoken=([^&"\s]+)/);
  const t = m?.[1] ? decodeURIComponent(m[1]) : raw;
  if (!t) throw new Error("Token do BugouMods não configurado.");
  return t;
}

let cache: { at: number; items: BugouSeries[] } | null = null;

async function loadAll(): Promise<BugouSeries[]> {
  if (cache && Date.now() - cache.at < 10 * 60_000) return cache.items;
  const url = new URL("https://cinema.bugoumods.com/");
  url.search = new URLSearchParams({ api: "1", t: "series", c: "all", vtoken: token() }).toString();
  let res: Response;
  try { res = await fetch(url, { headers: { "User-Agent": "Mozilla/5.0", Accept: "application/json" } }); }
  catch { throw new Error("Não foi possível conectar ao BugouMods."); }
  if (!res.ok) throw new Error(`BugouMods respondeu HTTP ${res.status}.`);
  let json: any;
  try { json = await res.json(); } catch { throw new Error("BugouMods não respondeu em JSON."); }
  if (!json || typeof json !== "object") throw new Error("Resposta inesperada do BugouMods.");
  if (json.Aviso) throw new Error(`BugouMods: ${String(json.Aviso?.[0]?.nome ?? "aviso do provedor").replace(/vtoken=[^&\s"]+/g, "vtoken=***")}`);
  const seen = new Set<number>(); const items: BugouSeries[] = [];
  for (const [cat, list] of Object.entries(json)) {
    if (!Array.isArray(list)) continue;
    for (const it of list as any[]) {
      const id = Number(it?.id);
      if (!Number.isFinite(id) || id <= 0 || seen.has(id)) continue;
      seen.add(id);
      const { title, year } = parseBugouName(String(it.nome ?? ""));
      if (!title) continue;
      const capa = typeof it.capa === "string" && /^https?:\/\//.test(it.capa) ? it.capa.replace(/^http:\/\/image\.tmdb\.org/, "https://image.tmdb.org") : null;
      items.push({ id: String(id), title, year, poster_url: capa, category: String(it.categoria ?? cat) });
    }
  }
  cache = { at: Date.now(), items };
  return items;
}

const norm = (s: string) => s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim();

export const bugouSearchSeries = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ query: z.string().trim().max(200).default(""), category: z.string().max(200).default("") }).parse(d))
  .handler(async ({ data, context }) => {
    const ctx = context as Ctx;
    await assertStaff(ctx);
    const all = await loadAll();
    const q = norm(data.query);
    const categories = [...new Set(all.map(i => i.category))].sort();
    const results = all.filter(i => (!q || norm(i.title).includes(q)) && (!data.category || i.category === data.category))
      .sort((a, b) => { const x = norm(a.title), y = norm(b.title); const r = (s: string) => (s === q ? 0 : s.startsWith(q) ? 1 : 2); return r(x) - r(y) || x.localeCompare(y); })
      .slice(0, 60);
    const existing: Record<string, string> = {};
    if (results.length) {
      const { data: byExt } = await ctx.supabase.from("series").select("id, external_id").eq("external_source", SOURCE).in("external_id", results.map(r => r.id));
      (byExt ?? []).forEach((r: any) => { existing[r.external_id] = r.id; });
      for (const r of results) {
        if (existing[r.id]) continue;
        let qb = ctx.supabase.from("series").select("id").ilike("title", r.title.replace(/[%_]/g, "\\$&")).limit(1);
        if (r.year) qb = qb.eq("release_year", r.year);
        const { data: m } = await qb;
        if (m?.[0]) existing[r.id] = m[0].id;
      }
    }
    return { total: all.length, categories, results, existing };
  });

export const bugouImportSeries = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ ids: z.array(z.string().regex(/^\d+$/)).min(1).max(50) }).parse(d))
  .handler(async ({ data, context }) => {
    const ctx = context as Ctx;
    await assertStaff(ctx);
    const all = await loadAll();
    let created = 0, skipped = 0;
    for (const id of data.ids) {
      const it = all.find(i => i.id === id);
      if (!it) { skipped++; continue; }
      const { data: ext } = await ctx.supabase.from("series").select("id").eq("external_source", SOURCE).eq("external_id", id).maybeSingle();
      if (ext) { skipped++; continue; }
      let qb = ctx.supabase.from("series").select("id").ilike("title", it.title.replace(/[%_]/g, "\\$&")).limit(1);
      if (it.year) qb = qb.eq("release_year", it.year);
      const { data: same } = await qb;
      if (same?.[0]) { skipped++; continue; }
      const slug = await uniqueSlug(ctx, "series", it.title, it.year);
      const r = await ctx.supabase.from("series").insert({
        title: it.title, release_year: it.year, poster_url: it.poster_url, slug, status: "published",
        external_source: SOURCE, external_id: id,
      });
      if (r.error) throw new Error(r.error.message);
      created++;
    }
    return { created, skipped };
  });

async function loadDetails(id: string): Promise<BugouDetails> {
  const url = new URL("https://cinema.bugoumods.com/index.php");
  url.search = new URLSearchParams({ ajax: "1", type: "series_info", series_id: id, vtoken: token() }).toString();
  let res: Response;
  try { res = await fetch(url, { headers: { "User-Agent": "Mozilla/5.0", Accept: "application/json" } }); }
  catch { throw new Error("Não foi possível conectar ao BugouMods."); }
  if (!res.ok) throw new Error(`BugouMods respondeu HTTP ${res.status} ao buscar episódios.`);
  let json: any;
  try { json = await res.json(); } catch { throw new Error("BugouMods não respondeu em JSON ao buscar episódios."); }
  return parseBugouDetails(id, json);
}

/** Seasons/episodes preview + what already exists locally for this series. */
export const bugouSeriesDetails = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ id: z.string().regex(/^\d+$/) }).parse(d))
  .handler(async ({ data, context }) => {
    const ctx = context as Ctx;
    await assertStaff(ctx);
    const details = await loadDetails(data.id);
    const local = await findLocalSeries(ctx, data.id, details.title, details.year);
    const existingEpisodes: string[] = [];
    if (local) {
      const { data: rows } = await ctx.supabase.from("episodes").select("episode_number, seasons!inner(season_number, series_id)").eq("seasons.series_id", local);
      (rows ?? []).forEach((r: any) => existingEpisodes.push(`${r.seasons.season_number}x${r.episode_number}`));
    }
    return { details, localSeriesId: local, existingEpisodes };
  });

async function findLocalSeries(ctx: Ctx, id: string, title: string, year: number | null): Promise<string | null> {
  const { data: ext } = await ctx.supabase.from("series").select("id").eq("external_source", SOURCE).eq("external_id", id).maybeSingle();
  if (ext) return ext.id;
  if (!title) return null;
  let qb = ctx.supabase.from("series").select("id").ilike("title", title.replace(/[%_]/g, "\\$&")).limit(1);
  if (year) qb = qb.eq("release_year", year);
  const { data: same } = await qb;
  return same?.[0]?.id ?? null;
}

/**
 * Imports selected seasons: reuses the existing series/seasons/episodes (never overwrites them)
 * and adds one BugouMods embed source per episode (external_ref bugoumods:<episodeId>), skipped if present.
 */
export const bugouImportEpisodes = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ id: z.string().regex(/^\d+$/), seasons: z.array(z.number().int().min(0).max(500)).min(1).max(100) }).parse(d))
  .handler(async ({ data, context }) => {
    const ctx = context as Ctx; const db = ctx.supabase;
    await assertStaff(ctx);
    const d = await loadDetails(data.id);
    const want = d.seasons.filter(s => data.seasons.includes(s.season));
    if (!want.length) throw new Error("A API não retornou episódios para as temporadas escolhidas.");
    let seriesId = await findLocalSeries(ctx, data.id, d.title, d.year); let seriesCreated = false;
    if (!seriesId) {
      const listed = (await loadAll()).find(i => i.id === data.id);
      const title = d.title || listed?.title; if (!title) throw new Error("Série sem nome na resposta da API.");
      const year = d.year ?? listed?.year ?? null;
      const slug = await uniqueSlug(ctx, "series", title, year);
      const r = await db.from("series").insert({ title, release_year: year, poster_url: d.cover ?? listed?.poster_url ?? null, description: d.plot, slug, status: "published", external_source: SOURCE, external_id: data.id }).select("id").single();
      if (r.error) throw new Error(r.error.message);
      seriesId = r.data.id; seriesCreated = true;
    }
    const out = { seriesId, seriesCreated, seasonsCreated: 0, episodesCreated: 0, episodesExisting: 0, sourcesCreated: 0, sourcesExisting: 0 };
    for (const s of want) {
      let { data: season } = await db.from("seasons").select("id").eq("series_id", seriesId).eq("season_number", s.season).maybeSingle();
      if (!season) {
        const r = await db.from("seasons").insert({ series_id: seriesId, season_number: s.season, title: `Temporada ${s.season}`, status: "published", sort_order: s.season }).select("id").single();
        if (r.error) throw new Error(r.error.message);
        season = r.data; out.seasonsCreated++;
      }
      const { data: have } = await db.from("episodes").select("id, episode_number").eq("season_id", season!.id);
      const byNum = new Map<number, string>((have ?? []).map((e: any) => [e.episode_number, e.id]));
      for (const e of s.episodes) {
        let epId = byNum.get(e.episode);
        if (epId) out.episodesExisting++;
        else {
          const r = await db.from("episodes").insert({ season_id: season!.id, episode_number: e.episode, title: e.title, thumbnail_url: e.image, duration_minutes: e.duration_minutes, status: "published" }).select("id").single();
          if (r.error) throw new Error(r.error.message);
          epId = r.data.id as string; out.episodesCreated++;
        }
        const ref = `bugoumods:${e.id}`;
        const { data: srcs } = await db.from("playback_sources").select("id, external_ref, url").eq("content_kind", "episode").eq("content_id", epId);
        if ((srcs ?? []).some((x: any) => x.external_ref === ref || x.url === e.embed_url)) { out.sourcesExisting++; continue; }
        const n = srcs?.length ?? 0;
        const r = await db.from("playback_sources").insert({ content_kind: "episode", content_id: epId, url: e.embed_url, source_type: "embed", provider: "BugouMods", label: "BugouMods", external_ref: ref, is_active: true, is_primary: n === 0, sort_order: n, drm: {} });
        if (r.error) throw new Error(r.error.message);
        out.sourcesCreated++;
      }
    }
    return out;
  });
