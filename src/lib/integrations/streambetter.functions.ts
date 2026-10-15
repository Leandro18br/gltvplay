/* eslint-disable @typescript-eslint/no-explicit-any */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

type Ctx = { supabase: any; userId: string };
const BASE = "https://streambetter.shop";
const PAGE_SIZE = 10;

async function assertStaff(ctx: Ctx) {
  const { data, error } = await ctx.supabase.rpc("is_staff", { _user_id: ctx.userId });
  if (error || !data) throw new Error("Acesso negado");
}

async function getPage(type: "movie" | "tv", page: number) {
  const url = new URL("/api/titles", BASE);
  url.searchParams.set("type", type);
  url.searchParams.set("page", String(page));
  url.searchParams.set("limit", String(PAGE_SIZE));
  const response = await fetch(url, { headers: { accept: "application/json" }, signal: AbortSignal.timeout(12000) });
  if (response.status === 429) {
    const retry = Number(response.headers.get("Retry-After") ?? "60");
    return { retryMs: Math.min(300000, Math.max(1000, retry * 1000)), body: null, status: 429 };
  }
  if (!response.ok) throw new Error(response.status === 401 || response.status === 403 ? "O StreamBetter recusou a requisição. Confira o plano e as permissões." : `StreamBetter respondeu HTTP ${response.status}.`);
  const body = await response.json() as any;
  if (body?.success !== true || !Array.isArray(body?.titles) || !body?.pagination || !Number.isFinite(Number(body.pagination.totalPages))) {
    throw new Error("Resposta do StreamBetter fora do formato documentado; nenhuma alteração foi feita.");
  }
  return { retryMs: 0, body, status: response.status };
}

function cleanText(v: unknown, max = 5000): string | null {
  return typeof v === "string" && v.trim() ? v.trim().slice(0, max) : null;
}
function posterUrl(v: unknown): string | null {
  if (typeof v !== "string" || !v.trim()) return null;
  const value = v.trim();
  if (/^https:\/\//i.test(value)) return value;
  if (/^\/[A-Za-z0-9_./-]+$/.test(value)) return `https://image.tmdb.org/t/p/w500${value}`;
  return null;
}
function yearFrom(v: unknown): number | null {
  if (typeof v === "string" && /^\d{4}/.test(v)) return Number(v.slice(0, 4));
  return null;
}
function makeSlug(title: string, tmdbId: string) {
  const base = title.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "").slice(0, 150) || "titulo";
  return `${base}-sb-${tmdbId.replace(/[^0-9a-z_-]/gi, "").slice(0, 30)}`;
}

export const streamBetterTest = createServerFn({ method: "POST" }).middleware([requireSupabaseAuth])
  .inputValidator(z.object({}))
  .handler(async ({ context }) => {
    await assertStaff(context);
    const [movies, series] = await Promise.all([getPage("movie", 1), getPage("tv", 1)]);
    if (!movies.body || !series.body) return { ok: false, retryMs: Math.max(movies.retryMs, series.retryMs), message: "Limite temporário do provedor; tente novamente após o tempo indicado." };
    return {
      ok: true,
      movieCount: Number(movies.body.pagination.totalItems ?? 0),
      moviePages: Number(movies.body.pagination.totalPages ?? 0),
      seriesCount: Number(series.body.pagination.totalItems ?? 0),
      seriesPages: Number(series.body.pagination.totalPages ?? 0),
      sampleMovie: cleanText(movies.body.titles[0]?.title, 200),
      sampleSeries: cleanText(series.body.titles[0]?.title, 200),
    };
  });

