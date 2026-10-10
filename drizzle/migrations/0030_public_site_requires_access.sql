ALTER TABLE public.access_accounts ADD COLUMN IF NOT EXISTS auth_user_id uuid UNIQUE REFERENCES public.profiles(id) ON DELETE SET NULL;

CREATE TABLE public.access_login_attempts (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  login text NOT NULL,
  ip_hash text NOT NULL,
  success boolean NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX access_login_attempts_login_idx ON public.access_login_attempts(login, created_at DESC);
CREATE INDEX access_login_attempts_ip_idx ON public.access_login_attempts(ip_hash, created_at DESC);
GRANT ALL ON public.access_login_attempts TO service_role;
ALTER TABLE public.access_login_attempts ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public.has_site_access(_user_id uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT _user_id IS NOT NULL AND (
    public.is_staff(_user_id) OR EXISTS (
      SELECT 1 FROM public.access_accounts a
      LEFT JOIN public.resellers r ON r.user_id = a.reseller_id
      WHERE a.auth_user_id = _user_id AND a.status = 'active'
        AND a.starts_at <= now() AND a.expires_at > now()
        AND (a.reseller_id IS NULL OR r.status = 'active')))
$$;
REVOKE ALL ON FUNCTION public.has_site_access(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.has_site_access(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.access_login_lock(_login text, _ip_hash text) RETURNS integer
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  WITH f AS (
    SELECT max(created_at) AS last,
      count(*) FILTER (WHERE login = _login) AS by_login,
      count(*) FILTER (WHERE ip_hash = _ip_hash) AS by_ip
    FROM public.access_login_attempts
    WHERE NOT success AND created_at > now() - interval '15 minutes' AND (login = _login OR ip_hash = _ip_hash)
  )
  SELECT CASE WHEN by_login >= 5 OR by_ip >= 20
    THEN greatest(0, ceil(extract(epoch FROM (last + interval '15 minutes' - now()))))::int ELSE 0 END FROM f
$$;
REVOKE ALL ON FUNCTION public.access_login_lock(text,text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.access_login_lock(text,text) TO service_role;

DROP POLICY "public read" ON public.banners;
CREATE POLICY "public read" ON public.banners FOR SELECT TO authenticated USING (is_active AND (SELECT public.has_site_access(auth.uid())));
DROP POLICY "public read" ON public.categories;
CREATE POLICY "public read" ON public.categories FOR SELECT TO authenticated USING (status = 'published' AND (SELECT public.has_site_access(auth.uid())));
DROP POLICY "public read" ON public.channels;
CREATE POLICY "public read" ON public.channels FOR SELECT TO authenticated USING (status = 'published' AND (SELECT public.has_site_access(auth.uid())));
DROP POLICY "public read" ON public.episodes;
CREATE POLICY "public read" ON public.episodes FOR SELECT TO authenticated USING (status = 'published' AND (SELECT public.has_site_access(auth.uid())));
DROP POLICY "public read" ON public.genres;
CREATE POLICY "public read" ON public.genres FOR SELECT TO authenticated USING ((SELECT public.has_site_access(auth.uid())));
DROP POLICY "home_public_read" ON public.home_layouts;
CREATE POLICY "home_public_read" ON public.home_layouts FOR SELECT TO authenticated USING (id = 'published' AND (SELECT public.has_site_access(auth.uid())));
DROP POLICY "movie_categories_read" ON public.movie_categories;
CREATE POLICY "movie_categories_read" ON public.movie_categories FOR SELECT TO authenticated USING ((SELECT public.has_site_access(auth.uid())) AND (public.is_staff(auth.uid()) OR EXISTS (SELECT 1 FROM public.movies m WHERE m.id = movie_categories.movie_id AND m.status = 'published')));
DROP POLICY "public read" ON public.movie_genres;
CREATE POLICY "public read" ON public.movie_genres FOR SELECT TO authenticated USING ((SELECT public.has_site_access(auth.uid())));
DROP POLICY "public read" ON public.movies;
CREATE POLICY "public read" ON public.movies FOR SELECT TO authenticated USING (status = 'published' AND (SELECT public.has_site_access(auth.uid())));
DROP POLICY "public read" ON public.seasons;
CREATE POLICY "public read" ON public.seasons FOR SELECT TO authenticated USING ((SELECT public.has_site_access(auth.uid())) AND EXISTS (SELECT 1 FROM public.series s WHERE s.id = seasons.series_id AND s.status = 'published'));
DROP POLICY "public read" ON public.series;
CREATE POLICY "public read" ON public.series FOR SELECT TO authenticated USING (status = 'published' AND (SELECT public.has_site_access(auth.uid())));
DROP POLICY "series_categories_read" ON public.series_categories;
CREATE POLICY "series_categories_read" ON public.series_categories FOR SELECT TO authenticated USING ((SELECT public.has_site_access(auth.uid())) AND (public.is_staff(auth.uid()) OR EXISTS (SELECT 1 FROM public.series s WHERE s.id = series_categories.series_id AND s.status = 'published')));
DROP POLICY "public read" ON public.series_genres;
CREATE POLICY "public read" ON public.series_genres FOR SELECT TO authenticated USING ((SELECT public.has_site_access(auth.uid())));

CREATE OR REPLACE FUNCTION public.get_playback_source(_kind content_kind, _content_id uuid)
 RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $function$
DECLARE src public.playback_sources; ok boolean;
BEGIN
IF auth.uid() IS NULL OR NOT EXISTS(SELECT 1 FROM public.profiles WHERE id=auth.uid() AND status='active') OR NOT public.has_site_access(auth.uid()) THEN RAISE EXCEPTION 'Reprodução não autorizada'; END IF;
ok := CASE _kind WHEN 'movie' THEN EXISTS(SELECT 1 FROM public.movies WHERE id=_content_id AND status='published') WHEN 'channel' THEN EXISTS(SELECT 1 FROM public.channels WHERE id=_content_id AND status='published') WHEN 'episode' THEN EXISTS(SELECT 1 FROM public.episodes e JOIN public.seasons se ON se.id=e.season_id JOIN public.series s ON s.id=se.series_id WHERE e.id=_content_id AND e.status='published' AND s.status='published') ELSE false END;
IF NOT ok AND NOT public.is_staff(auth.uid()) THEN RETURN NULL; END IF;
SELECT * INTO src FROM public.playback_sources WHERE content_kind=_kind AND content_id=_content_id AND is_active AND (source_type<>'embed' OR public.embed_url_allowed(url)) ORDER BY is_primary DESC,sort_order,created_at DESC LIMIT 1;
IF src.id IS NULL THEN RETURN NULL; END IF;
RETURN jsonb_build_object('id',src.id,'url',src.url,'type',src.source_type,'quality',src.quality);
END $function$;

CREATE OR REPLACE FUNCTION public.get_playback_sources(_kind content_kind, _content_id uuid)
 RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $function$
DECLARE ok boolean; r jsonb;
BEGIN
IF auth.uid() IS NULL OR NOT EXISTS(SELECT 1 FROM public.profiles WHERE id=auth.uid() AND status='active') OR NOT public.has_site_access(auth.uid()) THEN RAISE EXCEPTION 'Reprodução não autorizada'; END IF;
ok := CASE _kind WHEN 'movie' THEN EXISTS(SELECT 1 FROM public.movies WHERE id=_content_id AND status='published') WHEN 'channel' THEN EXISTS(SELECT 1 FROM public.channels WHERE id=_content_id AND status='published') WHEN 'episode' THEN EXISTS(SELECT 1 FROM public.episodes e JOIN public.seasons se ON se.id=e.season_id JOIN public.series s ON s.id=se.series_id WHERE e.id=_content_id AND e.status='published' AND s.status='published') ELSE false END;
IF NOT ok AND NOT public.is_staff(auth.uid()) THEN RETURN '[]'::jsonb; END IF;
SELECT coalesce(jsonb_agg(jsonb_build_object('id',id,'url',url,'type',source_type,'quality',quality,'label',label) ORDER BY is_primary DESC, sort_order, created_at),'[]'::jsonb) INTO r
FROM public.playback_sources WHERE content_kind=_kind AND content_id=_content_id AND is_active AND (source_type<>'embed' OR public.embed_url_allowed(url));
RETURN r;
END $function$;