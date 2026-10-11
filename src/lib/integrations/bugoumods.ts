export type BugouSeries = { id: string; title: string; year: number | null; poster_url: string | null; category: string };

/** "1883 (2021)" -> { title: "1883", year: 2021 }. */
export function parseBugouName(nome: string): { title: string; year: number | null } {
  const s = nome.trim();
  const m = s.match(/^(.*?)\s*\((\d{4})\)\s*$/);
  if (m && m[1].trim()) return { title: m[1].trim(), year: Number(m[2]) };
  return { title: s, year: null };
}
