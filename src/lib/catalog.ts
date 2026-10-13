import { infiniteQueryOptions, queryOptions } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

// Public catalog reads. RLS only exposes published rows to visitors,
// so whatever the admin publishes (or unpublishes) is reflected here automatically.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const sb: any = supabase;

/** Rejects slow backend calls so pages can show a retry state instead of hanging. */
export function withTimeout<T>(p: PromiseLike<T>, ms = 15_000): Promise<T> {
  return Promise.race([
    Promise.resolve(p),
    new Promise<T>((_, rej) => setTimeout(() => rej(new Error("timeout: o servidor demorou para responder")), ms)),
  ]);
}

export type Kind = "movie" | "series" | "channel";
export type Genre = { id: string; name: string; slug: string };
export type Item = {
  kind: Kind;
  id: string;
  slug: string | null;
  title: string;
  description: string | null;
  poster_url: string | null;
  backdrop_url: string | null;
  trailer_url?: string | null;
  release_year?: number | null;
  duration_minutes?: number | null;
  age_rating?: string | null;
  quality?: string | null;
  language?: string | null;
  country?: string | null;
  featured: boolean;
  category_id?: string | null;
  created_at?: string;
  genres: Genre[];
};

const MOVIE_SEL =
  "id,slug,title,original_title,description,poster_url,backdrop_url,trailer_url,release_year,duration_minutes,age_rating,quality,language,country,featured,category_id,created_at,movie_genres(genres(id,name,slug))";
const SERIES_SEL =
  "id,slug,title,original_title,description,poster_url,backdrop_url,trailer_url,release_year,age_rating,featured,category_id,created_at,series_genres(genres(id,name,slug))";
const CHANNEL_SEL = "id,slug,name,logo_url,description,featured,category_id,created_at";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const isUuid = (s: string) => UUID_RE.test(s);

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Raw = any;
const pickGenres = (rows: Raw[] | null | undefined): Genre[] =>
  (rows ?? []).map((r) => r.genres).filter(Boolean);

export const toMovie = (r: Raw): Item => ({ ...r, kind: "movie", genres: pickGenres(r.movie_genres) });
export const toSeries = (r: Raw): Item => ({ ...r, kind: "series", genres: pickGenres(r.series_genres) });
export const toChannel = (r: Raw): Item => ({
  kind: "channel",
  id: r.id,
  slug: r.slug,
  title: r.name,
  description: r.description,
  poster_url: r.logo_url,
  backdrop_url: null,
  featured: r.featured,
  category_id: r.category_id,
  created_at: r.created_at,
  genres: [],
});

export const itemParam = (i: { slug?: string | null; id: string }) => i.slug || i.id;

export function formatDuration(min?: number | null) {
  if (!min) return null;
  const h = Math.floor(min / 60);
  const m = min % 60;
  return h ? `${h}h${m ? ` ${m}min` : ""}` : `${m}min`;
}

export const siteSettingsQuery = queryOptions({
  queryKey: ["site_settings"],
  queryFn: async () => {
    const { data, error } = await supabase.from("site_settings").select("*").eq("id", 1).maybeSingle();
    if (error) throw error;
    return data;
  },
  staleTime: 60_000,
});

function byIds(items: Item[], ids: string[]) {
  const map = new Map(items.map((i) => [i.id, i]));
  return ids.map((id) => map.get(id)).filter(Boolean) as Item[];
}

function groupByGenre(items: Item[], genres: Genre[], max = 6) {
  return genres
    .map((g) => ({ genre: g, items: items.filter((i) => i.genres.some((x) => x.id === g.id)) }))
    .filter((r) => r.items.length > 0)
    .sort((a, b) => b.items.length - a.items.length)
    .slice(0, max);
}

const releaseSort = (a: Item, b: Item) =>
  (b.release_year ?? 0) - (a.release_year ?? 0) || (b.created_at ?? "").localeCompare(a.created_at ?? "");

