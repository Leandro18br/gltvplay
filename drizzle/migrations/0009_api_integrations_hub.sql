CREATE TABLE public.api_integrations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL CHECK (char_length(name) BETWEEN 1 AND 120),
  description text CHECK (description IS NULL OR char_length(description) <= 1000),
  kind text NOT NULL CHECK (kind IN ('catalog','movie_player','episode_player')),
  base_url text NOT NULL CHECK (char_length(base_url) <= 500 AND base_url ~ '^https://[a-z0-9.-]+(:[0-9]+)?(/[^[:space:]<>]*)?$'),
  auth_method text NOT NULL DEFAULT 'none' CHECK (auth_method IN ('none','query_key','header_key','bearer','custom_header')),
  auth_param text CHECK (auth_param IS NULL OR auth_param ~ '^[A-Za-z0-9_.-]{1,80}$'),
  headers jsonb NOT NULL DEFAULT '{}'::jsonb,
  params jsonb NOT NULL DEFAULT '{}'::jsonb,
  default_method text NOT NULL DEFAULT 'GET' CHECK (default_method IN ('GET','POST')),
  priority integer NOT NULL DEFAULT 1 CHECK (priority BETWEEN 1 AND 100),
  is_active boolean NOT NULL DEFAULT true,
  rate_limit_per_minute integer NOT NULL DEFAULT 30 CHECK (rate_limit_per_minute BETWEEN 1 AND 600),
  cache_ttl_seconds integer NOT NULL DEFAULT 3600 CHECK (cache_ttl_seconds IN (0,300,900,3600,21600,86400,604800)),
  auto_fetch_player boolean NOT NULL DEFAULT false,
  key_hint text,
  token_hint text,
  last_tested_at timestamptz,
  last_status text NOT NULL DEFAULT 'never' CHECK (last_status IN ('never','ok','error')),
  last_error text,
  request_count bigint NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.api_integrations TO authenticated;
GRANT ALL ON public.api_integrations TO service_role;
ALTER TABLE public.api_integrations ENABLE ROW LEVEL SECURITY;
CREATE POLICY "staff read integrations" ON public.api_integrations FOR SELECT TO authenticated USING (public.is_staff(auth.uid()));
CREATE POLICY "admin insert integrations" ON public.api_integrations FOR INSERT TO authenticated WITH CHECK (public.is_admin(auth.uid()));
CREATE POLICY "admin update integrations" ON public.api_integrations FOR UPDATE TO authenticated USING (public.is_admin(auth.uid())) WITH CHECK (public.is_admin(auth.uid()));
CREATE POLICY "admin delete integrations" ON public.api_integrations FOR DELETE TO authenticated USING (public.is_admin(auth.uid()));
CREATE TRIGGER t1 BEFORE UPDATE ON public.api_integrations FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
CREATE TRIGGER audit AFTER INSERT OR UPDATE OF name,description,kind,base_url,auth_method,auth_param,headers,params,default_method,priority,is_active,rate_limit_per_minute,cache_ttl_seconds,auto_fetch_player OR DELETE ON public.api_integrations FOR EACH ROW EXECUTE FUNCTION public.audit_trigger();

-- Secrets: no grants to browser roles; only the server (service role) reads them after an admin check.
CREATE TABLE public.api_credentials (
  integration_id uuid PRIMARY KEY REFERENCES public.api_integrations(id) ON DELETE CASCADE,
  api_key text,
  token text,
  updated_at timestamptz NOT NULL DEFAULT now()
);
REVOKE ALL ON public.api_credentials FROM anon, authenticated;
GRANT ALL ON public.api_credentials TO service_role;
ALTER TABLE public.api_credentials ENABLE ROW LEVEL SECURITY;

