CREATE TABLE public.movie_categories (movie_id uuid NOT NULL REFERENCES public.movies(id) ON DELETE CASCADE, category_id uuid NOT NULL REFERENCES public.categories(id) ON DELETE CASCADE, PRIMARY KEY(movie_id,category_id));
GRANT SELECT ON public.movie_categories TO anon; GRANT SELECT,INSERT,UPDATE,DELETE ON public.movie_categories TO authenticated; GRANT ALL ON public.movie_categories TO service_role;
ALTER TABLE public.movie_categories ENABLE ROW LEVEL SECURITY;
CREATE POLICY movie_categories_read ON public.movie_categories FOR SELECT TO anon,authenticated USING (EXISTS(SELECT 1 FROM public.movies m WHERE m.id=movie_id AND m.status='published') OR public.is_staff(auth.uid()));
CREATE POLICY movie_categories_staff ON public.movie_categories FOR ALL TO authenticated USING(public.is_staff(auth.uid())) WITH CHECK(public.is_staff(auth.uid()));
CREATE TABLE public.series_categories (series_id uuid NOT NULL REFERENCES public.series(id) ON DELETE CASCADE, category_id uuid NOT NULL REFERENCES public.categories(id) ON DELETE CASCADE, PRIMARY KEY(series_id,category_id));
GRANT SELECT ON public.series_categories TO anon; GRANT SELECT,INSERT,UPDATE,DELETE ON public.series_categories TO authenticated; GRANT ALL ON public.series_categories TO service_role;
ALTER TABLE public.series_categories ENABLE ROW LEVEL SECURITY;
CREATE POLICY series_categories_read ON public.series_categories FOR SELECT TO anon,authenticated USING (EXISTS(SELECT 1 FROM public.series s WHERE s.id=series_id AND s.status='published') OR public.is_staff(auth.uid()));
CREATE POLICY series_categories_staff ON public.series_categories FOR ALL TO authenticated USING(public.is_staff(auth.uid())) WITH CHECK(public.is_staff(auth.uid()));
INSERT INTO public.movie_categories SELECT id,category_id FROM public.movies WHERE category_id IS NOT NULL ON CONFLICT DO NOTHING;
INSERT INTO public.series_categories SELECT id,category_id FROM public.series WHERE category_id IS NOT NULL ON CONFLICT DO NOTHING;
CREATE OR REPLACE FUNCTION public.attach_catalog_categories() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE default_id uuid;
BEGIN
 IF TG_TABLE_NAME='movies' THEN
  SELECT id INTO default_id FROM public.categories WHERE slug='filmes-recomendo';
  IF NEW.category_id IS NOT NULL THEN INSERT INTO public.movie_categories VALUES(NEW.id,NEW.category_id) ON CONFLICT DO NOTHING; END IF;
  IF default_id IS NOT NULL THEN INSERT INTO public.movie_categories VALUES(NEW.id,default_id) ON CONFLICT DO NOTHING; END IF;
 ELSE
  SELECT id INTO default_id FROM public.categories WHERE slug='series-em-destaques';
  IF NEW.category_id IS NOT NULL THEN INSERT INTO public.series_categories VALUES(NEW.id,NEW.category_id) ON CONFLICT DO NOTHING; END IF;
  IF default_id IS NOT NULL THEN INSERT INTO public.series_categories VALUES(NEW.id,default_id) ON CONFLICT DO NOTHING; END IF;
 END IF;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.attach_catalog_categories() FROM PUBLIC,anon,authenticated;
