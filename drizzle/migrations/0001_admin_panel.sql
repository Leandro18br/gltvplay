CREATE TABLE public.banners (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title text NOT NULL,
  subtitle text,
  image_url text,
  button_label text,
  button_url text,
  content_kind public.content_kind,
  content_id uuid,
  sort_order int NOT NULL DEFAULT 0,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.banners TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.banners TO authenticated;
GRANT ALL ON public.banners TO service_role;
ALTER TABLE public.banners ENABLE ROW LEVEL SECURITY;
CREATE POLICY "public read" ON public.banners FOR SELECT TO anon, authenticated USING (is_active);
CREATE POLICY "staff manage" ON public.banners FOR ALL TO authenticated USING (public.is_staff(auth.uid())) WITH CHECK (public.is_staff(auth.uid()));
CREATE TRIGGER t1 BEFORE UPDATE ON public.banners FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
CREATE TRIGGER audit AFTER INSERT OR UPDATE OR DELETE ON public.banners FOR EACH ROW EXECUTE FUNCTION public.audit_trigger();
CREATE TRIGGER audit AFTER UPDATE ON public.profiles FOR EACH ROW EXECUTE FUNCTION public.audit_trigger();

CREATE UNIQUE INDEX movies_external_uq ON public.movies(external_source, external_id);
CREATE UNIQUE INDEX series_external_uq ON public.series(external_source, external_id);

CREATE POLICY "staff read history" ON public.watch_history FOR SELECT TO authenticated USING (public.is_staff(auth.uid()));

CREATE OR REPLACE FUNCTION public.admin_stats() RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE r jsonb;
BEGIN
  IF NOT public.is_staff(auth.uid()) THEN RAISE EXCEPTION 'forbidden'; END IF;
  SELECT jsonb_build_object(
    'movies', (SELECT count(*) FROM movies),
    'series', (SELECT count(*) FROM series),
    'episodes', (SELECT count(*) FROM episodes),
    'channels', (SELECT count(*) FROM channels),
    'users', (SELECT count(*) FROM profiles),
    'published', (SELECT (SELECT count(*) FROM movies WHERE status='published')+(SELECT count(*) FROM series WHERE status='published')+(SELECT count(*) FROM episodes WHERE status='published')+(SELECT count(*) FROM channels WHERE status='published')),
    'pending', (SELECT (SELECT count(*) FROM movies WHERE status='draft')+(SELECT count(*) FROM series WHERE status='draft')+(SELECT count(*) FROM episodes WHERE status='draft')+(SELECT count(*) FROM channels WHERE status='draft')),
    'featured', (SELECT (SELECT count(*) FROM movies WHERE featured)+(SELECT count(*) FROM series WHERE featured)+(SELECT count(*) FROM channels WHERE featured)),
    'views', (SELECT count(*) FROM watch_history),
    'active_users', (SELECT count(DISTINCT user_id) FROM watch_history WHERE watched_at > now() - interval '30 days'),
    'views_by_day', (SELECT coalesce(jsonb_agg(jsonb_build_object('day', to_char(d,'DD/MM'), 'views', (SELECT count(*) FROM watch_history w WHERE w.watched_at::date = d::date)) ORDER BY d), '[]'::jsonb)
                     FROM generate_series(current_date - 13, current_date, interval '1 day') d),
    'by_kind', jsonb_build_array(
       jsonb_build_object('name','Filmes','value',(SELECT count(*) FROM movies)),
       jsonb_build_object('name','Séries','value',(SELECT count(*) FROM series)),
       jsonb_build_object('name','Canais','value',(SELECT count(*) FROM channels)))
  ) INTO r;
  RETURN r;
END; $$;
REVOKE EXECUTE ON FUNCTION public.admin_stats FROM anon, public;
GRANT EXECUTE ON FUNCTION public.admin_stats TO authenticated;

CREATE OR REPLACE FUNCTION public.admin_set_role(_user_id uuid, _role public.app_role, _enabled boolean) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT public.has_role(auth.uid(),'admin') THEN RAISE EXCEPTION 'forbidden'; END IF;
  IF _user_id = auth.uid() AND _role = 'admin' AND NOT _enabled THEN RAISE EXCEPTION 'cannot remove your own admin role'; END IF;
  IF _enabled THEN
    INSERT INTO user_roles(user_id, role) VALUES (_user_id, _role) ON CONFLICT DO NOTHING;
  ELSE
    DELETE FROM user_roles WHERE user_id = _user_id AND role = _role;
  END IF;
END; $$;
REVOKE EXECUTE ON FUNCTION public.admin_set_role FROM anon, public;
GRANT EXECUTE ON FUNCTION public.admin_set_role TO authenticated;