CREATE TABLE public.api_endpoints (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  integration_id uuid NOT NULL REFERENCES public.api_integrations(id) ON DELETE CASCADE,
  name text NOT NULL CHECK (char_length(name) BETWEEN 1 AND 120),
  description text CHECK (description IS NULL OR char_length(description) <= 1000),
  kind text NOT NULL CHECK (kind IN ('search_movies','search_series','movie_by_id','series_by_id','movie_player','episode_player','seasons','episodes')),
  method text NOT NULL DEFAULT 'GET' CHECK (method IN ('GET','POST')),
  path text NOT NULL DEFAULT '' CHECK (char_length(path) <= 500 AND path !~ '://' AND path !~ '^//'),
  headers jsonb NOT NULL DEFAULT '{}'::jsonb,
  query jsonb NOT NULL DEFAULT '{}'::jsonb,
  body text CHECK (body IS NULL OR char_length(body) <= 5000),
  mapping jsonb NOT NULL DEFAULT '{}'::jsonb,
  is_active boolean NOT NULL DEFAULT true,
  sort_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX api_endpoints_integration_idx ON public.api_endpoints(integration_id, kind);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.api_endpoints TO authenticated;
GRANT ALL ON public.api_endpoints TO service_role;
ALTER TABLE public.api_endpoints ENABLE ROW LEVEL SECURITY;
CREATE POLICY "staff read endpoints" ON public.api_endpoints FOR SELECT TO authenticated USING (public.is_staff(auth.uid()));
CREATE POLICY "admin insert endpoints" ON public.api_endpoints FOR INSERT TO authenticated WITH CHECK (public.is_admin(auth.uid()));
CREATE POLICY "admin update endpoints" ON public.api_endpoints FOR UPDATE TO authenticated USING (public.is_admin(auth.uid())) WITH CHECK (public.is_admin(auth.uid()));
CREATE POLICY "admin delete endpoints" ON public.api_endpoints FOR DELETE TO authenticated USING (public.is_admin(auth.uid()));
CREATE TRIGGER t1 BEFORE UPDATE ON public.api_endpoints FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
CREATE TRIGGER audit AFTER INSERT OR UPDATE OR DELETE ON public.api_endpoints FOR EACH ROW EXECUTE FUNCTION public.audit_trigger();

CREATE TABLE public.api_request_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  integration_id uuid REFERENCES public.api_integrations(id) ON DELETE CASCADE,
  endpoint_id uuid REFERENCES public.api_endpoints(id) ON DELETE SET NULL,
  actor_id uuid,
  content_label text,
  http_status integer,
  duration_ms integer,
  success boolean NOT NULL DEFAULT false,
  cached boolean NOT NULL DEFAULT false,
  error text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX api_request_logs_recent_idx ON public.api_request_logs(integration_id, created_at DESC);
GRANT SELECT ON public.api_request_logs TO authenticated;
GRANT ALL ON public.api_request_logs TO service_role;
ALTER TABLE public.api_request_logs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "admin read api logs" ON public.api_request_logs FOR SELECT TO authenticated USING (public.is_admin(auth.uid()));

CREATE TABLE public.api_response_cache (
  cache_key text PRIMARY KEY,
  integration_id uuid NOT NULL REFERENCES public.api_integrations(id) ON DELETE CASCADE,
  http_status integer NOT NULL,
  body text NOT NULL,
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
REVOKE ALL ON public.api_response_cache FROM anon, authenticated;
GRANT ALL ON public.api_response_cache TO service_role;
ALTER TABLE public.api_response_cache ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.playback_sources ADD COLUMN label text CHECK (label IS NULL OR char_length(label) <= 60);
ALTER TABLE public.playback_sources ADD COLUMN api_integration_id uuid REFERENCES public.api_integrations(id) ON DELETE SET NULL;
ALTER TABLE public.playback_sources ADD COLUMN external_ref text CHECK (external_ref IS NULL OR char_length(external_ref) <= 200);

CREATE OR REPLACE FUNCTION public.get_playback_sources(_kind content_kind, _content_id uuid)
 RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE ok boolean; r jsonb;
BEGIN
IF auth.uid() IS NULL OR NOT EXISTS(SELECT 1 FROM public.profiles WHERE id=auth.uid() AND status='active') THEN RAISE EXCEPTION 'Reprodução não autorizada'; END IF;
ok := CASE _kind WHEN 'movie' THEN EXISTS(SELECT 1 FROM public.movies WHERE id=_content_id AND status='published') WHEN 'channel' THEN EXISTS(SELECT 1 FROM public.channels WHERE id=_content_id AND status='published') WHEN 'episode' THEN EXISTS(SELECT 1 FROM public.episodes e JOIN public.seasons se ON se.id=e.season_id JOIN public.series s ON s.id=se.series_id WHERE e.id=_content_id AND e.status='published' AND s.status='published') ELSE false END;
IF NOT ok AND NOT public.is_staff(auth.uid()) THEN RETURN '[]'::jsonb; END IF;
SELECT coalesce(jsonb_agg(jsonb_build_object('id',id,'url',url,'type',source_type,'quality',quality,'label',label) ORDER BY is_primary DESC, sort_order, created_at),'[]'::jsonb) INTO r
FROM public.playback_sources WHERE content_kind=_kind AND content_id=_content_id AND is_active AND (source_type<>'embed' OR public.embed_url_allowed(url));
RETURN r;
END $$;
REVOKE EXECUTE ON FUNCTION public.get_playback_sources(content_kind, uuid) FROM anon;

CREATE OR REPLACE FUNCTION public.report_playback_error(_source_id uuid, _event text)
 RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$ DECLARE s public.playback_sources; BEGIN
IF auth.uid() IS NULL OR _event NOT IN ('timeout','frame_error','user_report') THEN RAISE EXCEPTION 'Invalid report'; END IF;
IF (SELECT count(*) FROM public.playback_diagnostics WHERE actor_id=auth.uid() AND created_at>now()-interval '1 minute') >= 10 THEN RAISE EXCEPTION 'Too many reports'; END IF;
SELECT * INTO s FROM public.playback_sources WHERE id=_source_id;
IF s.id IS NULL THEN RAISE EXCEPTION 'Invalid source'; END IF;
IF NOT EXISTS (SELECT 1 FROM jsonb_array_elements(public.get_playback_sources(s.content_kind,s.content_id)) x WHERE x->>'id'=_source_id::text) THEN RAISE EXCEPTION 'Access denied'; END IF;
INSERT INTO public.playback_diagnostics(actor_id,source_id,event) VALUES(auth.uid(),_source_id,_event);
END $$;