/* eslint-disable @typescript-eslint/no-explicit-any */
import { importMovieIds } from "./bugoumods.functions";
import { importStreamBetterPage } from "./streambetter.functions";
import { RateLimitedError, backoffMs, nextSafeRpm, raiseSafeRpm, RAISE_EVERY, PROVIDER_429_BASE_MS, PROVIDER_429_CAP_MS } from "./ratelimit";
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

/**
 * Background runners for movie queues (BugouMods VIP ids) and StreamBetter page cursors.
 * Both are lease-guarded, idempotent (importers dedupe by external ids) and persist progress after every item/page.
 */
type Ctx = { supabase: any; userId: string };
const leaseMs = 70_000;

async function claim(db: any, jobId: string) {
  const now = new Date();
  const { data } = await db.from("bugou_import_jobs").update({ lease_until: new Date(now.getTime() + leaseMs).toISOString() })
    .eq("id", jobId).eq("status", "running").or(`lease_until.is.null,lease_until.lt.${now.toISOString()}`)
    .or(`throttle_until.is.null,throttle_until.lt.${now.toISOString()}`).select("id, stats, done, failed");
  return data?.[0] ?? null;
}

/**
 * Movie queue: exactly one movie at a time; the next starts as soon as the previous is saved.
 * Provider pacing only after a real 429 (learned safe rpm, +1/min after 10 clean calls); a 429 wait that
 * fits in this run is waited out here, otherwise it is persisted (throttle_until) and the worker resumes later.
 */
export async function runMovieJob(ctx: Ctx, jobId: string, budgetMs: number) {
  const db = ctx.supabase; const t0 = Date.now();
  const job = await claim(db, jobId); if (!job) return { busy: true };
  const stats: Record<string, any> = { created: 0, updated: 0, failed: 0, playersAdded: 0, genresAdded: 0, http429: 0, requests: 0, providerCalls: 0, alreadyComplete: 0, items_ms: 0, items_timed: 0, ...(job.stats ?? {}) };
  let done = job.done, failed = job.failed; let lastCall = 0; let okStreak = 0; const calls: number[] = [];
  const persist = (extra: Record<string, unknown> = {}) => db.from("bugou_import_jobs").update({ done, failed, stats, updated_at: new Date().toISOString(), ...extra }).eq("id", jobId);
  await db.from("bugou_import_items").update({ state: "pending" }).eq("job_id", jobId).eq("state", "processing");
  try {
    while (Date.now() - t0 < budgetMs - 6000) {
      const { data: cur } = await db.from("bugou_import_jobs").select("status").eq("id", jobId).single();
      if (cur?.status !== "running") break; // paused/cancelled from the panel
      const nowIso = new Date().toISOString();
      const { data: items } = await db.from("bugou_import_items").select("ext_id, title, attempts").eq("job_id", jobId).eq("state", "pending")
        .or(`next_attempt_at.is.null,next_attempt_at.lte.${nowIso}`).order("attempts").order("ext_id").limit(1);
      const it = items?.[0];
      if (!it) {
        const { count } = await db.from("bugou_import_items").select("ext_id", { count: "exact", head: true }).eq("job_id", jobId).eq("state", "pending");
        if (!count) await db.from("bugou_import_jobs").update({ status: "done" }).eq("id", jobId);
        break;
      }
      // Same movie in another queue right now: defer it there instead of processing twice.
      const { count: elsewhere } = await db.from("bugou_import_items").select("ext_id", { count: "exact", head: true }).eq("ext_id", it.ext_id).eq("state", "processing").neq("job_id", jobId);
      if (elsewhere) { await db.from("bugou_import_items").update({ next_attempt_at: new Date(Date.now() + 30_000).toISOString() }).eq("job_id", jobId).eq("ext_id", it.ext_id); continue; }
      // Learned provider pace (only exists after a real 429).
      if (stats["safe_rpm"] && lastCall) { const w = lastCall + Math.ceil(60_000 / stats["safe_rpm"]) - Date.now(); if (w > 0) { if (Date.now() - t0 + w > budgetMs - 6000) break; await sleep(w); } }
      await db.from("bugou_import_items").update({ state: "processing", updated_at: new Date().toISOString() }).eq("job_id", jobId).eq("ext_id", it.ext_id);
      const ti = Date.now();
      try {
        const r: any = await importMovieIds(ctx, [it.ext_id]);
        for (const k of ["created", "updated", "playersAdded", "genresAdded", "providerCalls", "alreadyComplete"]) stats[k] = (stats[k] ?? 0) + (r[k] ?? 0);
        stats["requests"] = (stats["requests"] ?? 0) + (r.providerCalls ?? 0);
        if (r.providerCalls) { lastCall = Date.now(); calls.push(lastCall); if (stats["safe_rpm"] && ++okStreak >= RAISE_EVERY) { okStreak = 0; stats["safe_rpm"] = raiseSafeRpm(stats["safe_rpm"]); } }
        const bad = r.failed > 0 || r.skipped > 0;
        if (bad) { failed++; stats["failed"]++; } else done++;
        stats["last_ms"] = Date.now() - ti; if (!bad) { stats["items_ms"] += stats["last_ms"]; stats["items_timed"]++; }
        await db.from("bugou_import_items").update({ state: bad ? "failed" : "done", step: "done", result: r, attempts: it.attempts + 1, error: bad ? (r.skipped ? "Fora da lista atual da API" : "Falha ao importar (ver logs)") : null, next_attempt_at: null, updated_at: new Date().toISOString() }).eq("job_id", jobId).eq("ext_id", it.ext_id);
      } catch (e) {
        if (e instanceof RateLimitedError) {
          stats["http429"]++; stats["requests"]++;
          stats["safe_rpm"] = nextSafeRpm(stats["safe_rpm"] ?? null, calls.filter(t => t > Date.now() - 60_000).length + 1); okStreak = 0;
          const wait = e.retryAfterMs ?? backoffMs(Math.min(6, stats["http429"]), PROVIDER_429_BASE_MS, PROVIDER_429_CAP_MS);
          const until = new Date(Date.now() + wait).toISOString();
          await db.from("bugou_import_items").update({ state: "pending", next_attempt_at: until, rate_limited: 1, error: `${e.message} Retomada automática programada.` }).eq("job_id", jobId).eq("ext_id", it.ext_id);
          if (Date.now() - t0 + wait < budgetMs - 6000) { await persist(); await sleep(wait); lastCall = Date.now(); continue; }
          await persist({ throttle_until: until });
          return { busy: false, throttled: true };
        }
        failed++; stats["failed"]++;
        await db.from("bugou_import_items").update({ state: "failed", error: String((e as Error).message).slice(0, 300), attempts: it.attempts + 1 }).eq("job_id", jobId).eq("ext_id", it.ext_id);
      }
      await persist();
    }
  } finally {
    await db.from("bugou_import_items").update({ state: "pending" }).eq("job_id", jobId).eq("state", "processing");
    await persist({ lease_until: null });
  }
  return { busy: false };
}