export const homeCatalogQuery = queryOptions({
  queryKey: ["catalog", "home"],
  queryFn: async () => {
    const [movies, series, channels, banners, genres, popM, popS] = await withTimeout(Promise.all([
      sb.from("movies").select(MOVIE_SEL).eq("status", "published").order("featured", { ascending: false }).order("sort_order").order("created_at", { ascending: false }).limit(80),
      sb.from("series").select(SERIES_SEL).eq("status", "published").order("featured", { ascending: false }).order("sort_order").order("created_at", { ascending: false }).limit(80),
      sb.from("channels").select(CHANNEL_SEL).eq("status", "published").order("featured", { ascending: false }).order("sort_order").limit(30),
      sb.from("banners").select("id,title,subtitle,image_url,button_label,button_url,content_kind,content_id").eq("is_active", true).order("sort_order").limit(10),
      sb.from("genres").select("id,name,slug").order("name"),
      sb.rpc("popular_content", { _kind: "movie", _limit: 20 }),
      sb.rpc("popular_series", { _limit: 20 }),
    ]));
    for (const r of [movies, series, channels, banners, genres]) if (r.error) throw r.error;
    const m: Item[] = movies.data.map(toMovie);
    const s: Item[] = series.data.map(toSeries);
    const c: Item[] = channels.data.map(toChannel);
    const g: Genre[] = genres.data;
    const popularMovies = byIds(m, (popM.data ?? []).map((x: Raw) => x.content_id));
    const popularSeries = byIds(s, (popS.data ?? []).map((x: Raw) => x.series_id));
    const popular = [...popularMovies, ...popularSeries].slice(0, 20);
    return {
      movies: m,
      series: s,
      channels: c,
      banners: banners.data as Raw[],
      featuredMovies: m.filter((x) => x.featured),
      featuredSeries: s.filter((x) => x.featured),
      releases: [...m, ...s].sort(releaseSort).slice(0, 20),
      popular,
      moviesByGenre: groupByGenre(m, g),
      seriesByGenre: groupByGenre(s, g),
    };
  },
  staleTime: 30_000,
});

export const genresQuery = queryOptions({
  queryKey: ["catalog", "genres"],
  queryFn: async () => {
    const { data, error } = await sb.from("genres").select("id,name,slug").order("name");
    if (error) throw error;
    return data as Genre[];
  },
  staleTime: 5 * 60_000,
});

export const categoriesQuery = queryOptions({
  queryKey: ["catalog", "categories"],
  queryFn: async () => {
    const { data, error } = await sb.from("categories").select("id,name,slug,description,image_url").eq("status", "published").eq("kind", "catalog").order("sort_order").order("name");
    if (error) throw error;
    return data as { id: string; name: string; slug: string; description: string | null; image_url: string | null }[];
  },
  staleTime: 60_000,
});

/** Published categories that actually contain published items of the requested kinds
 *  (movie/series via the join tables, channel via category_id). Keeps each menu area unmixed. */
export const kindCategoriesQuery = (kinds: Kind[]) =>
  queryOptions({
    queryKey: ["catalog", "categories", kinds.slice().sort().join(",")],
    queryFn: async () => {
      const categoryKind = want.has("channel") && !want.has("movie") && !want.has("series") ? "channel" : "catalog";
      const selection = categoryKind === "channel" ? "id,name,slug,description,image_url,channels(count)" : "id,name,slug,description,image_url";
      let query = sb.from("categories").select(selection).eq("status", "published").eq("kind", categoryKind);
      if (categoryKind === "channel") query = query.eq("channels.status", "published");
      const { data, error } = await query.order("sort_order").order("name");
      if (error) throw error;
      const want = new Set(kinds);
      const [m, s, c] = await Promise.all([
        want.has("movie") ? sb.from("movies").select("movie_categories!inner(category_id)").eq("status", "published") : null,
        want.has("series") ? sb.from("series").select("series_categories!inner(category_id)").eq("status", "published") : null,
        want.has("channel") ? sb.from("channels").select("category_id").eq("status", "published").not("category_id", "is", null) : null,
      ]);
      if (m?.error || s?.error || c?.error) throw m?.error ?? s?.error ?? c?.error;
      const ids = new Set<string>();
      for (const r of m?.data ?? []) for (const x of r.movie_categories ?? []) ids.add(x.category_id);
      for (const r of s?.data ?? []) for (const x of r.series_categories ?? []) ids.add(x.category_id);
      for (const r of c?.data ?? []) ids.add(r.category_id);
      return ((data ?? []) as { id: string; name: string; slug: string; description: string | null; image_url: string | null; channels?: { count: number }[] }[]).filter((cat) => ids.has(cat.id));
    },
    staleTime: 60_000,
  });

