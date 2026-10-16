import { safeImageUrl } from "@/lib/tmdb/completion";
import { queryOptions, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import type { User } from "@supabase/supabase-js";
import { supabase } from "@/lib/auth/area-client";
import { toChannel, toMovie, toSeries, type Item } from "@/lib/catalog";

// Signed-in viewer data (history, watchlist). Browser client: RLS restricts rows to auth.uid().
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const sb: any = supabase;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Raw = any;

export function useAuthUser() {
  const [user, setUser] = useState<User | null>(null);
  const [ready, setReady] = useState(false);
  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setUser(data.session?.user ?? null);
      setReady(true);
    });
    const { data } = supabase.auth.onAuthStateChange((_e, s) => setUser(s?.user ?? null));
    return () => data.subscription.unsubscribe();
  }, []);
  return { user, ready };
}

// ===== Viewer profiles (multiple profiles per account) =====
export type ViewerProfile = { id: string; name: string; avatar_url: string | null; is_kids: boolean; preferences: Record<string, unknown> };

export const viewerProfilesQuery = (userId: string) =>
  queryOptions({
    queryKey: ["me", userId, "viewer_profiles"],
    queryFn: async () => {
      const { data, error } = await sb.from("viewer_profiles").select("id,name,avatar_url,is_kids,preferences").eq("user_id", userId).order("created_at");
      if (error) throw error;
      return data as ViewerProfile[];
    },
    staleTime: 60_000,
  });

const VP_EVENT = "viewer-profile-change";
const vpKey = (uid: string) => `vp:${uid}`;
export function setActiveProfileId(uid: string, id: string) {
  localStorage.setItem(vpKey(uid), id);
  window.dispatchEvent(new Event(VP_EVENT));
}

/** Active viewer profile for the signed-in account (persisted per device). */
export function useActiveProfile() {
  const { user, ready } = useAuthUser();
  const list = useQuery({ ...viewerProfilesQuery(user?.id ?? "none"), enabled: !!user });
  const [stored, setStored] = useState<string | null>(null);
  useEffect(() => {
    if (!user) return;
    const read = () => setStored(localStorage.getItem(vpKey(user.id)));
    read();
    window.addEventListener(VP_EVENT, read);
    return () => window.removeEventListener(VP_EVENT, read);
  }, [user]);
  const profiles = list.data ?? [];
  const active = profiles.find((p) => p.id === stored) ?? profiles[0] ?? null;
  return { user, ready, profiles, active, profileId: active?.id ?? null, loading: list.isLoading };
}

const MOVIE_MIN = "id,slug,title,description,poster_url,backdrop_url,release_year,duration_minutes,age_rating,quality,featured";
const SERIES_MIN = "id,slug,title,description,poster_url,backdrop_url,release_year,age_rating,featured";

export const watchlistQuery = (userId: string, profileId: string | null) =>
  queryOptions({
    queryKey: ["me", userId, "watchlist", profileId],
    queryFn: async () => {
      let q = sb.from("watchlist").select("content_kind,content_id,added_at").eq("user_id", userId);
      q = profileId ? q.eq("viewer_profile_id", profileId) : q.is("viewer_profile_id", null);
      const { data, error } = await q.order("added_at", { ascending: false });
      if (error) throw error;
      const mIds = data.filter((r: Raw) => r.content_kind === "movie").map((r: Raw) => r.content_id);
      const sIds = data.filter((r: Raw) => r.content_kind === "series").map((r: Raw) => r.content_id);
      const [m, s] = await Promise.all([
        mIds.length ? sb.from("movies").select(MOVIE_MIN).in("id", mIds) : { data: [] },
        sIds.length ? sb.from("series").select(SERIES_MIN).in("id", sIds) : { data: [] },
      ]);
      const map = new Map<string, Item>();
      (m.data ?? []).forEach((r: Raw) => map.set(r.id, toMovie(r)));
      (s.data ?? []).forEach((r: Raw) => map.set(r.id, toSeries(r)));
      return data.map((r: Raw) => map.get(r.content_id)).filter(Boolean) as Item[];
    },
  });

