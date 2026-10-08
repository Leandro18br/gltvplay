import { createFileRoute } from "@tanstack/react-router";
import { createClient } from "@supabase/supabase-js";

// Dynamic sitemap: lists every published movie, series, channel and category.
export const Route = createFileRoute("/sitemap.xml")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const origin = new URL(request.url).origin;
        const sb = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_PUBLISHABLE_KEY!, {
          auth: { storage: undefined, persistSession: false, autoRefreshToken: false },
        });
        const [m, s, c, cat] = await Promise.all([
          sb.from("movies").select("id,slug,updated_at").eq("status", "published").limit(5000),
          sb.from("series").select("id,slug,updated_at").eq("status", "published").limit(5000),
          sb.from("channels").select("id,slug,updated_at").eq("status", "published").limit(2000),
          sb.from("categories").select("slug,updated_at").eq("status", "published").limit(500),
        ]);
        const esc = (u: string) => u.replace(/&/g, "&amp;").replace(/</g, "&lt;");
        const urls: { loc: string; lastmod?: string }[] = [
          { loc: "/" }, { loc: "/filmes" }, { loc: "/series" }, { loc: "/canais" }, { loc: "/categorias" },
          ...(m.data ?? []).map((r) => ({ loc: `/filme/${r.slug || r.id}`, lastmod: r.updated_at })),
          ...(s.data ?? []).map((r) => ({ loc: `/serie/${r.slug || r.id}`, lastmod: r.updated_at })),
          ...(c.data ?? []).map((r) => ({ loc: `/canal/${r.slug || r.id}`, lastmod: r.updated_at })),
          ...(cat.data ?? []).map((r) => ({ loc: `/categoria/${r.slug}`, lastmod: r.updated_at })),
        ];
        const xml = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls
          .map((u) => `  <url><loc>${esc(origin + encodeURI(u.loc))}</loc>${u.lastmod ? `<lastmod>${u.lastmod.slice(0, 10)}</lastmod>` : ""}</url>`)
          .join("\n")}\n</urlset>`;
        return new Response(xml, { headers: { "content-type": "application/xml; charset=utf-8", "cache-control": "public, max-age=3600" } });
      },
    },
  },
});
