export const CATALOG_YEAR = 2026;
export const CATALOG_BATCH_SIZE = 3;
export type DateSegment = { from: string; to: string };
export function yearSegment(): DateSegment { return { from: `${CATALOG_YEAR}-01-01`, to: `${CATALOG_YEAR}-12-31` }; }
export function splitSegment(s: DateSegment): DateSegment[] {
  const a = Date.parse(`${s.from}T00:00:00Z`), b = Date.parse(`${s.to}T00:00:00Z`);
  if (a === b) throw new Error("O TMDB excedeu 500 páginas em uma única data; intervalo exige revisão.");
  const mid = a + Math.floor((b - a) / 86400000 / 2) * 86400000;
  return [{ from: s.from, to: new Date(mid).toISOString().slice(0, 10) }, { from: new Date(mid + 86400000).toISOString().slice(0, 10), to: s.to }];
}
export function inCatalogYear(date: unknown): boolean { return typeof date === "string" && /^2026-\d{2}-\d{2}$/.test(date); }