/**
 * Provider rate-limit helpers for queued imports (pure, unit-tested).
 * A 429 is never retried inline: the caller defers the item and pauses the whole queue.
 */
export const MAX_RATE_LIMITED = 6; // automatic 429 retries per item before it waits for a manual retry
export const MAX_ERRORS = 3; // other errors per item

export class RateLimitedError extends Error {
  constructor(public retryAfterMs: number | null, what: string) {
    super(`Limite de requisições do provedor (HTTP 429) em ${what}.`);
  }
}

/** Retry-After as seconds or HTTP date → ms, clamped to 1s..15min; null when absent/invalid. */
export function parseRetryAfter(h: string | null | undefined, now = Date.now()): number | null {
  if (!h) return null;
  const s = h.trim();
  let ms: number;
  if (/^\d+(\.\d+)?$/.test(s)) ms = Number(s) * 1000;
  else { const t = Date.parse(s); if (!Number.isFinite(t)) return null; ms = t - now; }
  if (!Number.isFinite(ms)) return null;
  return Math.min(15 * 60_000, Math.max(1000, Math.round(ms)));
}

/** Exponential backoff with ±25% jitter so deferred items don't retry together. */
export function backoffMs(attempt: number, baseMs = 15_000, capMs = 10 * 60_000, rand = Math.random): number {
  const raw = Math.min(capMs, baseMs * 2 ** Math.max(0, attempt - 1));
  return Math.round(raw * (0.75 + rand() * 0.5));
}

/** Pace between provider calls from the integration's requests-per-minute and the adaptive factor. */
export function minIntervalMs(rpm: number, factor = 1): number {
  const r = Math.max(1, rpm) * Math.min(1, Math.max(0.05, factor));
  return Math.ceil(60_000 / r);
}

/** Halve speed on 429, recover gradually (+10%) on each success. */
export function adaptFactor(factor: number, event: "ok" | "429"): number {
  return event === "429" ? Math.max(0.125, factor / 2) : Math.min(1, factor + 0.1);
}

/** Single provider GET: timeout, one retry for network/5xx, 429 surfaced immediately with Retry-After. */
export async function fetchProviderJson(url: URL, what: string, opts: { timeoutMs: number; fetchImpl?: typeof fetch; sleep?: (ms: number) => Promise<void> }): Promise<{ json: any; requests: number }> {
  const f = opts.fetchImpl ?? fetch;
  const sleep = opts.sleep ?? ((ms: number) => new Promise<void>(r => setTimeout(r, ms)));
  let last = ""; let requests = 0;
  for (let i = 0; i < 2; i++) {
    if (i) await sleep(1500 + Math.round(Math.random() * 1000));
    requests++;
    let res: Response;
    try { res = await f(url, { headers: { "User-Agent": "Mozilla/5.0", Accept: "application/json" }, signal: AbortSignal.timeout(opts.timeoutMs) }); }
    catch (e) { last = (e as Error)?.name === "TimeoutError" ? `Tempo esgotado ao consultar o BugouMods (${what}).` : `Não foi possível conectar ao BugouMods (${what}).`; continue; }
    if (res.status === 429) { const err = new RateLimitedError(parseRetryAfter(res.headers.get("retry-after")), what); (err as any).requests = requests; throw err; }
    if (res.status >= 500) { last = `BugouMods respondeu HTTP ${res.status} (${what}).`; continue; }
    if (!res.ok) throw new Error(`BugouMods respondeu HTTP ${res.status} (${what}).`);
    try { return { json: await res.json(), requests }; } catch { throw new Error(`BugouMods não respondeu em JSON (${what}).`); }
  }
  const err = new Error(last); (err as any).requests = requests; throw err;
}
