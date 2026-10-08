CREATE UNIQUE INDEX IF NOT EXISTS watch_history_user_content_uidx ON public.watch_history (user_id, content_kind, content_id);
CREATE UNIQUE INDEX IF NOT EXISTS watchlist_user_content_uidx ON public.watchlist (user_id, content_kind, content_id);

CREATE OR REPLACE FUNCTION public.popular_content(_kind content_kind, _limit int DEFAULT 20)
RETURNS TABLE(content_id uuid, views bigint)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT h.content_id, count(*)::bigint AS views
  FROM public.watch_history h
  WHERE h.content_kind = _kind AND h.watched_at > now() - interval '60 days'
    AND (
      (_kind = 'movie' AND EXISTS (SELECT 1 FROM public.movies m WHERE m.id = h.content_id AND m.status = 'published'))
      OR (_kind = 'channel' AND EXISTS (SELECT 1 FROM public.channels c WHERE c.id = h.content_id AND c.status = 'published'))
    )
  GROUP BY h.content_id ORDER BY views DESC LIMIT LEAST(_limit, 50);
$$;

CREATE OR REPLACE FUNCTION public.popular_series(_limit int DEFAULT 20)
RETURNS TABLE(series_id uuid, views bigint)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT s.id, count(*)::bigint
  FROM public.watch_history h
  JOIN public.episodes e ON e.id = h.content_id
  JOIN public.seasons se ON se.id = e.season_id
  JOIN public.series s ON s.id = se.series_id AND s.status = 'published'
  WHERE h.content_kind = 'episode' AND h.watched_at > now() - interval '60 days'
  GROUP BY s.id ORDER BY 2 DESC LIMIT LEAST(_limit, 50);
$$;

GRANT EXECUTE ON FUNCTION public.popular_content(content_kind, int) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.popular_series(int) TO anon, authenticated;

CREATE OR REPLACE FUNCTION public.get_playback_url(_kind content_kind, _content_id uuid)
RETURNS text LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $function$
DECLARE u text; ok boolean;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'not authenticated'; END IF;
  IF EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND status <> 'active') THEN RAISE EXCEPTION 'account inactive'; END IF;
  ok := CASE _kind
    WHEN 'movie' THEN EXISTS (SELECT 1 FROM movies WHERE id = _content_id AND status = 'published')
    WHEN 'channel' THEN EXISTS (SELECT 1 FROM channels WHERE id = _content_id AND status = 'published')
    WHEN 'episode' THEN EXISTS (SELECT 1 FROM episodes e JOIN seasons se ON se.id = e.season_id JOIN series s ON s.id = se.series_id
                                WHERE e.id = _content_id AND e.status = 'published' AND s.status = 'published')
    ELSE false END;
  IF NOT ok AND NOT public.is_staff(auth.uid()) THEN RETURN NULL; END IF;
  SELECT url INTO u FROM public.playback_sources WHERE content_kind = _kind AND content_id = _content_id AND is_active ORDER BY created_at DESC LIMIT 1;
  RETURN u;
END; $function$;