/** Category meta for the channel-categories area; null when the category is missing or has no published channels. */
export const channelCategoryMetaQuery = (slug: string) =>
  queryOptions({
    queryKey: ["catalog", "channel-category", slug],
    queryFn: async () => {
      const { data: cat, error } = await sb.from("categories").select("id,name,slug,description,image_url").eq("slug", slug).eq("status", "published").eq("kind", "channel").maybeSingle();
      if (error) throw error;
      if (!cat) return null;
      const { count, error: e2 } = await sb.from("channels").select("id", { count: "exact", head: true }).eq("status", "published").eq("category_id", cat.id);
      if (e2) throw e2;
      return (count ?? 0) > 0 ? { category: cat as { id: string; name: string; slug: string; description: string | null; image_url: string | null } } : null;
    },
    staleTime: 30_000,
  });

export const PAGE_SIZE = 24;
export type SortKey = "recent" | "year" | "title";

export const catalogListQuery = (kind: Kind, genre: string | undefined, sort: SortKey) =>
  infiniteQueryOptions({
    queryKey: ["catalog", "list", kind, genre ?? "", sort],
    initialPageParam: 0,
    queryFn: async ({ pageParam }) => {
      const table = kind === "movie" ? "movies" : kind === "series" ? "series" : "channels";
      let sel = kind === "movie" ? MOVIE_SEL : kind === "series" ? SERIES_SEL : CHANNEL_SEL;
      if (genre && kind !== "channel") {
        const join = kind === "movie" ? "movie_genres" : "series_genres";
        sel = sel.replace(`${join}(genres(id,name,slug))`, `${join}!inner(genres!inner(id,name,slug))`);
      }
      let q = sb.from(table).select(sel).eq("status", "published");
      if (genre && kind !== "channel") {
        const join = kind === "movie" ? "movie_genres" : "series_genres";
        q = q.eq(`${join}.genres.slug`, genre);
      }
      if (sort === "title") q = q.order(kind === "channel" ? "name" : "title");
      else if (sort === "year" && kind !== "channel") q = q.order("release_year", { ascending: false, nullsFirst: false });
      else q = q.order("created_at", { ascending: false });
      const from = pageParam * PAGE_SIZE;
      const { data, error } = await q.range(from, from + PAGE_SIZE - 1);
      if (error) throw error;
      const map = kind === "movie" ? toMovie : kind === "series" ? toSeries : toChannel;
      return { items: (data as Raw[]).map(map), next: data.length === PAGE_SIZE ? pageParam + 1 : null };
    },
    getNextPageParam: (last) => last.next,
    staleTime: 30_000,
  });

const bySlugOrId = (q: Raw, param: string) => (isUuid(param) ? q.eq("id", param) : q.eq("slug", param));

export const movieDetailQuery = (param: string) =>
  queryOptions({
    queryKey: ["catalog", "movie", param],
    queryFn: async () => {
      const { data, error } = await bySlugOrId(sb.from("movies").select(MOVIE_SEL).eq("status", "published"), param).maybeSingle();
      if (error) throw error;
      if (!data) return null;
      const item = toMovie(data);
      const ids = item.genres.map((g) => g.id);
      let related: Item[] = [];
      if (ids.length) {
        const r = await sb.from("movies").select(`${MOVIE_SEL.replace("movie_genres(", "mg:movie_genres!inner(genre_id),movie_genres(")}`).eq("status", "published").in("mg.genre_id", ids).neq("id", item.id).limit(16);
        related = (r.data ?? []).map(toMovie);
      }
      return { item, related };
    },
    staleTime: 30_000,
  });

export type Episode = {
  id: string; episode_number: number; title: string; description: string | null;
  thumbnail_url: string | null; duration_minutes: number | null; release_date: string | null;
};
export type Season = { id: string; season_number: number; title: string | null; poster_url: string | null; episodes: Episode[] };

