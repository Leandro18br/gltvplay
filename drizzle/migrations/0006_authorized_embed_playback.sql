ALTER TABLE public.playback_sources ADD COLUMN source_type text NOT NULL DEFAULT 'url', ADD COLUMN is_primary boolean NOT NULL DEFAULT true, ADD COLUMN sort_order integer NOT NULL DEFAULT 0;
ALTER TABLE public.playback_sources ADD CONSTRAINT playback_source_type CHECK(source_type IN ('url','embed','hls'));
ALTER TABLE public.site_settings ADD COLUMN embed_allow_iframe boolean NOT NULL DEFAULT false;
CREATE TABLE public.embed_domains (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), hostname text NOT NULL UNIQUE CHECK (char_length(hostname) <= 253 AND hostname ~ '^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$' AND hostname !~ '(^|\.)(localhost|local|internal|test|invalid)$' AND hostname !~ '^[0-9.]+$'), created_at timestamptz NOT NULL DEFAULT now());
GRANT SELECT,INSERT,UPDATE,DELETE ON public.embed_domains TO authenticated;
GRANT ALL ON public.embed_domains TO service_role;
ALTER TABLE public.embed_domains ENABLE ROW LEVEL SECURITY;
CREATE POLICY staff_read ON public.embed_domains FOR SELECT TO authenticated USING(public.is_staff(auth.uid()));
CREATE POLICY admin_write ON public.embed_domains FOR ALL TO authenticated USING(public.is_admin(auth.uid())) WITH CHECK(public.is_admin(auth.uid()));
CREATE TRIGGER embed_domain_audit AFTER INSERT OR UPDATE OR DELETE ON public.embed_domains FOR EACH ROW EXECUTE FUNCTION public.audit_trigger();
CREATE TABLE public.playback_diagnostics (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), actor_id uuid NOT NULL REFERENCES public.profiles(id), source_id uuid REFERENCES public.playback_sources(id) ON DELETE SET NULL, event text NOT NULL CHECK(event IN ('timeout','frame_error','user_report')), created_at timestamptz NOT NULL DEFAULT now());
GRANT SELECT ON public.playback_diagnostics TO authenticated;
GRANT ALL ON public.playback_diagnostics TO service_role;
ALTER TABLE public.playback_diagnostics ENABLE ROW LEVEL SECURITY;
CREATE POLICY admin_read ON public.playback_diagnostics FOR SELECT TO authenticated USING(public.is_admin(auth.uid()));
CREATE INDEX ON public.playback_diagnostics(actor_id,created_at);
CREATE FUNCTION public.embed_url_allowed(u text) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
SELECT char_length(u) <= 2048 AND u ~ '^https://[a-z0-9.-]+(/[^[:space:]<>]*)?$' AND EXISTS(SELECT 1 FROM public.embed_domains WHERE hostname = split_part(split_part(u,'://',2),'/',1));
$$;
REVOKE ALL ON FUNCTION public.embed_url_allowed(text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.embed_url_allowed(text) TO authenticated;
CREATE FUNCTION public.guard_embed_source() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$ BEGIN
IF NEW.source_type = 'embed' AND NOT public.embed_url_allowed(NEW.url) THEN RAISE EXCEPTION 'Domínio de embed não autorizado ou URL inválida'; END IF;
IF NEW.content_kind = 'series' THEN RAISE EXCEPTION 'Configure a reprodução por episódio'; END IF;
RETURN NEW; END $$;
CREATE TRIGGER embed_source_validation BEFORE INSERT OR UPDATE ON public.playback_sources FOR EACH ROW EXECUTE FUNCTION public.guard_embed_source();
CREATE FUNCTION public.get_playback_source(_kind public.content_kind,_content_id uuid) RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public AS $$
DECLARE src public.playback_sources; ok boolean;
BEGIN
IF auth.uid() IS NULL OR NOT EXISTS(SELECT 1 FROM public.profiles WHERE id=auth.uid() AND status='active') THEN RAISE EXCEPTION 'Reprodução não autorizada'; END IF;
ok := CASE _kind WHEN 'movie' THEN EXISTS(SELECT 1 FROM public.movies WHERE id=_content_id AND status='published') WHEN 'channel' THEN EXISTS(SELECT 1 FROM public.channels WHERE id=_content_id AND status='published') WHEN 'episode' THEN EXISTS(SELECT 1 FROM public.episodes e JOIN public.seasons se ON se.id=e.season_id JOIN public.series s ON s.id=se.series_id WHERE e.id=_content_id AND e.status='published' AND s.status='published') ELSE false END;
IF NOT ok AND NOT public.is_staff(auth.uid()) THEN RETURN NULL; END IF;
SELECT * INTO src FROM public.playback_sources WHERE content_kind=_kind AND content_id=_content_id AND is_active AND (source_type<>'embed' OR public.embed_url_allowed(url)) ORDER BY is_primary DESC,sort_order,created_at DESC LIMIT 1;
IF src.id IS NULL THEN RETURN NULL; END IF;
RETURN jsonb_build_object('id',src.id,'url',src.url,'type',src.source_type,'quality',src.quality);
END $$;
REVOKE ALL ON FUNCTION public.get_playback_source(public.content_kind,uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.get_playback_source(public.content_kind,uuid) TO authenticated;
CREATE OR REPLACE FUNCTION public.get_playback_url(_kind public.content_kind,_content_id uuid) RETURNS text LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public AS $$ DECLARE s jsonb; BEGIN s := public.get_playback_source(_kind,_content_id); IF s->>'type'='embed' THEN RETURN NULL; END IF; RETURN s->>'url'; END $$;
CREATE FUNCTION public.report_playback_error(_source_id uuid,_event text) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$ DECLARE s public.playback_sources; p jsonb; BEGIN
IF auth.uid() IS NULL OR _event NOT IN ('timeout','frame_error','user_report') THEN RAISE EXCEPTION 'Invalid report'; END IF;
IF (SELECT count(*) FROM public.playback_diagnostics WHERE actor_id=auth.uid() AND created_at>now()-interval '1 minute') >= 10 THEN RAISE EXCEPTION 'Too many reports'; END IF;
SELECT * INTO s FROM public.playback_sources WHERE id=_source_id;
IF s.id IS NULL THEN RAISE EXCEPTION 'Invalid source'; END IF;
p := public.get_playback_source(s.content_kind,s.content_id);
IF p IS NULL OR p->>'id'<>_source_id::text THEN RAISE EXCEPTION 'Access denied'; END IF;
INSERT INTO public.playback_diagnostics(actor_id,source_id,event) VALUES(auth.uid(),_source_id,_event);
END $$;
REVOKE ALL ON FUNCTION public.report_playback_error(uuid,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.report_playback_error(uuid,text) TO authenticated;
CREATE FUNCTION public.set_primary_playback(_source_id uuid) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$ DECLARE s public.playback_sources; BEGIN
IF NOT public.is_staff(auth.uid()) THEN RAISE EXCEPTION 'Access denied'; END IF;
SELECT * INTO s FROM public.playback_sources WHERE id=_source_id FOR UPDATE;
IF s.id IS NULL THEN RAISE EXCEPTION 'Source unavailable'; END IF;
PERFORM pg_advisory_xact_lock(hashtext(s.content_kind::text || s.content_id::text));
UPDATE public.playback_sources SET is_primary=(id=_source_id) WHERE content_kind=s.content_kind AND content_id=s.content_id AND is_primary IS DISTINCT FROM (id=_source_id);
END $$;
REVOKE ALL ON FUNCTION public.set_primary_playback(uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.set_primary_playback(uuid) TO authenticated;