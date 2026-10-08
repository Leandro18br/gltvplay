import { queryOptions } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

// Public catalog reads. RLS only exposes published rows to visitors,
// so whatever the admin publishes appears here automatically.

export const siteSettingsQuery = queryOptions({
  queryKey: ["site_settings"],
  queryFn: async () => {
    const { data, error } = await supabase.from("site_settings").select("*").eq("id", 1).maybeSingle();
    if (error) throw error;
    return data;
  },
  staleTime: 60_000,
});

export const homeCatalogQuery = queryOptions({
  queryKey: ["catalog", "home"],
  queryFn: async () => {
    const [movies, series, channels] = await Promise.all([
      supabase
        .from("movies")
        .select("id,title,description,poster_url,backdrop_url,release_year,age_rating,quality,featured,duration_minutes")
        .eq("status", "published")
        .order("featured", { ascending: false })
        .order("sort_order")
        .order("created_at", { ascending: false })
        .limit(30),
      supabase
        .from("series")
        .select("id,title,description,poster_url,backdrop_url,release_year,age_rating,featured")
        .eq("status", "published")
        .order("featured", { ascending: false })
        .order("sort_order")
        .order("created_at", { ascending: false })
        .limit(30),
      supabase
        .from("channels")
        .select("id,name,logo_url,description,featured")
        .eq("status", "published")
        .order("featured", { ascending: false })
        .order("sort_order")
        .limit(30),
    ]);
    if (movies.error) throw movies.error;
    if (series.error) throw series.error;
    if (channels.error) throw channels.error;
    return { movies: movies.data, series: series.data, channels: channels.data };
  },
  staleTime: 30_000,
});
