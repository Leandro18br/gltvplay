CREATE TABLE public.home_layouts (
 id text PRIMARY KEY DEFAULT 'draft',
 config jsonb NOT NULL DEFAULT '{"sections":[],"banners":[],"bannerMode":"manual","bannerLimit":5}'::jsonb,
 revision integer NOT NULL DEFAULT 1,
 updated_at timestamptz NOT NULL DEFAULT now(),
 updated_by uuid,
 CONSTRAINT home_layout_state CHECK (id IN ('draft','published'))
);
GRANT SELECT ON public.home_layouts TO anon, authenticated;
GRANT ALL ON public.home_layouts TO service_role;
ALTER TABLE public.home_layouts ENABLE ROW LEVEL SECURITY;
CREATE POLICY home_public_read ON public.home_layouts FOR SELECT TO anon, authenticated USING (id = 'published');
CREATE POLICY home_staff_read ON public.home_layouts FOR SELECT TO authenticated USING (public.is_staff(auth.uid()));

CREATE FUNCTION public.validate_home_config(c jsonb) RETURNS void LANGUAGE plpgsql SET search_path = public AS $$
DECLARE s jsonb; b jsonb; r jsonb;
BEGIN
 IF jsonb_typeof(c) IS DISTINCT FROM 'object' OR jsonb_typeof(c->'sections') IS DISTINCT FROM 'array' OR jsonb_typeof(c->'banners') IS DISTINCT FROM 'array' OR octet_length(c::text) > 524288 THEN RAISE EXCEPTION 'Invalid Home configuration'; END IF;
 IF jsonb_array_length(c->'sections') > 60 OR jsonb_array_length(c->'banners') > 30 OR c->>'bannerMode' NOT IN ('manual','automatic') OR (c->>'bannerLimit')::int NOT BETWEEN 1 AND 30 THEN RAISE EXCEPTION 'Invalid Home limits'; END IF;
 FOR s IN SELECT value FROM jsonb_array_elements(c->'sections') LOOP
  IF length(s->>'title') NOT BETWEEN 1 AND 120 OR s->>'type' NOT IN ('hero','movies','series','mixed','channels','categories','continue','popular','releases','featured','manual','watchlist') OR s->>'mode' NOT IN ('manual','automatic') OR (s->>'limit')::int NOT BETWEEN 1 AND 100 OR jsonb_typeof(s->'active') IS DISTINCT FROM 'boolean' OR jsonb_typeof(s->'showAll') IS DISTINCT FROM 'boolean' OR jsonb_typeof(s->'items') IS DISTINCT FROM 'array' OR jsonb_array_length(s->'items') > 100 THEN RAISE EXCEPTION 'Invalid Home section'; END IF;
  IF s->'filters'->>'sort' NOT IN ('recent','updated','popular','year','featured') THEN RAISE EXCEPTION 'Invalid Home sorting'; END IF;
  FOR r IN SELECT value FROM jsonb_array_elements(s->'items') LOOP
   IF r->>'kind' NOT IN ('movie','series','channel','category') OR r->>'id' !~ '^[0-9a-fA-F-]{36}$' THEN RAISE EXCEPTION 'Invalid Home content reference'; END IF;
  END LOOP;
 END LOOP;
 FOR b IN SELECT value FROM jsonb_array_elements(c->'banners') LOOP
  IF length(b->>'title') NOT BETWEEN 1 AND 120 OR jsonb_typeof(b->'active') IS DISTINCT FROM 'boolean' OR coalesce(b->>'desktop','') !~ '^(https://|$)' OR coalesce(b->>'mobile','') !~ '^(https://|$)' THEN RAISE EXCEPTION 'Invalid Home banner'; END IF;
 END LOOP;
END; $$;

CREATE FUNCTION public.save_home_draft(c jsonb, expected_revision integer) RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE rev integer;
BEGIN
 IF auth.uid() IS NULL OR NOT public.is_staff(auth.uid()) THEN RAISE EXCEPTION 'Forbidden'; END IF;
 PERFORM public.validate_home_config(c);
 UPDATE public.home_layouts SET config=c, revision=revision+1, updated_at=now(), updated_by=auth.uid() WHERE id='draft' AND revision=expected_revision RETURNING revision INTO rev;
 IF rev IS NULL THEN RAISE EXCEPTION 'Home draft changed in another session; reload before saving'; END IF;
 RETURN rev;
END; $$;
REVOKE ALL ON FUNCTION public.save_home_draft(jsonb,integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.save_home_draft(jsonb,integer) TO authenticated;

CREATE FUNCTION public.publish_home_draft(expected_revision integer) RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE c jsonb; rev integer;
BEGIN
 IF auth.uid() IS NULL OR NOT public.is_staff(auth.uid()) THEN RAISE EXCEPTION 'Forbidden'; END IF;
 SELECT config,revision INTO c,rev FROM public.home_layouts WHERE id='draft' FOR UPDATE;
 IF rev IS DISTINCT FROM expected_revision THEN RAISE EXCEPTION 'Home draft changed in another session; reload before publishing'; END IF;
 PERFORM public.validate_home_config(c);
 UPDATE public.home_layouts SET config=c, revision=revision+1, updated_at=now(), updated_by=auth.uid() WHERE id='published';
 RETURN rev;
END; $$;
REVOKE ALL ON FUNCTION public.publish_home_draft(integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.publish_home_draft(integer) TO authenticated;

-- Preserve the currently configured catalog/banners as an additive migration backfill.
INSERT INTO public.home_layouts(id,config)
SELECT state, jsonb_build_object(
 'bannerMode',CASE WHEN EXISTS(SELECT 1 FROM public.banners WHERE is_active) THEN 'manual' ELSE 'automatic' END,
 'bannerLimit',5,
 'banners',coalesce((SELECT jsonb_agg(jsonb_build_object('id',id::text,'title',title,'subtitle',coalesce(subtitle,''),'description','','desktop',coalesce(image_url,''),'mobile','','active',is_active,'watch',true,'info',true,'cta',coalesce(button_label,'Assistir'),'href',coalesce(button_url,''),'content',CASE WHEN content_id IS NOT NULL THEN jsonb_build_object('id',content_id,'kind',content_kind) ELSE NULL END) ORDER BY sort_order,created_at) FROM public.banners),'[]'::jsonb),
 'sections',(SELECT jsonb_agg(jsonb_build_object('id',type,'title',title,'type',type,'mode','automatic','limit',20,'active',true,'showAll',show_all,'items','[]'::jsonb,'filters',jsonb_build_object('sort',sort)) ORDER BY ord) FROM (VALUES
 (1,'hero','Banner principal','featured',false),(2,'continue','Continue assistindo','recent',false),(3,'movies','Filmes em destaque','featured',true),(4,'series','Séries em destaque','featured',true),(5,'releases','Lançamentos','year',false),(6,'popular','Mais assistidos','popular',false),(7,'channels','Canais ao vivo','recent',true),(8,'watchlist','Minha lista','recent',true)) AS v(ord,type,title,sort,show_all))
) FROM (VALUES('draft'),('published')) AS states(state);

CREATE TRIGGER home_layout_updated AFTER UPDATE ON public.home_layouts FOR EACH ROW EXECUTE FUNCTION public.audit_trigger();
ALTER PUBLICATION supabase_realtime ADD TABLE public.home_layouts;
