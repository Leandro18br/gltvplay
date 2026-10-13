ALTER TABLE public.categories ADD COLUMN IF NOT EXISTS scope text NOT NULL DEFAULT 'media';
UPDATE public.categories c SET scope='channel'
 WHERE EXISTS (SELECT 1 FROM public.channels ch WHERE ch.category_id=c.id)
   AND NOT EXISTS (SELECT 1 FROM public.movie_categories m WHERE m.category_id=c.id)
   AND NOT EXISTS (SELECT 1 FROM public.series_categories s WHERE s.category_id=c.id)
   AND NOT EXISTS (SELECT 1 FROM public.movies m WHERE m.category_id=c.id)
   AND NOT EXISTS (SELECT 1 FROM public.series s WHERE s.category_id=c.id);
ALTER TABLE public.categories ADD CONSTRAINT categories_scope_chk CHECK (scope IN ('media','channel'));
CREATE INDEX IF NOT EXISTS categories_scope_idx ON public.categories(scope, status);

CREATE OR REPLACE FUNCTION public.guard_category_scope() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE want text; cat uuid;
BEGIN
  IF TG_TABLE_NAME='channels' THEN want:='channel'; cat:=NEW.category_id;
  ELSE want:='media'; cat:=NEW.category_id; END IF;
  IF cat IS NOT NULL AND EXISTS (SELECT 1 FROM public.categories WHERE id=cat AND scope<>want) THEN
    RAISE EXCEPTION 'Categoria incompatível com este tipo de conteúdo';
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS guard_category_scope ON public.channels;
CREATE TRIGGER guard_category_scope BEFORE INSERT OR UPDATE OF category_id ON public.channels FOR EACH ROW EXECUTE FUNCTION public.guard_category_scope();
DROP TRIGGER IF EXISTS guard_category_scope ON public.movie_categories;
CREATE TRIGGER guard_category_scope BEFORE INSERT OR UPDATE ON public.movie_categories FOR EACH ROW EXECUTE FUNCTION public.guard_category_scope();
DROP TRIGGER IF EXISTS guard_category_scope ON public.series_categories;
CREATE TRIGGER guard_category_scope BEFORE INSERT OR UPDATE ON public.series_categories FOR EACH ROW EXECUTE FUNCTION public.guard_category_scope();
DROP TRIGGER IF EXISTS guard_category_scope ON public.movies;
CREATE TRIGGER guard_category_scope BEFORE INSERT OR UPDATE OF category_id ON public.movies FOR EACH ROW EXECUTE FUNCTION public.guard_category_scope();
DROP TRIGGER IF EXISTS guard_category_scope ON public.series;
CREATE TRIGGER guard_category_scope BEFORE INSERT OR UPDATE OF category_id ON public.series FOR EACH ROW EXECUTE FUNCTION public.guard_category_scope();

CREATE OR REPLACE FUNCTION public.import_link_categories(_kind text, _id uuid, _cats jsonb)
 RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
DECLARE ids uuid[]; n int := 0; sc text; pre text;
BEGIN
  IF auth.uid() IS NOT NULL AND NOT public.is_staff(auth.uid()) THEN RAISE EXCEPTION 'Sem permissão'; END IF;
  IF _kind NOT IN ('movie','series','channel') THEN RAISE EXCEPTION 'Tipo inválido'; END IF;
  sc := CASE WHEN _kind='channel' THEN 'channel' ELSE 'media' END;
  pre := CASE WHEN sc='channel' THEN 'canais-' ELSE 'vod-' END;
  CREATE TEMP TABLE IF NOT EXISTS _ilc(ord int, name text, slug text) ON COMMIT DROP;
  DELETE FROM _ilc;
  INSERT INTO _ilc
  SELECT o.ord, left(btrim(o.x->>'name'),120),
    CASE WHEN EXISTS (SELECT 1 FROM public.categories c WHERE c.slug=o.x->>'slug' AND c.scope<>sc) THEN pre||(o.x->>'slug') ELSE o.x->>'slug' END
  FROM jsonb_array_elements(_cats) WITH ORDINALITY o(x, ord)
  WHERE coalesce(o.x->>'slug','')<>'' AND coalesce(btrim(o.x->>'name'),'')<>'';
  INSERT INTO public.categories(name, slug, status, scope)
  SELECT DISTINCT ON (slug) name, slug, 'published'::content_status, sc FROM _ilc ORDER BY slug, ord
  ON CONFLICT (slug) DO NOTHING;
  SELECT array_agg(c.id ORDER BY t.ord) INTO ids FROM _ilc t JOIN public.categories c ON c.slug=t.slug AND c.scope=sc;
  IF ids IS NULL THEN RETURN 0; END IF;
  IF _kind = 'movie' THEN
    UPDATE public.movies SET category_id = ids[1] WHERE id = _id AND category_id IS NULL;
    INSERT INTO public.movie_categories SELECT _id, unnest(ids) ON CONFLICT DO NOTHING; GET DIAGNOSTICS n = ROW_COUNT;
  ELSIF _kind = 'series' THEN
    UPDATE public.series SET category_id = ids[1] WHERE id = _id AND category_id IS NULL;
    INSERT INTO public.series_categories SELECT _id, unnest(ids) ON CONFLICT DO NOTHING; GET DIAGNOSTICS n = ROW_COUNT;
  ELSE
    UPDATE public.channels SET category_id = ids[1] WHERE id = _id AND category_id IS NULL; GET DIAGNOSTICS n = ROW_COUNT;
  END IF;
  RETURN n;
END $function$;