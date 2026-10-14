-- Reinstall the category-link RPC with explicitly scoped writes only.
-- This function must never delete category/content rows; imports are additive and idempotent.
CREATE OR REPLACE FUNCTION public.import_link_categories(_kind text, _id uuid, _cats jsonb)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  ids uuid[];
  n integer := 0;
BEGIN
  IF auth.uid() IS NOT NULL AND NOT public.is_staff(auth.uid()) THEN
    RAISE EXCEPTION 'Sem permissão';
  END IF;
  IF _kind NOT IN ('movie', 'series', 'channel') THEN
    RAISE EXCEPTION 'Tipo inválido';
  END IF;
  IF _id IS NULL THEN
    RAISE EXCEPTION 'Conteúdo inválido: id obrigatório';
  END IF;
  IF _cats IS NULL OR jsonb_typeof(_cats) <> 'array' THEN
    RETURN 0;
  END IF;

  INSERT INTO public.categories (name, slug, status)
  SELECT DISTINCT ON (x->>'slug')
    left(x->>'name', 120),
    x->>'slug',
    'published'::content_status
  FROM jsonb_array_elements(_cats) AS x
  WHERE coalesce(x->>'slug', '') <> ''
    AND coalesce(btrim(x->>'name'), '') <> ''
  ORDER BY x->>'slug'
  ON CONFLICT (slug) DO NOTHING;

  SELECT array_agg(c.id ORDER BY src.ord)
    INTO ids
  FROM jsonb_array_elements(_cats) WITH ORDINALITY AS src(x, ord)
  JOIN public.categories AS c ON c.slug = src.x->>'slug'
  WHERE coalesce(src.x->>'slug', '') <> '';

  IF ids IS NULL OR cardinality(ids) = 0 THEN
    RETURN 0;
  END IF;

  IF _kind = 'movie' THEN
    UPDATE public.movies
      SET category_id = ids[1]
      WHERE id = _id AND category_id IS NULL;
    INSERT INTO public.movie_categories
      SELECT _id, category_id FROM unnest(ids) AS u(category_id)
      ON CONFLICT DO NOTHING;
    GET DIAGNOSTICS n = ROW_COUNT;
  ELSIF _kind = 'series' THEN
    UPDATE public.series
      SET category_id = ids[1]
      WHERE id = _id AND category_id IS NULL;
    INSERT INTO public.series_categories
      SELECT _id, category_id FROM unnest(ids) AS u(category_id)
      ON CONFLICT DO NOTHING;
    GET DIAGNOSTICS n = ROW_COUNT;
  ELSE
    UPDATE public.channels
      SET category_id = ids[1]
      WHERE id = _id AND category_id IS NULL;
    GET DIAGNOSTICS n = ROW_COUNT;
  END IF;

  RETURN n;
END;
$$;

REVOKE ALL ON FUNCTION public.import_link_categories(text, uuid, jsonb) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.import_link_categories(text, uuid, jsonb) TO authenticated, service_role;