CREATE TRIGGER catalog_categories_movies AFTER INSERT OR UPDATE OF category_id ON public.movies FOR EACH ROW EXECUTE FUNCTION public.attach_catalog_categories();
CREATE TRIGGER catalog_categories_series AFTER INSERT OR UPDATE OF category_id ON public.series FOR EACH ROW EXECUTE FUNCTION public.attach_catalog_categories();
CREATE TABLE public.tmdb_catalog_jobs (id uuid PRIMARY KEY DEFAULT gen_random_uuid(),year integer NOT NULL DEFAULT 2026,phase text NOT NULL DEFAULT 'discover',segments jsonb NOT NULL DEFAULT '[]',segment_index integer NOT NULL DEFAULT 0,page integer NOT NULL DEFAULT 1,discovered integer NOT NULL DEFAULT 0,total_reported integer NOT NULL DEFAULT 0,created_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz NOT NULL DEFAULT now(),actor_id uuid REFERENCES public.profiles(id),last_error text,lease_until timestamptz);
GRANT SELECT ON public.tmdb_catalog_jobs TO authenticated; GRANT ALL ON public.tmdb_catalog_jobs TO service_role;
ALTER TABLE public.tmdb_catalog_jobs ENABLE ROW LEVEL SECURITY;
CREATE POLICY tmdb_catalog_jobs_staff ON public.tmdb_catalog_jobs FOR SELECT TO authenticated USING(public.is_staff(auth.uid()));
CREATE TABLE public.tmdb_catalog_job_items (job_id uuid NOT NULL REFERENCES public.tmdb_catalog_jobs(id) ON DELETE CASCADE,item_key text NOT NULL,tmdb_id integer,content_id uuid,state text NOT NULL DEFAULT 'pending',outcome text,filled integer NOT NULL DEFAULT 0,error text,attempts integer NOT NULL DEFAULT 0,PRIMARY KEY(job_id,item_key));
GRANT SELECT ON public.tmdb_catalog_job_items TO authenticated; GRANT ALL ON public.tmdb_catalog_job_items TO service_role;
ALTER TABLE public.tmdb_catalog_job_items ENABLE ROW LEVEL SECURITY;
CREATE POLICY tmdb_catalog_items_staff ON public.tmdb_catalog_job_items FOR SELECT TO authenticated USING(public.is_staff(auth.uid()));
CREATE INDEX tmdb_catalog_items_queue ON public.tmdb_catalog_job_items(job_id,state,item_key);
CREATE OR REPLACE FUNCTION public.catalog_title_key(t text) RETURNS text LANGUAGE sql IMMUTABLE SET search_path=public AS $$ SELECT regexp_replace(lower(translate(coalesce(t,''),'áàâãäéèêëíìîïóòôõöúùûüç','aaaaaeeeeiiiiooooouuuuc')),'[^a-z0-9]+','','g') $$;
CREATE INDEX catalog_movie_match ON public.movies(release_year,public.catalog_title_key(title));
CREATE OR REPLACE FUNCTION public.import_tmdb_movie_metadata(_patch jsonb,_genre_ids integer[]) RETURNS jsonb LANGUAGE plpgsql SET search_path=public AS $$
DECLARE target uuid; matches uuid[]; n integer; r jsonb; slug_base text;
BEGIN
 IF auth.uid() IS NULL OR NOT public.is_staff(auth.uid()) THEN RAISE EXCEPTION 'Acesso negado'; END IF;
 IF coalesce((_patch->>'tmdb_id')::integer,0)<=0 OR coalesce(btrim(_patch->>'title'),'')='' THEN RAISE EXCEPTION 'Metadados inválidos'; END IF;
 PERFORM pg_advisory_xact_lock(76026,(_patch->>'tmdb_id')::integer);
 SELECT id INTO target FROM public.movies WHERE tmdb_id=(_patch->>'tmdb_id')::integer;
 IF target IS NULL THEN
  PERFORM pg_advisory_xact_lock(hashtext(public.catalog_title_key(_patch->>'title')),coalesce((_patch->>'release_year')::integer,0));
  SELECT array_agg(id) INTO matches FROM public.movies WHERE release_year=(_patch->>'release_year')::integer AND (public.catalog_title_key(title) IN(public.catalog_title_key(_patch->>'title'),public.catalog_title_key(_patch->>'original_title')) OR public.catalog_title_key(original_title)=public.catalog_title_key(_patch->>'original_title') AND coalesce(original_title,'')<>'');
  n:=coalesce(array_length(matches,1),0);
  IF n>1 THEN RETURN jsonb_build_object('outcome','ambiguous','filled',0); END IF;
  IF n=1 THEN target:=matches[1]; IF EXISTS(SELECT 1 FROM movies WHERE id=target AND tmdb_id IS NOT NULL AND tmdb_id<>(_patch->>'tmdb_id')::integer) THEN RETURN jsonb_build_object('outcome','ambiguous','filled',0); END IF; END IF;
 END IF;
 IF target IS NOT NULL THEN
  r:=public.complete_tmdb_metadata('movie',target,_patch,_genre_ids);
  RETURN r||jsonb_build_object('id',target,'outcome',CASE WHEN (r->>'filled')::integer>0 OR (r->>'genres')::integer>0 THEN 'completed' ELSE 'exists' END);
 END IF;
 slug_base:=regexp_replace(public.catalog_title_key(_patch->>'title'),'[^a-z0-9]','','g')||'-tmdb-'||(_patch->>'tmdb_id');
 INSERT INTO public.movies(title,original_title,slug,description,poster_url,backdrop_url,release_year,duration_minutes,language,country,status,external_source,external_id,tmdb_id,imdb_id,release_date,vote_average,vote_count,popularity,tagline,tmdb_status,poster_path,backdrop_path,tmdb_synced_at,category_id)
 SELECT x.title,x.original_title,slug_base,x.description,x.poster_url,x.backdrop_url,x.release_year,x.duration_minutes,x.language,x.country,'published','tmdb','movie:'||x.tmdb_id,x.tmdb_id,x.imdb_id,x.release_date,x.vote_average,x.vote_count,x.popularity,x.tagline,x.tmdb_status,x.poster_path,x.backdrop_path,now(),(SELECT id FROM categories WHERE slug='filmes-recomendo') FROM jsonb_populate_record(NULL::public.movies,_patch) x RETURNING id INTO target;
 r:=public.complete_tmdb_metadata('movie',target,'{}',_genre_ids);
 RETURN r||jsonb_build_object('id',target,'outcome','created');