export const seriesDetailQuery = (param: string) =>
  queryOptions({
    queryKey: ["catalog", "series", param],
    queryFn: async () => {
      const { data, error } = await bySlugOrId(sb.from("series").select(SERIES_SEL).eq("status", "published"), param).maybeSingle();
      if (error) throw error;
      if (!data) return null;
      const item = toSeries(data);
      const { data: seasons, error: e2 } = await sb
        .from("seasons")
        .select("id,season_number,title,poster_url,status,episodes(id,episode_number,title,description,thumbnail_url,duration_minutes,release_date,status)")
        .eq("series_id", item.id)
        .order("sort_order").order("season_number");
      if (e2) throw e2;
      const s: Season[] = (seasons ?? []).filter((x: Raw) => x.status === "published").map((x: Raw) => ({
        ...x,
        episodes: (x.episodes ?? []).filter((e: Raw) => e.status === "published").sort((a: Raw, b: Raw) => a.episode_number - b.episode_number),
      }));
      return { item, seasons: s };
    },
    staleTime: 30_000,
  });

export const channelDetailQuery = (param: string) =>
  queryOptions({
    queryKey: ["catalog", "channel", param],
    queryFn: async () => {
      const { data, error } = await bySlugOrId(sb.from("channels").select(CHANNEL_SEL).eq("status", "published"), param).maybeSingle();
      if (error) throw error;
      if (!data) return null;
      const others = await sb.from("channels").select(CHANNEL_SEL).eq("status", "published").neq("id", data.id).order("sort_order").limit(20);
      return { item: toChannel(data), others: (others.data ?? []).map(toChannel) as Item[] };
    },
    staleTime: 30_000,
  });

export const categoryQuery = (slug: string) =>
  queryOptions({
    queryKey: ["catalog", "category", slug],
    queryFn: async () => {
      const { data: cat, error } = await sb.from("categories").select("id,name,slug,description,image_url").eq("slug", slug).eq("status", "published").eq("kind", "catalog").maybeSingle();
      if (error) throw error;
      if (!cat) return null;
      const [m, s] = await Promise.all([
        sb.from("movies").select(`${MOVIE_SEL},movie_categories!inner(category_id)`).eq("status", "published").eq("movie_categories.category_id", cat.id).order("sort_order").limit(60),
        sb.from("series").select(`${SERIES_SEL},series_categories!inner(category_id)`).eq("status", "published").eq("series_categories.category_id", cat.id).order("sort_order").limit(60),
      ]);
      if (m.error || s.error) throw m.error ?? s.error;
      return {
        category: cat as { id: string; name: string; slug: string; description: string | null; image_url: string | null },
        movies: (m.data ?? []).map(toMovie) as Item[],
        series: (s.data ?? []).map(toSeries) as Item[],
        channels: [] as Item[],
      };
    },
    staleTime: 30_000,
  });

export type EpisodeHit = { id: string; title: string; episode_number: number; thumbnail_url: string | null; season_number: number; series: Item };

export const searchQuery = (term: string) =>
  queryOptions({
    queryKey: ["catalog", "search", term],
    enabled: term.trim().length >= 2,
    queryFn: async () => {
      const t = `%${term.trim().replace(/[%_,()]/g, " ")}%`;
      // Movies/series come from the ranked paged search (searchTitles); only episodes/channels here.
      const [e, c] = await Promise.all([
        sb.from("episodes").select("id,title,episode_number,thumbnail_url,seasons!inner(season_number,series!inner(id,slug,title,poster_url,backdrop_url,status))").eq("status", "published").eq("seasons.series.status", "published").ilike("title", t).limit(12),
        sb.from("channels").select(CHANNEL_SEL).eq("status", "published").ilike("name", t).limit(12),
      ]);
      const episodes: EpisodeHit[] = (e.data ?? []).map((x: Raw) => ({
        id: x.id, title: x.title, episode_number: x.episode_number, thumbnail_url: x.thumbnail_url,
        season_number: x.seasons.season_number,
        series: toSeries({ ...x.seasons.series, series_genres: [] }),
      }));
      return {
        episodes,
        channels: (c.data ?? []).map(toChannel) as Item[],
      };
    },
    staleTime: 15_000,
  });

/* ---------- Server-side page navigation (exact count + range, stable order) ---------- */
export type PagedFilter = { genre?: string | undefined; sort?: SortKey; categoryId?: string | undefined; term?: string | undefined };
export type PagedResult = { items: Item[]; total: number; page: number; pages: number };
export const pageCount = (total: number, size = PAGE_SIZE) => Math.max(1, Math.ceil(total / size));
/** Clamps a requested 1-based page into [1, pages]. */
export const clampPage = (page: number, pages: number) => Math.min(Math.max(1, Math.floor(page) || 1), Math.max(1, pages));

