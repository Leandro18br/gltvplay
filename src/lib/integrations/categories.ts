import { slugify } from "./m3u";

/** Source category names → unique {name, slug} pairs (same slug rule as M3U, so one category per name across sources). */
export function categoryEntries(names: (string | null | undefined)[]): { name: string; slug: string }[] {
  const out = new Map<string, { name: string; slug: string }>();
  for (const raw of names) {
    const name = (raw ?? "").replace(/\s+/g, " ").trim().slice(0, 120);
    const slug = name ? slugify(name).slice(0, 100) : "";
    if (slug && !out.has(slug)) out.set(slug, { name, slug });
  }
  return [...out.values()];
}

/** Reuses or creates each source category and links the content (join rows for movies/series; category_id for channels). */
export async function linkCategories(db: any, kind: "movie" | "series" | "channel", id: string, names: (string | null | undefined)[]) { // eslint-disable-line @typescript-eslint/no-explicit-any
  const cats = categoryEntries(names);
  if (!cats.length) return 0;
  const r = await db.rpc("import_link_categories", { _kind: kind, _id: id, _cats: cats });
  if (r.error) throw new Error(`Categoria: ${r.error.message}`);
  return r.data as number;
}