export const streamBetterImportStep = createServerFn({ method: "POST" }).middleware([requireSupabaseAuth])
  .inputValidator(z.object({ kind: z.enum(["movie", "series"]), page: z.number().int().min(1).max(100000), limit: z.number().int().min(1).max(10).default(10), mode: z.enum(["sync", "new_only"]).default("sync") }))
  .handler(async ({ data, context }) => {
    await assertStaff(context);
    const type = data.kind === "movie" ? "movie" : "tv";
    const pageResult = await getPage(type, data.page);
    if (!pageResult.body) return { retryMs: pageResult.retryMs, done: false, retry: true, page: data.page, totalPages: null, processed: 0, imported: 0, updated: 0, skipped: 0, errors: 0 };
    const body = pageResult.body;
    const totalPages = Number(body.pagination.totalPages);
    const pageItems = (body.titles as any[]).slice(0, data.limit);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const db = supabaseAdmin as any;
    const table = data.kind === "movie" ? "movies" : "series";
    const { data: settings } = await db.from("site_settings").select("streambetter_public_key").eq("id", 1).maybeSingle();
    const publicKey = typeof settings?.streambetter_public_key === "string" && /^sb_pk_[A-Za-z0-9_-]{8,200}$/.test(settings.streambetter_public_key.trim()) ? settings.streambetter_public_key.trim() : null;
    let processed = 0, imported = 0, updated = 0, skipped = 0, errors = 0;
    for (const item of pageItems) {
      processed++;
      const tmdbId = cleanText(String(item?.tmdb_id ?? ""), 50);
      const providerId = cleanText(String(item?.id ?? ""), 100);
      const title = cleanText(item?.title, 200);
      if (!tmdbId || !providerId || !title || !/^\d+$/.test(tmdbId)) { skipped++; continue; }
      const poster = posterUrl(item?.poster_path);
      const description = cleanText(item?.overview);
      const year = yearFrom(item?.release_date ?? item?.first_air_date);
      // Only write provider fields when present; never erase an existing non-empty value.
      let { data: existing, error: findError } = await db.from(table).select("*").eq("streambetter_tmdb_id", tmdbId).maybeSingle();
      if (findError) { errors++; continue; }
      let rowId: string | null = existing?.id ?? null;
      if (!rowId) {
        // Reuse a row already imported by the TMDB integration when its stable key matches.
        const tmdbExternal = `${data.kind === "movie" ? "movie" : "tv"}:${tmdbId}`;
        const match = await db.from(table).select("*").eq("external_source", "tmdb").eq("external_id", tmdbExternal).maybeSingle();
        if (match.error) { errors++; continue; }
        if (match.data) { existing = match.data; rowId = match.data.id; }
      }
      if (rowId && data.mode === "new_only") { skipped++; continue; }
      const nonEmptyPatch: Record<string, unknown> = { streambetter_id: providerId, streambetter_tmdb_id: tmdbId };
      // Preserve an existing canonical ID; fill it only when missing.
      if (!existing?.tmdb_id) nonEmptyPatch.tmdb_id = Number(tmdbId);
      else if (String(existing.tmdb_id) !== tmdbId) { errors++; continue; }
      if (title) nonEmptyPatch.title = title;
      if (poster) nonEmptyPatch.poster_url = poster;
      if (description) nonEmptyPatch.description = description;
      if (year) nonEmptyPatch.release_year = year;
      if (!rowId) {
        const insertRow = {
          ...nonEmptyPatch,
          external_source: "streambetter",
          external_id: providerId,
          slug: makeSlug(title, tmdbId),
          status: "published",
        };
        const ins = await db.from(table).insert(insertRow).select("id").single();
        if (ins.error) { errors++; continue; }
        rowId = ins.data.id;
        imported++;
      } else {
        const upd = await db.from(table).update(nonEmptyPatch).eq("id", rowId);
        if (upd.error) { errors++; continue; }
        updated++;
      }
      if (data.kind === "movie") {
        const embedUrl = `${BASE}/filme/${encodeURIComponent(tmdbId)}${publicKey ? `?key=${encodeURIComponent(publicKey)}` : ""}`;
        const { data: currentSources, error: sourceError } = await db.from("playback_sources").select("id,url").eq("content_kind", "movie").eq("content_id", rowId).eq("external_ref", `streambetter:${tmdbId}`).limit(1);
        if (sourceError) { errors++; continue; }
        if ((currentSources ?? []).length) {
          if (currentSources[0].url !== embedUrl) {
            const sourceUpdate = await db.from("playback_sources").update({ url: embedUrl, is_active: true }).eq("id", currentSources[0].id);
            if (sourceUpdate.error) errors++;
          }
        } else {
          const { count } = await db.from("playback_sources").select("id", { count: "exact", head: true }).eq("content_kind", "movie").eq("content_id", rowId).eq("is_active", true);
          const source = await db.from("playback_sources").insert({
            content_kind: "movie", content_id: rowId, url: embedUrl, source_type: "embed",
            provider: "StreamBetter", label: "StreamBetter", external_ref: `streambetter:${tmdbId}`,
            is_active: true, is_primary: (count ?? 0) === 0, sort_order: 50, drm: {},
          });
          if (source.error) errors++;
        }
      }
    }
    return { retryMs: 0, retry: false, done: data.page >= totalPages, page: data.page, nextPage: data.page + 1, totalPages, processed, imported, updated, skipped, errors, totalItems: Number(body.pagination.totalItems ?? 0) };
  });
