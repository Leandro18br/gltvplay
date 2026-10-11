import { db } from "@/lib/admin/db";

export type BulkKind = "movie" | "series" | "channel";
export type BulkAction = "draft" | "delete";
export type BulkResult = { requested: number; affected: number; missing: string[]; failed: string[]; errors: string[]; seasons: number; episodes: number };

export const BULK_TABLES: Record<string, BulkKind> = { movies: "movie", series: "series", channels: "channel" };

/** Batch size per server call; series deletes cascade into many episodes, so they go smaller. */
export function batchSize(kind: BulkKind, action: BulkAction) {
  return kind === "series" && action === "delete" ? 100 : 500;
}

export function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

/** Runs the server-authorized bulk RPC in batches; failed batches are reported, never counted as success. */
export async function runBulk(kind: BulkKind, action: BulkAction, ids: string[], onProgress?: (done: number) => void): Promise<BulkResult> {
  const res: BulkResult = { requested: ids.length, affected: 0, missing: [], failed: [], errors: [], seasons: 0, episodes: 0 };
  let done = 0;
  for (const part of chunk(ids, batchSize(kind, action))) {
    const { data, error } = await db.rpc("admin_bulk_content", { _kind: kind, _action: action, _ids: part });
    if (error) { res.failed.push(...part); res.errors.push(error.message); }
    else {
      res.affected += data.affected ?? 0;
      res.seasons += data.seasons ?? 0;
      res.episodes += data.episodes ?? 0;
      res.missing.push(...(data.missing ?? []));
    }
    done += part.length;
    onProgress?.(done);
  }
  return res;
}

export function summarize(res: BulkResult, action: BulkAction, noun: string) {
  const verb = action === "draft" ? "movido(s) para rascunho" : "excluído(s)";
  const parts = [`${res.affected} de ${res.requested} ${noun} ${verb}`];
  if (res.episodes) parts.push(`${res.seasons} temporada(s) e ${res.episodes} episódio(s) removidos`);
  if (res.missing.length) parts.push(`${res.missing.length} já não existiam`);
  if (res.failed.length) parts.push(`${res.failed.length} falharam: ${res.errors[0] ?? "erro"}`);
  return { ok: res.failed.length === 0, text: parts.join(" · ") };
}
