import { z } from "zod";
import type { Item } from "@/lib/catalog";

export const sectionTypes = { hero: "Banner principal", movies: "Filmes", series: "Séries", mixed: "Filmes e séries", channels: "Canais", categories: "Categorias", continue: "Continue assistindo", popular: "Mais assistidos", releases: "Lançamentos", featured: "Destaques", manual: "Conteúdo selecionado", watchlist: "Minha lista" };
export const sortTypes = { recent: "Adicionados recentemente", updated: "Atualizados recentemente", popular: "Mais assistidos", year: "Ano de lançamento", featured: "Em destaque" };
export const contentRefSchema = z.object({ kind: z.enum(["movie", "series", "channel", "category"]), id: z.string().uuid() });
const image = z.string().max(3000).refine(v => !v || /^https:\/\//i.test(v), "Use uma URL HTTPS");
export const sectionSchema = z.object({
  id: z.string().min(1).max(80), title: z.string().trim().min(1, "Informe o título").max(120),
  type: z.enum(["hero", "movies", "series", "mixed", "channels", "categories", "continue", "popular", "releases", "featured", "manual", "watchlist"]),
  mode: z.enum(["automatic", "manual"]), limit: z.number().int().min(1).max(100), active: z.boolean(), showAll: z.boolean(),
  items: z.array(contentRefSchema).max(100),
  filters: z.object({ sort: z.enum(["recent", "updated", "popular", "year", "featured"]), category: z.string().uuid().optional(), genre: z.string().uuid().optional(), year: z.number().int().min(1888).max(2200).optional() }),
});
export const bannerSchema = z.object({
  id: z.string().min(1).max(80), title: z.string().trim().min(1).max(120), subtitle: z.string().max(500), description: z.string().max(5000),
  desktop: image, mobile: image, active: z.boolean(), watch: z.boolean(), info: z.boolean(), cta: z.string().max(80),
  href: z.string().max(2000).refine(v => !v || /^https:\/\//i.test(v) || (v.startsWith("/") && !v.startsWith("//") && !v.includes("\\")), "Link inválido"),
  content: contentRefSchema.nullable(),
});
export const homeSchema = z.object({ sections: z.array(sectionSchema).max(60), banners: z.array(bannerSchema).max(30), bannerMode: z.enum(["automatic", "manual"]), bannerLimit: z.number().int().min(1).max(30) }).superRefine((c, ctx) => {
  if (new Set(c.sections.map(s => s.id)).size !== c.sections.length) ctx.addIssue({ code: "custom", message: "Seções duplicadas" });
  if (new Set(c.banners.map(s => s.id)).size !== c.banners.length) ctx.addIssue({ code: "custom", message: "Banners duplicados" });
});
export type HomeConfig = z.infer<typeof homeSchema>;
export type HomeSection = z.infer<typeof sectionSchema>;
export type HomeBanner = z.infer<typeof bannerSchema>;
export type ContentRef = z.infer<typeof contentRefSchema>;
export type HomeCategory = { id: string; name: string; slug: string; image_url: string | null };
export type ResolvedSection = { section: HomeSection; items: Item[]; categories: HomeCategory[] };
export type ResolvedHome = { config: HomeConfig; sections: ResolvedSection[]; slides: { key: string; item: Item | null; title: string; description: string | null; backdrop: string | null; mobile?: string | null; cta?: string | null; href?: string | null; showWatch?: boolean; showInfo?: boolean }[]; platformName: string };
export const emptyHome: HomeConfig = { sections: [], banners: [], bannerMode: "manual", bannerLimit: 5 };
export function newSection(type: HomeSection["type"] = "movies"): HomeSection {
  return { id: crypto.randomUUID(), title: sectionTypes[type], type, mode: "automatic", limit: 10, active: true, showAll: false, items: [], filters: { sort: "recent" } };
}
export function moveItem<T>(list: T[], from: number, to: number): T[] {
  if (from < 0 || to < 0 || from >= list.length || to >= list.length) return list;
  const next = [...list]; const [item] = next.splice(from, 1); if (item !== undefined) next.splice(to, 0, item); return next;
}
export function orderedReferences<T extends { id: string; kind: string }>(refs: ContentRef[], items: T[], limit: number): T[] {
  const map = new Map(items.map(item => [`${item.kind}:${item.id}`, item]));
  return refs.map(ref => map.get(`${ref.kind}:${ref.id}`)).filter((i): i is T => i !== undefined).slice(0, limit);
}