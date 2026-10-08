import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

/**
 * Catalog import architecture.
 * Each provider is a licensed metadata API (never scraping). Add new providers
 * to PROVIDERS; each normalizes results into ImportItem. Imported rows are
 * de-duplicated by (external_source, external_id).
 */
export type ImportItem = {
  external_source: string;
  external_id: string;
  kind: "movie" | "series";
  title: string;
  original_title: string | null;
  description: string | null;
  poster_url: string | null;
  backdrop_url: string | null;
  release_year: number | null;
  language: string | null;
};

type Provider = {
  id: string;
  name: string;
  secret: string;
  search: (q: string, kind: "movie" | "series", key: string) => Promise<ImportItem[]>;
};

const IMG = "https://image.tmdb.org/t/p/";
const PROVIDERS: Provider[] = [
  {
    id: "tmdb",
    name: "TMDB (The Movie Database)",
    secret: "TMDB_API_KEY",
    search: async (q, kind, key) => {
      const path = kind === "movie" ? "movie" : "tv";
      const res = await fetch(`https://api.themoviedb.org/3/search/${path}?query=${encodeURIComponent(q)}&language=pt-BR&api_key=${key}`);
      if (!res.ok) throw new Error(`TMDB [${res.status}]: ${await res.text()}`);
      const json = (await res.json()) as { results: Record<string, unknown>[] };
      return json.results.slice(0, 20).map((r) => {
        const date = String(r.release_date ?? r.first_air_date ?? "");
        return {
          external_source: "tmdb",
          external_id: `${path}:${r.id}`,
          kind,
          title: String(r.title ?? r.name ?? ""),
          original_title: (r.original_title ?? r.original_name ?? null) as string | null,
          description: (r.overview as string) || null,
          poster_url: r.poster_path ? `${IMG}w500${r.poster_path}` : null,
          backdrop_url: r.backdrop_path ? `${IMG}w1280${r.backdrop_path}` : null,
          release_year: date ? Number(date.slice(0, 4)) : null,
          language: (r.original_language as string) ?? null,
        };
      });
    },
  },
];

async function assertStaff(context: { supabase: { rpc: (fn: "is_staff", a: { _user_id: string }) => PromiseLike<{ data: boolean | null }> }; userId: string }) {
  const { data } = await context.supabase.rpc("is_staff", { _user_id: context.userId });
  if (!data) throw new Error("Acesso negado");
}

export const listImportProviders = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await assertStaff(context);
    return PROVIDERS.map((p) => ({ id: p.id, name: p.name, secret: p.secret, configured: !!process.env[p.secret] }));
  });

export const searchImport = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ provider: z.string(), query: z.string().min(1).max(200), kind: z.enum(["movie", "series"]) }).parse(d))
  .handler(async ({ data, context }) => {
    await assertStaff(context);
    const p = PROVIDERS.find((x) => x.id === data.provider);
    if (!p) throw new Error("Fonte desconhecida");
    const key = process.env[p.secret];
    if (!key) throw new Error(`Fonte não configurada (${p.secret})`);
    return p.search(data.query, data.kind, key);
  });
