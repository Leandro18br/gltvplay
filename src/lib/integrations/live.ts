/* eslint-disable @typescript-eslint/no-explicit-any */
/** Pure helpers for live-channel API integrations (BugouMods VIP format). Shared by server and tests. */

export type LiveChannel = { id: string; name: string; logo: string | null; category: string; playUrl: string | null; problem: string | null };
export type LiveParse = { categories: string[]; channels: LiveChannel[]; received: number; duplicates: number; invalid: number; missingLink: number };

/**
 * The provider answers `{ "<categoria>": [{ id, nome, capa, link, categoria }] }`.
 * `link` is the official VIP play URL (keeps every parameter, including vtoken and embed=vip).
 * Throws when the shape changed, so callers never overwrite stored data with garbage.
 */
export function parseLiveList(json: unknown, host = "cinema.bugoumods.com"): LiveParse {
  if (!json || typeof json !== "object" || Array.isArray(json)) throw new Error("Formato inesperado: a API não devolveu categorias.");
  const o = json as Record<string, unknown>;
  if ("Aviso" in o) throw new Error("A API devolveu um aviso em vez da lista (token inválido ou vencido).");
  const seen = new Set<string>(); const channels: LiveChannel[] = []; const categories: string[] = [];
  let received = 0, duplicates = 0, invalid = 0, missingLink = 0;
  for (const [cat, list] of Object.entries(o)) {
    if (!Array.isArray(list)) continue;
    categories.push(cat);
    for (const it of list as any[]) {
      received++;
      const id = String(it?.id ?? "").trim();
      const name = String(it?.nome ?? "").trim().slice(0, 200);
      if (!/^\d{1,20}$/.test(id) || !name) { invalid++; continue; }
      if (seen.has(id)) { duplicates++; continue; }
      seen.add(id);
      const playUrl = validPlayUrl(it?.link, host);
      if (!playUrl) missingLink++;
      const capa = typeof it?.capa === "string" && /^https?:\/\/\S+$/.test(it.capa) ? it.capa.replace(/^http:\/\//, "https://") : null;
      channels.push({ id, name, logo: capa, category: String(it?.categoria ?? cat).slice(0, 200) || cat, playUrl, problem: playUrl ? null : "A API não forneceu um link de reprodução válido para este canal." });
    }
  }
  if (!categories.length) throw new Error("Formato inesperado: nenhuma categoria na resposta.");
  return { categories, channels, received, duplicates, invalid, missingLink };
}

/** Keeps the provider URL untouched; only accepts https/http links on the provider host with a VIP live player. */
export function validPlayUrl(v: unknown, host: string): string | null {
  if (typeof v !== "string" || v.length > 2048) return null;
  let u: URL; try { u = new URL(v); } catch { return null; }
  if (!/^https?:$/.test(u.protocol) || u.hostname !== host) return null;
  if (u.searchParams.get("type") !== "live_streams" || !u.searchParams.get("id")) return null;
  return v;
}

export const liveRef = (id: string) => `bugoumods-live:${id}`;

/** Errors that must not be retried (credentials / format). */
export function isPermanent(msg: string) { return /HTTP (401|403|404)|aviso|Formato inesperado|sem link|não forneceu/i.test(msg); }