export const pagedListQuery = (kind: Kind, filter: PagedFilter, page: number) =>
  queryOptions({
    queryKey: ["catalog", "paged", kind, filter.genre ?? "", filter.sort ?? "recent", filter.categoryId ?? "", filter.term ?? "", page],
    queryFn: async ({ signal }): Promise<PagedResult> => {
      const p0 = Math.max(1, Math.floor(page) || 1);
      if (filter.term?.trim() && kind !== "channel" && !filter.genre && !filter.categoryId) {
        // Ranked search in the database (exact > prefix > partial), trigram-indexed.
        const term = filter.term.trim().replace(/\s+/g, " ").replace(/[%_\\]/g, " ");
        const r = await sb.rpc("search_titles", { _kind: kind, _term: term, _page: p0, _size: PAGE_SIZE }).abortSignal(signal);
        if (r.error) throw r.error;
        const ids = (r.data ?? []).map((x: { id: string }) => x.id);
        const total = Number(r.data?.[0]?.total ?? 0);
        if (!ids.length) return { items: [], total, page: p0, pages: pageCount(total) };
        const rows = await sb.from(kind === "movie" ? "movies" : "series").select(kind === "movie" ? MOVIE_SEL : SERIES_SEL).in("id", ids).abortSignal(signal);
        if (rows.error) throw rows.error;
        const byId = new Map(((rows.data ?? []) as Raw[]).map((x) => [x.id, x]));
        const map = kind === "movie" ? toMovie : toSeries;
        return { items: ids.filter((i: string) => byId.has(i)).map((i: string) => map(byId.get(i))), total, page: p0, pages: pageCount(total) };
      }
      const table = kind === "movie" ? "movies" : kind === "series" ? "series" : "channels";
      let sel = kind === "movie" ? MOVIE_SEL : kind === "series" ? SERIES_SEL : CHANNEL_SEL;
      const join = kind === "movie" ? "movie_genres" : "series_genres";
      if (filter.genre && kind !== "channel") sel = sel.replace(`${join}(genres(id,name,slug))`, `${join}!inner(genres!inner(id,name,slug))`);
      if (filter.categoryId && kind !== "channel") sel += kind === "movie" ? ",movie_categories!inner(category_id)" : ",series_categories!inner(category_id)";
      let q = sb.from(table).select(sel, { count: "exact" }).eq("status", "published");
      if (filter.genre && kind !== "channel") q = q.eq(`${join}.genres.slug`, filter.genre);
      if (filter.categoryId) q = kind === "channel" ? q.eq("category_id", filter.categoryId) : q.eq(kind === "movie" ? "movie_categories.category_id" : "series_categories.category_id", filter.categoryId);
      if (filter.term?.trim()) {
        const t = `%${filter.term.trim().replace(/[%_,()]/g, " ")}%`;
        q = kind === "channel" ? q.ilike("name", t) : q.or(`title.ilike.${t},original_title.ilike.${t}`);
      }
      const sort = filter.sort ?? "recent";
      if (filter.categoryId && !filter.sort) q = q.order("sort_order");
      else if (sort === "title") q = q.order(kind === "channel" ? "name" : "title");
      else if (sort === "year" && kind !== "channel") q = q.order("release_year", { ascending: false, nullsFirst: false });
      else q = q.order("created_at", { ascending: false });
      q = q.order("id"); // unique tie-breaker: batch imports share timestamps, which made pages repeat/skip rows
      const p = Math.max(1, Math.floor(page) || 1);
      const from = (p - 1) * PAGE_SIZE;
      const { data, error, count } = await q.range(from, from + PAGE_SIZE - 1);
      if (error && error.code !== "PGRST103") throw error; // PGRST103 = page beyond the end
      const map = kind === "movie" ? toMovie : kind === "series" ? toSeries : toChannel;
      const total = count ?? 0;
      return { items: ((data ?? []) as Raw[]).map(map), total, page: p, pages: pageCount(total) };
    },
    staleTime: 30_000,
  });