export function useWatchlist() {
  const { user, profileId, loading } = useActiveProfile();
  const qc = useQueryClient();
  const q = useQuery({ ...watchlistQuery(user?.id ?? "none", profileId), enabled: !!user && !loading });
  const ids = new Set((q.data ?? []).map((i) => i.id));
  const toggle = useMutation({
    mutationFn: async (item: { id: string; kind: "movie" | "series" }) => {
      if (!user) throw new Error("Entre na sua conta para usar a Minha lista.");
      if (ids.has(item.id)) {
        let d = sb.from("watchlist").delete().eq("user_id", user.id).eq("content_kind", item.kind).eq("content_id", item.id);
        d = profileId ? d.eq("viewer_profile_id", profileId) : d.is("viewer_profile_id", null);
        const { error } = await d;
        if (error) throw error;
        return false;
      }
      const { error } = await sb.from("watchlist").insert({ user_id: user.id, viewer_profile_id: profileId, content_kind: item.kind, content_id: item.id });
      if (error) throw error;
      return true;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["me", user?.id, "watchlist"] }),
  });
  return { user, items: q.data ?? [], has: (id: string) => ids.has(id), toggle, isLoading: q.isLoading };
}

export type ContinueItem = {
  kind: "movie" | "episode" | "channel";
  contentId: string;
  position: number;
  percent: number;
  title: string;
  subtitle: string | null;
  image: string | null;
};

const byProfile = (q: Raw, profileId: string | null) => (profileId ? q.eq("viewer_profile_id", profileId) : q.is("viewer_profile_id", null));

export const continueWatchingQuery = (userId: string, profileId: string | null, all = false) =>
  queryOptions({
    queryKey: ["me", userId, "continue", profileId, all],
    queryFn: async () => {
      let base = byProfile(sb.from("watch_history").select("content_kind,content_id,position_seconds,progress_percent,watched_at").eq("user_id", userId), profileId);
      if (!all) base = base.lt("progress_percent", 95).gt("position_seconds", 5);
      const { data, error } = await base("progress_percent", 95).gt("position_seconds", 5).order("watched_at", { ascending: false }).limit(20);
      if (error) throw error;
      const ids = (k: string) => data.filter((r: Raw) => r.content_kind === k).map((r: Raw) => r.content_id);
      const [m, e] = await Promise.all([
        ids("movie").length ? sb.from("movies").select(MOVIE_MIN).in("id", ids("movie")) : { data: [] },
        ids("episode").length
          ? sb.from("episodes").select("id,title,episode_number,thumbnail_url,seasons!inner(season_number,series!inner(id,title,backdrop_url,poster_url))").in("id", ids("episode"))
          : { data: [] },
      ]);
      const out: ContinueItem[] = [];
      for (const r of data as Raw[]) {
        const base = { contentId: r.content_id, position: r.position_seconds, percent: Number(r.progress_percent) };
        if (r.content_kind === "movie") {
          const x = (m.data ?? []).find((y: Raw) => y.id === r.content_id);
          if (x) out.push({ ...base, kind: "movie", title: x.title, subtitle: x.release_year ? String(x.release_year) : null, image: x.backdrop_url || x.poster_url });
        } else if (r.content_kind === "episode") {
          const x = (e.data ?? []).find((y: Raw) => y.id === r.content_id);
          if (x) out.push({ ...base, kind: "episode", title: x.seasons.series.title, subtitle: `T${x.seasons.season_number}:E${x.episode_number} · ${x.title}`, image: safeImageUrl(x.thumbnail_url) || x.seasons.series.backdrop_url || x.seasons.series.poster_url });
        }
      }
      return out;
    },
  });

export async function getProgress(userId: string, profileId: string | null, kind: string, id: string) {
  const { data } = await byProfile(sb.from("watch_history").select("position_seconds,progress_percent").eq("user_id", userId).eq("content_kind", kind).eq("content_id", id), profileId).maybeSingle();
  return data as { position_seconds: number; progress_percent: number } | null;
}

export async function removeHistory(userId: string, profileId: string | null, kind: string, id: string) {
  const { error } = await byProfile(sb.from("watch_history").delete().eq("user_id", userId).eq("content_kind", kind).eq("content_id", id), profileId);
  if (error) throw error;
}

export async function saveProgress(userId: string, profileId: string | null, kind: string, id: string, position: number, duration: number) {
  const percent = duration > 0 ? Math.min(100, Math.round((position / duration) * 1000) / 10) : 0;
  await sb.from("watch_history").upsert(
    { user_id: userId, viewer_profile_id: profileId, content_kind: kind, content_id: id, position_seconds: Math.floor(position), progress_percent: percent, watched_at: new Date().toISOString() },
    { onConflict: "user_id,viewer_profile_id,content_kind,content_id" },
  );
}

export { toChannel };
