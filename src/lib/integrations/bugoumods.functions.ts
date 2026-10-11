/* eslint-disable @typescript-eslint/no-explicit-any */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { assertStaff, uniqueSlug } from "@/lib/tmdb/tmdb.functions";
import { parseBugouName, type BugouSeries } from "./bugoumods";

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
