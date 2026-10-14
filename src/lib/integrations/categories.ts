import { slugify } from "./m3u";

/**
 * Keep channel categories separate from the movie/series catalog.
 * The database uses a global unique slug, so channel slugs get a suffix.
 */
export function categorySlugForKind(baseSlug: string, kind: "catalog" | "channel", conflictingKind?: string | null): string {
  if (kind === "channel") return baseSlug.endsWith("-canais") ? baseSlug : `${baseSlug.slice(0, 90)}-canais`;
  if (conflictingKind === "channel") return `${baseSlug.slice(0, 90)}-catalogo`;
  return baseSlug;
}

/** Source category names → unique {name, slug} pairs. */
export function categoryEntries(names: (string | null | undefined)[]): { name: string; slug: string }[] {
  const out = new Map<string, { name: string; slug: string }>();
  for (const raw of names) {
    const name = (raw ?? "").replace(/\s+/g, " ").trim().slice(0, 120);
    const slug = name ? slugify(name).slice(0, 100) : "";
    if (slug && !out.has(slug)) out.set(slug, { name, slug });
  }
  return [...out.values()];
}

/**
 * Create categories on demand during import and link them to the imported item.
 * Writes are additive and idempotent: this function never deletes categories,
 * content, or existing associations.
 */
export async function linkCategories(
  _db: any,
  kind: "movie" | "series" | "channel",
  id: string,
  names: (string | null | undefined)[],
) { // eslint-disable-line @typescript-eslint/no-explicit-any
  if (!id) throw new Error("Categoria: ID do conteúdo obrigatório.");
  if (!["movie", "series", "channel"].includes(kind)) throw new Error("Categoria: tipo de conteúdo inválido.");

  const categoryKind = kind === "channel" ? "channel" : "catalog";
  const cats = categoryEntries(names).map((c) => ({
    ...c,
    slug: categorySlugForKind(c.slug, categoryKind),
  }));
  if (!cats.length) return 0;

  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const db = supabaseAdmin as any;

  const create = await db.from("categories").upsert(
    cats.map((c) => ({ ...c, status: "published", scope: categoryKind === "channel" ? "channel" : "media" })),
    { onConflict: "slug", ignoreDuplicates: true },
  );
  if (create.error) throw new Error(`Categoria: ${create.error.message}`);

  const { data: categoryRows, error: lookupError } = await db
    .from("categories")
    .select("id,slug,scope")
    .in("slug", cats.map((c) => c.slug))
    .eq("scope", categoryKind === "channel" ? "channel" : "media");
  if (lookupError) throw new Error(`Categoria: ${lookupError.message}`);

  const idsBySlug = new Map((categoryRows ?? []).map((c: any) => [String(c.slug), String(c.id)]));
  const ids = [...new Set(cats.map((c) => idsBySlug.get(c.slug)).filter((x): x is string => !!x))];
  if (!ids.length) return 0;
  const primaryId = ids[0];

  if (kind === "channel") {
    const { error } = await db.from("channels").update({ category_id: primaryId }).eq("id", id).is("category_id", null);
    if (error) throw new Error(`Categoria: ${error.message}`);
    return 1;
  }

  const table = kind === "movie" ? "movies" : "series";
  const joinTable = kind === "movie" ? "movie_categories" : "series_categories";
  const contentColumn = kind === "movie" ? "movie_id" : "series_id";

  // Keep an existing primary category; set it only when empty.
  const primary = await db.from(table).update({ category_id: primaryId }).eq("id", id).is("category_id", null);
  if (primary.error) throw new Error(`Categoria: ${primary.error.message}`);

  const { data: existingLinks, error: linksError } = await db
    .from(joinTable)
    .select("category_id")
    .eq(contentColumn, id);
  if (linksError) throw new Error(`Categoria: ${linksError.message}`);

  const existingIds = new Set((existingLinks ?? []).map((x: any) => String(x.category_id)));
  const missing = ids.filter((categoryId) => !existingIds.has(categoryId));
  if (missing.length) {
    const insert = await db.from(joinTable).insert(missing.map((categoryId) => ({
      [contentColumn]: id,
      category_id: categoryId,
    })));
    if (insert.error) throw new Error(`Categoria: ${insert.error.message}`);
  }

  return missing.length;
}