END $$;
REVOKE ALL ON FUNCTION public.import_tmdb_movie_metadata(jsonb,integer[]) FROM PUBLIC,anon; GRANT EXECUTE ON FUNCTION public.import_tmdb_movie_metadata(jsonb,integer[]) TO authenticated;
CREATE OR REPLACE FUNCTION public.tmdb_catalog_report(_job uuid) RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$
 SELECT jsonb_build_object('total',count(*),'pending',count(*) FILTER(WHERE state='pending'),'created',count(*) FILTER(WHERE outcome='created'),'completed',count(DISTINCT content_id) FILTER(WHERE outcome='completed'),'exists',count(*) FILTER(WHERE outcome='exists'),'ambiguous',count(*) FILTER(WHERE outcome='ambiguous'),'errors',count(*) FILTER(WHERE state='error'),'fields',coalesce(sum(filled),0)) FROM tmdb_catalog_job_items WHERE job_id=_job AND public.is_staff(auth.uid())
$$;
REVOKE ALL ON FUNCTION public.tmdb_catalog_report(uuid) FROM PUBLIC,anon; GRANT EXECUTE ON FUNCTION public.tmdb_catalog_report(uuid) TO authenticated;
CREATE TRIGGER audit_movie_categories AFTER INSERT OR UPDATE OR DELETE ON public.movie_categories FOR EACH ROW EXECUTE FUNCTION public.audit_trigger();
CREATE TRIGGER audit_series_categories AFTER INSERT OR UPDATE OR DELETE ON public.series_categories FOR EACH ROW EXECUTE FUNCTION public.audit_trigger();