export async function runStreamBetterJob(ctx: Ctx, jobId: string, kind: "movie" | "series", budgetMs: number) {
  const db = ctx.supabase; const t0 = Date.now();
  const job = await claim(db, jobId); if (!job) return { busy: true };
  const s: any = { page: 1, totalPages: null, totalItems: 0, processed: 0, imported: 0, updated: 0, skipped: 0, errors: 0, http429: 0, pagesDone: 0, ...(job.stats ?? {}) };
  let status = "running"; let throttle: string | null = null;
  try {
    while (Date.now() - t0 < budgetMs - 8000) {
      const r = await importStreamBetterPage({ kind, page: s.page, limit: 10, mode: "sync" });
      if (r.retry) { s.http429++; throttle = new Date(Date.now() + r.retryMs).toISOString(); break; }
      for (const k of ["processed", "imported", "updated", "skipped", "errors"]) s[k] += (r as any)[k];
      s.totalPages = r.totalPages; s.totalItems = r.totalItems; s.pagesDone++;
      if (r.done) { status = "done"; break; }
      s.page = r.nextPage;
    }
  } catch (e) {
    s.lastError = String((e as Error).message).slice(0, 300);
    throttle = new Date(Date.now() + 60_000).toISOString(); // transient failure: retry the same page next minute
  } finally {
    await db.from("bugou_import_jobs").update({ stats: s, status, total: s.totalPages ?? 0, done: s.pagesDone, failed: s.errors, throttle_until: throttle, lease_until: null, updated_at: new Date().toISOString() }).eq("id", jobId);
  }
  return { busy: false };
}

/** Catalog recovery: items are "movie:<uuid>" / "series:<uuid>"; each is enriched fill-only from TMDB, 4 at a time. */
export async function runMetadataRepairJob(ctx: Ctx, jobId: string, budgetMs: number) {
  const { enrichContent } = await import("@/lib/tmdb/tmdb.functions");
  const db = ctx.supabase; const t0 = Date.now();
  const job = await claim(db, jobId); if (!job) return { busy: true };
  const s: any = { complete: 0, filled: 0, incomplete: 0, unmatched: 0, error: 0, ...(job.stats ?? {}) };
  let done = job.done, failed = job.failed;
  try {
    while (Date.now() - t0 < budgetMs - 8000) {
      const { data: items } = await db.from("bugou_import_items").select("ext_id, attempts").eq("job_id", jobId).eq("state", "pending").limit(4);
      if (!items?.length) { await db.from("bugou_import_jobs").update({ status: "done" }).eq("id", jobId); break; }
      await Promise.all(items.map(async (it: any) => {
        const [kind, id] = String(it.ext_id).split(":");
        const r = await enrichContent(ctx, kind as "movie" | "series", id!);
        s[r.status]++;
        const ok = r.status === "filled" || r.status === "complete" || r.status === "incomplete";
        if (ok) done++; else failed++;
        await db.from("bugou_import_items").update({ state: ok ? "done" : "failed", result: r, error: ok ? null : (r.error ?? "Sem correspondência confiável no TMDB"), attempts: it.attempts + 1, updated_at: new Date().toISOString() }).eq("job_id", jobId).eq("ext_id", it.ext_id);
      }));
    }
  } finally {
    await db.from("bugou_import_jobs").update({ done, failed, stats: s, lease_until: null, updated_at: new Date().toISOString() }).eq("id", jobId);
  }
  return { busy: false };
}
