/* eslint-disable @typescript-eslint/no-explicit-any */
import { createServerFn } from "@tanstack/react-start";
import { createClient } from "@supabase/supabase-js";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { homeSchema, emptyHome, orderedReferences, type HomeConfig, type HomeSection, type ResolvedHome, type ResolvedSection, type ContentRef } from "./model";
import { toMovie, toSeries, toChannel, type Item } from "@/lib/catalog";

const selectors = { movie: "id,slug,title,description,poster_url,backdrop_url,trailer_url,release_year,duration_minutes,age_rating,quality,featured,category_id,created_at,updated_at,movie_genres(genres(id,name,slug))", series: "id,slug,title,description,poster_url,backdrop_url,trailer_url,release_year,age_rating,featured,category_id,created_at,updated_at,series_genres(genres(id,name,slug))", channel: "id,slug,name,logo_url,description,featured,category_id,created_at,updated_at" };
const tables = { movie: "movies", series: "series", channel: "channels" };
const converters = { movie: toMovie, series: toSeries, channel: toChannel };
function publicClient() {
  const key = process.env['SUPABASE_PUBLISHABLE_KEY']; const url = process.env['SUPABASE_URL'];
  if (!key || !url) throw new Error("Configuração indisponível");
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false }, global: { fetch: (input, init) => { const headers = new Headers(init?.headers); if (headers.get("Authorization") === `Bearer ${key}`) headers.delete("Authorization"); headers.set("apikey", key); return fetch(input, { ...init, headers, signal: AbortSignal.timeout(15000) }); } } });
}
async function checked(q: any): Promise<any[]> { const { data, error } = await q; if (error) throw error; return data ?? []; }
async function refsItems(db: any, refs: ContentRef[]): Promise<Item[]> {
  const results = await Promise.all((Object.keys(tables) as (keyof typeof tables)[]).map(async kind => {
    const ids = refs.filter(r => r.kind === kind).map(r => r.id); if (!ids.length) return [];
    return (await checked(db.from(tables[kind]).select(selectors[kind]).eq("status", "published").in("id", ids))).map(converters[kind]);
  })); return orderedReferences(refs, results.flat(), refs.length);
}
async function resolveSection(db: any, section: HomeSection): Promise<ResolvedSection> {
  if (["hero", "continue", "watchlist"].includes(section.type)) return { section, items: [], categories: [] };
  if (section.type === "categories") {
    let q = db.from("categories").select("id,name,slug,image_url").eq("status", "published");
    if (section.mode === "manual") { const ids = section.items.filter(i => i.kind === "category").map(i => i.id); if (!ids.length) return { section, items: [], categories: [] }; q = q.in("id", ids); }
    const categories = await checked(q.order("sort_order").limit(section.mode === "manual" ? 100 : section.limit));
    return { section, items: [], categories: section.mode === "manual" ? orderedReferences(section.items, categories.map(c => ({ ...c, kind: "category" })), section.limit) : categories };
  }
  if (section.mode === "manual") return { section, items: (await refsItems(db, section.items)).slice(0, section.limit), categories: [] };
  const kinds: (keyof typeof tables)[] = section.type === "movies" ? ["movie"] : section.type === "series" ? ["series"] : section.type === "channels" ? ["channel"] : ["movie", "series"];
  const popular = section.type === "popular" || section.filters.sort === "popular";
  let rankings: { id: string; kind: string; views: number }[] = [];
  if (popular) {
    const [m, s, c] = await Promise.all([checked(db.rpc("popular_content", { _kind: "movie", _limit: 1000 })), checked(db.rpc("popular_series", { _limit: 1000 })), kinds.includes("channel") ? checked(db.rpc("popular_content", { _kind: "channel", _limit: 1000 })) : Promise.resolve([])]);
    rankings = [...m.map(r => ({ id: r.content_id, kind: "movie", views: Number(r.views) })), ...s.map(r => ({ id: r.series_id, kind: "series", views: Number(r.views) })), ...c.map(r => ({ id: r.content_id, kind: "channel", views: Number(r.views) }))].sort((a,b) => b.views - a.views);
  }
  const lists = await Promise.all(kinds.map(async kind => {
    let sel = selectors[kind]; const join = kind === "movie" ? "movie_genres" : "series_genres";
    if (section.filters.genre && kind !== "channel") sel = sel.replace(`${join}(`, `${join}!inner(`);
    let q = db.from(tables[kind]).select(sel).eq("status", "published");
    if (section.filters.category) q = q.eq("category_id", section.filters.category);
    if (section.filters.year && kind !== "channel") q = q.eq("release_year", section.filters.year);
    if (section.filters.genre && kind !== "channel") q = q.eq(`${join}.genre_id`, section.filters.genre);
    if (section.type === "featured" || section.filters.sort === "featured") q = q.eq("featured", true);
    if (popular) { const ids = rankings.filter(r => r.kind === kind).map(r => r.id); if (!ids.length) return []; q = q.in("id", ids); }
    const sort = section.type === "releases" ? "year" : section.filters.sort;
    const field = sort === "updated" ? "updated_at" : sort === "year" && kind !== "channel" ? "release_year" : "created_at";
    return (await checked(q.order(field, { ascending: false, nullsFirst: false }).order("id").limit(popular ? 1000 : section.limit))).map(converters[kind]);
  }));
  let items = lists.flat();
  if (popular) { const ranks = new Map(rankings.map((r,i) => [`${r.kind}:${r.id}`, i])); items.sort((a,b) => (ranks.get(`${a.kind}:${a.id}`) ?? 1000) - (ranks.get(`${b.kind}:${b.id}`) ?? 1000)); }
  else items.sort((a:any,b:any) => section.type === "releases" || section.filters.sort === "year" ? (b.release_year ?? 0)-(a.release_year ?? 0) || String(b.created_at).localeCompare(String(a.created_at)) : String(b[section.filters.sort === "updated" ? "updated_at" : "created_at"] ?? "").localeCompare(String(a[section.filters.sort === "updated" ? "updated_at" : "created_at"] ?? "")));
  return { section, items: items.slice(0, section.limit), categories: [] };
}
async function resolveHome(db: any, config: HomeConfig): Promise<ResolvedHome> {
  const [sections, settings] = await Promise.all([Promise.all(config.sections.filter(s => s.active).map(s => resolveSection(db,s))), db.from("site_settings").select("platform_name").eq("id",1).maybeSingle()]);
  const manual = config.banners.filter(b => b.active).slice(0,config.bannerLimit);
  let slides: ResolvedHome["slides"] = [];
  if (config.sections.some(s => s.active && s.type === "hero")) {
    if (config.bannerMode === "manual") {
      const items = await refsItems(db,manual.flatMap(b => b.content ? [b.content] : []));
      slides = manual.flatMap(b => { const item = items.find(i => i.id === b.content?.id && i.kind === b.content.kind) ?? null; if (b.content && !item) return []; return [{ key:b.id,item,title:b.title,description:b.description || b.subtitle || item?.description || null,backdrop:b.desktop || item?.backdrop_url || null,mobile:b.mobile,cta:b.cta,href:b.href,showWatch:b.watch,showInfo:b.info }]; });
    } else {
      const hero = config.sections.find(s => s.type === "hero" && s.active);
      if (hero) { const result = await resolveSection(db,{ ...hero,type:"mixed",limit:config.bannerLimit }); slides = result.items.map(item => ({ key:item.id,item,title:item.title,description:item.description,backdrop:item.backdrop_url || item.poster_url })); }
    }
  }
  return { config, sections, slides, platformName: settings.data?.platform_name ?? "Streaming" };
}
export const getPublishedHome = createServerFn({ method:"GET" }).handler(async () => {
  const db = publicClient(); const { data,error } = await db.from("home_layouts").select("config").eq("id","published").maybeSingle(); if (error) throw error;
  return resolveHome(db, data ? homeSchema.parse(data.config) : emptyHome);
});
async function assertStaff(context:any) { const { data,error } = await context.supabase.rpc("is_staff",{ _user_id:context.userId }); if (error || !data) throw new Error("Acesso negado"); }
export const getHomeDraft = createServerFn({ method:"GET" }).middleware([requireSupabaseAuth]).handler(async ({context}) => {
  await assertStaff(context); const {data,error} = await context.supabase.from("home_layouts").select("config,revision,updated_at").eq("id","draft").single(); if(error) throw error;
  return {config:homeSchema.parse(data.config),revision:data.revision,updatedAt:data.updated_at};
});
export const saveHomeDraft = createServerFn({ method:"POST" }).middleware([requireSupabaseAuth]).inputValidator(z.object({config:homeSchema,revision:z.number().int().positive()})).handler(async ({context,data}) => {
  await assertStaff(context); const r = await context.supabase.rpc("save_home_draft",{c:data.config,expected_revision:data.revision}); if(r.error) throw r.error; return r.data;
});
export const publishHomeDraft = createServerFn({ method:"POST" }).middleware([requireSupabaseAuth]).inputValidator(z.object({revision:z.number().int().positive()})).handler(async ({context,data}) => {
  await assertStaff(context); const r = await context.supabase.rpc("publish_home_draft",{expected_revision:data.revision}); if(r.error) throw r.error; return r.data;
});
export const previewHomeDraft = createServerFn({ method:"GET" }).middleware([requireSupabaseAuth]).handler(async ({context}) => {
  await assertStaff(context); const {data,error} = await context.supabase.from("home_layouts").select("config").eq("id","draft").single(); if(error) throw error;
  return resolveHome(publicClient(),homeSchema.parse(data.config));
});
export const searchHomeContent = createServerFn({ method:"GET" }).middleware([requireSupabaseAuth]).inputValidator(z.object({term:z.string().max(120),kind:z.enum(["movie","series","channel","category","mixed"])})).handler(async ({context,data}) => {
  await assertStaff(context); const kinds = data.kind === "mixed" ? ["movie","series","channel"] as const : [data.kind];
  const lists = await Promise.all(kinds.map(async kind => {
    const table = kind === "category" ? "categories" : tables[kind]; const rows = await checked(context.supabase.from(table as any).select("id,"+(kind === "category" || kind === "channel" ? "name" : "title")+",status").ilike(kind === "category" || kind === "channel" ? "name" : "title",`%${data.term.replace(/[%_]/g,"")}%`).order(kind === "category" || kind === "channel" ? "name" : "title").limit(30));
    return rows.map(r => ({id:r.id as string,kind,title:(r.title || r.name) as string,status:r.status as string}));
  })); return lists.flat();
});
export const getHomeReferences = createServerFn({ method:"GET" }).middleware([requireSupabaseAuth]).inputValidator(z.array(z.object({kind:z.enum(["movie","series","channel","category"]),id:z.string().uuid()})).max(6000)).handler(async ({context,data}) => {
  await assertStaff(context); const lists = await Promise.all((["movie","series","channel","category"] as const).map(async kind => { const ids = data.filter(r=>r.kind===kind).map(r=>r.id); if(!ids.length) return []; const rows = await checked(context.supabase.from((kind === "category" ? "categories" : tables[kind]) as any).select("id,"+(kind === "category" || kind === "channel" ? "name" : "title")+",status").in("id",ids)); return rows.map(r=>({id:r.id as string,kind,title:(r.title||r.name) as string,status:r.status as string})); })); return lists.flat();
});