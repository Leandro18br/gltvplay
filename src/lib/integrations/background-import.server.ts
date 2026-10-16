/* eslint-disable @typescript-eslint/no-explicit-any */
import { importMovieIds } from "./bugoumods.functions";
import { importStreamBetterPage } from "./streambetter.functions";
import { RateLimitedError, backoffMs } from "./ratelimit";

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

export async function runMovieJob(ctx: Ctx, jobId: string, budgetMs: number) {
  const db = ctx.supabase; const t0 = Date.now();
  const job = await claim(db, jobId); if (!job) return { busy: true };
  const stats: Record<string, number> = { created: 0, updated: 0, failed: 0, playersAdded: 0, genresAdded: 0, http429: 0, requests: 0, ...(job.stats ?? {}) };
  let done = job.done, failed = job.failed;
  try {
    while (Date.now() - t0 < budgetMs - 6000) {
      const nowIso = new Date().toISOString();
      const { data: items } = await db.from("bugou_import_items").select("ext_id, attempts").eq("job_id", jobId).eq("state", "pending")
        .or(`next_attempt_at.is.null,next_attempt_at.lte.${nowIso}`).limit(5);
      if (!items?.length) {
        const { count } = await db.from("bugou_import_items").select("ext_id", { count: "exact", head: true }).eq("job_id", jobId).eq("state", "pending");
        if (!count) await db.from("bugou_import_jobs").update({ status: "done" }).eq("id", jobId);
        break;
      }
      for (const it of items) {
        if (Date.now() - t0 > budgetMs - 6000) break;
        stats["requests"]!++;
        try {
          const r = await importMovieIds(ctx, [it.ext_id]);
          for (const k of ["created", "updated", "playersAdded", "genresAdded"]) stats[k] = (stats[k] ?? 0) + ((r as any)[k] ?? 0);
          const bad = r.failed > 0 || r.skipped > 0;
          if (bad) { failed++; stats["failed"]!++; } else done++;
          await db.from("bugou_import_items").update({ state: bad ? "failed" : "done", result: r, attempts: it.attempts + 1, error: bad ? (r.skipped ? "Fora da lista atual da API" : "Falha ao importar (ver logs)") : null, updated_at: new Date().toISOString() }).eq("job_id", jobId).eq("ext_id", it.ext_id);
        } catch (e) {
          if (e instanceof RateLimitedError) {
            stats["http429"]!++;
            const wait = e.retryAfterMs ?? backoffMs(Math.min(6, stats["http429"]!));
            const until = new Date(Date.now() + wait).toISOString();
            await db.from("bugou_import_items").update({ next_attempt_at: until, rate_limited: 1 }).eq("job_id", jobId).eq("ext_id", it.ext_id);
            await db.from("bugou_import_jobs").update({ throttle_until: until }).eq("id", jobId);
            return { busy: false, throttled: true };
          }
          failed++; stats["failed"]!++;
          await db.from("bugou_import_items").update({ state: "failed", error: String((e as Error).message).slice(0, 300), attempts: it.attempts + 1 }).eq("job_id", jobId).eq("ext_id", it.ext_id);
        }
      }
    }
  } finally {
    await db.from("bugou_import_jobs").update({ done, failed, stats, lease_until: null, updated_at: new Date().toISOString() }).eq("id", jobId);
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
  const s: any = { complete: 0, filled: 0, unmatched: 0, error: 0, ...(job.stats ?? {}) };
  let done = job.done, failed = job.failed;
  try {
    while (Date.now() - t0 < budgetMs - 8000) {
      const { data: items } = await db.from("bugou_import_items").select("ext_id, attempts").eq("job_id", jobId).eq("state", "pending").limit(4);
      if (!items?.length) { await db.from("bugou_import_jobs").update({ status: "done" }).eq("id", jobId); break; }
      await Promise.all(items.map(async (it: any) => {
        const [kind, id] = String(it.ext_id).split(":");
        const r = await enrichContent(ctx, kind as "movie" | "series", id!);
        s[r.status]++;
        const ok = r.status === "filled" || r.status === "complete";
        if (ok) done++; else failed++;
        await db.from("bugou_import_items").update({ state: ok ? "done" : "failed", result: r, error: ok ? null : (r.error ?? "Sem correspondência confiável no TMDB"), attempts: it.attempts + 1, updated_at: new Date().toISOString() }).eq("job_id", jobId).eq("ext_id", it.ext_id);
      }));
    }
  } finally {
    await db.from("bugou_import_jobs").update({ done, failed, stats: s, lease_until: null, updated_at: new Date().toISOString() }).eq("id", jobId);
  }
  return { busy: false };
}
