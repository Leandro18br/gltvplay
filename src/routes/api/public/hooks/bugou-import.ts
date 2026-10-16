import { createFileRoute } from "@tanstack/react-router";
import { runSeriesJob } from "@/lib/integrations/bugoumods.functions";

/**
 * Background worker for BugouMods series import jobs (called every minute by the schedule armed when jobs are queued).
 * The bearer check only filters stray traffic: the work is idempotent, lease-guarded and limited to jobs staff already queued.
 * When no running series job has pending items it removes its own schedule.
 */
export const Route = createFileRoute("/api/public/hooks/bugou-import")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const token = request.headers.get("authorization")?.replace(/^Bearer /, "");
        if (!token || token !== process.env["SUPABASE_PUBLISHABLE_KEY"]) return new Response("Unauthorized", { status: 401 });
        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const db = supabaseAdmin as any; // eslint-disable-line @typescript-eslint/no-explicit-any
        const ctx = { supabase: db, userId: "" }; // "" = system actor (no audit actor)
        const started = Date.now(); const BUDGET = 45_000; const ran: string[] = [];
        const { data: jobs } = await db.from("bugou_import_jobs").select("id, kind").neq("kind", "live").eq("status", "running").order("created_at").limit(10);
        const { runMovieJob, runStreamBetterJob, runMetadataRepairJob } = await import("@/lib/integrations/background-import.server");
        // StreamBetter is a separate provider quota: run it alongside the BugouMods queues instead of after them.
        const sb = (jobs ?? []).filter((j: any) => j.kind.startsWith("streambetter_") || j.kind === "metadata_repair");
        const sbRun = Promise.all(sb.map((j: any) => (j.kind === "metadata_repair" ? runMetadataRepairJob(ctx, j.id, BUDGET) : runStreamBetterJob(ctx, j.id, j.kind === "streambetter_movie" ? "movie" : "series", BUDGET)).catch(e => console.error("sb worker", j.id, (e as Error).message))));
        for (const j of (jobs ?? []).filter((j: any) => !j.kind.startsWith("streambetter_") && j.kind !== "metadata_repair").sort((a: any, b: any) => Number(b.kind === "movie") - Number(a.kind === "movie"))) {
          const left = BUDGET - (Date.now() - started);
          if (left < 8000) break;
          try { const r = j.kind === "movie" ? await runMovieJob(ctx, j.id, Math.min(left, 20000)) : await runSeriesJob(ctx, j.id, left); if (!r.busy) ran.push(j.id); }
          catch (e) { console.error("bugou worker", j.id, (e as Error).message); }
        }
        await sbRun;
        const { count } = await db.from("bugou_import_jobs").select("id", { count: "exact", head: true }).neq("kind", "live").eq("status", "running");
        if (!count) await db.rpc("bugou_worker_disarm");
        return Response.json({ ok: true, ran: ran.length, running: count ?? 0 });
      },
    },
  },
});
