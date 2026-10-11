/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * Pure helpers for the BugouMods paginated catalog (shared by server and tests).
 * The `?api=1&c=all` list caps every category at 50 items; the provider's own site reads full
 * categories through `index.php?ajax=1&type=home_data` (category ids) and
 * `index.php?ajax=1&type=category_page&content_type=…&cat=<id>&page=N&limit=60` (total/pages/items).
 */
export type PagedKind = "series" | "live";
export type ProviderCategory = { id: string; name: string; count: number | null };
export type PagedItem = { id: string; name: string; image: string | null; ext: string | null };
export type CategoryPage = { items: PagedItem[]; total: number; page: number; pages: number };

export const PAGE_LIMIT = 60; // provider maximum (bigger limits are clamped to 60)

/** Category ids/names exactly as the provider's home_data lists them (duplicates dropped). */
export function parseHomeCategories(json: unknown, kind: PagedKind): ProviderCategory[] {
  const cats = (json as any)?.categories?.[kind];
  if (!Array.isArray(cats)) throw new Error("Formato inesperado: a API não devolveu a lista de categorias.");
  const seen = new Set<string>(); const out: ProviderCategory[] = [];
  for (const c of cats) {
    const id = String(c?.category_id ?? "").trim(); const name = String(c?.category_name ?? "").trim().slice(0, 200);
    if (!/^\d{1,20}$/.test(id) || !name || seen.has(id)) continue;
    seen.add(id);
    const n = Number(c?.count);
    out.push({ id, name, count: Number.isFinite(n) && n >= 0 ? n : null });
  }
  return out;
}

/** One category page; throws on provider errors so callers never overwrite data with garbage. */
export function parseCategoryPage(json: unknown, kind: PagedKind): CategoryPage {
  const o = json as any;
  if (!o || typeof o !== "object" || o.success !== true || !Array.isArray(o.items)) throw new Error(`Formato inesperado na página da categoria${o?.msg ? `: ${String(o.msg).slice(0, 120)}` : ""}.`);
  const items: PagedItem[] = [];
  for (const it of o.items) {
    const id = String((kind === "series" ? it?.series_id : it?.stream_id) ?? "").trim();
    const name = String(it?.name ?? "").trim().slice(0, 200);
    if (!/^\d{1,20}$/.test(id) || !name) continue;
    const img = kind === "series" ? it?.cover : it?.stream_icon;
    const ext = typeof it?.container_extension === "string" && /^[a-z0-9]{1,8}$/i.test(it.container_extension) ? it.container_extension : null;
    items.push({ id, name, image: typeof img === "string" && /^https?:\/\/\S+$/.test(img) ? img : null, ext });
  }
  const total = Math.max(0, Number(o.total) || 0);
  const pages = Math.max(1, Number(o.pages) || Math.ceil(total / PAGE_LIMIT) || 1);
  return { items, total, page: Math.max(1, Number(o.page) || 1), pages };
}

/** Next cursor after reading `page` of category index `ci`. */
export function nextCursor(ci: number, page: number, pages: number): { ci: number; page: number } {
  return page < pages ? { ci, page: page + 1 } : { ci: ci + 1, page: 1 };
}

/**
 * Official VIP live play link, in exactly the format the provider's own `?api=1&t=live&embed=vip` list returns.
 * Used only for channels that the 50-per-category list omits.
 */
export function liveVipLink(base: string, c: { id: string; name: string; ext: string | null; image: string | null }, tok: string, embed = "vip"): string {
  const e = encodeURIComponent;
  return `${base.replace(/\/$/, "")}/?play=1&type=live_streams&id=${c.id}&ext=${c.ext || "mp4"}&name=${e(c.name)}&img=${e(c.image ?? "")}&vtoken=${e(tok)}&embed=${e(embed)}`;
}

/**
 * Provider title search, exactly as its own site calls it: `index.php?ajax=1&type=global_search&q=…`
 * → `{ live: [...], vod: [...], series: [...] }` (partial names, case-insensitive; no pagination offered).
 */
export function parseGlobalSearch(json: unknown, kind: PagedKind): PagedItem[] {
  const o = json as any;
  if (!o || typeof o !== "object" || Array.isArray(o)) throw new Error("Formato inesperado na busca da API.");
  if (o.success === false) throw new Error(`A API recusou a busca${o.msg ? `: ${String(o.msg).slice(0, 120)}` : ""}.`);
  const list = o[kind];
  if (list == null) return [];
  if (!Array.isArray(list)) throw new Error("Formato inesperado na busca da API.");
  return parseCategoryPage({ success: true, items: list, total: list.length }, kind).items
    .filter((x, i, a) => a.findIndex(y => y.id === x.id) === i);
}
