import { slugify } from "./m3u";

/**
 * Prevent slug collisions between catalog and live-channel categories.
 */
export function categorySlugForKind(baseSlug: string, kind: "catalog" | "channel", conflictingKind?: string | null): string {
  if (!conflictingKind || conflictingKind === kind) return baseSlug;
  return `${baseSlug.slice(0, 90)}-${kind === "channel" ? "canais" : "catalogo"}`;
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
 * Link imported content to categories using explicit, additive writes.
 *
 * Deliberately does not call the legacy import_link_categories RPC: some deployed
 * databases still have an older definition that attempts an unscoped DELETE and
 * fails with "DELETE requires a WHERE clause". The importer runs server-side and
 * has already authorized the staff user, so use the service-role client for these
 * narrowly scoped upserts/inserts instead. Existing links and primary categories
 * are preserved; this function never deletes content or category rows.
 */
export async function linkCategories(
  _db: any,
  kind: "movie" | "series" | "channel",
  id: string,
  names: (string | null | undefined)[],
) { // eslint-disable-line @typescript-eslint/no-explicit-any
  if (!id) throw new Error("Categoria: ID do conteúdo obrigatório.");
  if (!["movie", "series", "channel"].includes(kind)) throw new Error("Categoria: tipo de conteúdo inválido.");

  const cats = categoryEntries(names);
  if (!cats.length) return 0;

  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const db = supabaseAdmin as any;

  const create = await db.from("categories").upsert(
    cats.map((c) => ({ ...c, status: "published" })),
    { onConflict: "slug", ignoreDuplicates: true },
  );
  if (create.error) throw new Error(`Categoria: ${create.error.message}`);

  const { data: categoryRows, error: lookupError } = await db
    .from("categories")
    .select("id,slug")
    .in("slug", cats.map((c) => c.slug));
  if (lookupError) throw new Error(`Categoria: ${lookupError.message}`);

  const ids = [...new Set((categoryRows ?? []).map((c: any) => String(c.id)))];
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

  // Preserve any existing primary category; fill it only when empty.
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
