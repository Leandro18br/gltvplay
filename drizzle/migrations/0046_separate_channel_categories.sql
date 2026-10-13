-- Separate channel categories from the shared movie/series catalog without deleting content.
ALTER TABLE public.categories
  ADD COLUMN IF NOT EXISTS kind text NOT NULL DEFAULT 'catalog';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'categories_kind_check'
      AND conrelid = 'public.categories'::regclass
  ) THEN
    ALTER TABLE public.categories
      ADD CONSTRAINT categories_kind_check CHECK (kind IN ('catalog', 'channel'));
  END IF;
END $$;

-- A category used by channels and movies/series must be split, preserving the original
-- catalog category and moving only channel links to the new channel-specific row.
DO $$
DECLARE
  c record;
  new_id uuid;
  new_slug text;
BEGIN
  FOR c IN
    SELECT DISTINCT cat.*
    FROM public.categories cat
    JOIN public.channels ch ON ch.category_id = cat.id
    WHERE EXISTS (SELECT 1 FROM public.movies m WHERE m.category_id = cat.id)
       OR EXISTS (SELECT 1 FROM public.series s WHERE s.category_id = cat.id)
       OR EXISTS (SELECT 1 FROM public.movie_categories mc WHERE mc.category_id = cat.id)
       OR EXISTS (SELECT 1 FROM public.series_categories sc WHERE sc.category_id = cat.id)
  LOOP
    new_slug := left(c.slug, 90) || '-canais';
    IF EXISTS (SELECT 1 FROM public.categories WHERE slug = new_slug) THEN
      new_slug := left(c.slug, 80) || '-canais-' || left(c.id::text, 8);
    END IF;

    INSERT INTO public.categories (name, slug, description, image_url, status, sort_order, kind)
    VALUES (c.name, new_slug, c.description, c.image_url, c.status, c.sort_order, 'channel')
    ON CONFLICT (slug) DO NOTHING
    RETURNING id INTO new_id;

    IF new_id IS NULL THEN
      SELECT id INTO new_id FROM public.categories WHERE slug = new_slug AND kind = 'channel' LIMIT 1;
    END IF;

    UPDATE public.channels SET category_id = new_id WHERE category_id = c.id;
  END LOOP;
END $$;

-- Categories used only by channels become channel categories. All other existing
-- categories remain catalog categories, preserving movie/series assignments.
UPDATE public.categories cat
SET kind = 'channel'
WHERE EXISTS (SELECT 1 FROM public.channels ch WHERE ch.category_id = cat.id)
  AND NOT EXISTS (SELECT 1 FROM public.movies m WHERE m.category_id = cat.id)
  AND NOT EXISTS (SELECT 1 FROM public.series s WHERE s.category_id = cat.id)
  AND NOT EXISTS (SELECT 1 FROM public.movie_categories mc WHERE mc.category_id = cat.id)
  AND NOT EXISTS (SELECT 1 FROM public.series_categories sc WHERE sc.category_id = cat.id);

CREATE INDEX IF NOT EXISTS categories_kind_status_sort_idx
  ON public.categories (kind, status, sort_order, name);

CREATE OR REPLACE FUNCTION public.import_link_categories(_kind text, _id uuid, _cats jsonb)
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
  ids uuid[];
  n int := 0;
  category_kind text;
BEGIN
  IF auth.uid() IS NOT NULL AND NOT public.is_staff(auth.uid()) THEN RAISE EXCEPTION 'Sem permissão'; END IF;
  IF _kind NOT IN ('movie','series','channel') THEN RAISE EXCEPTION 'Tipo inválido'; END IF;
  category_kind := CASE WHEN _kind = 'channel' THEN 'channel' ELSE 'catalog' END;

  WITH src AS (
    SELECT DISTINCT ON (x->>'slug')
      left(x->>'name',120) AS name,
      left(x->>'slug',100) AS original_slug
    FROM jsonb_array_elements(_cats) x
    WHERE coalesce(x->>'slug','') <> '' AND coalesce(btrim(x->>'name'),'') <> ''
    ORDER BY x->>'slug'
  ), normalized AS (
    SELECT name,
      CASE
        WHEN category_kind = 'channel'
         AND EXISTS (SELECT 1 FROM public.categories c WHERE c.slug = src.original_slug AND c.kind <> 'channel')
        THEN left(src.original_slug, 90) || '-canais'
        ELSE src.original_slug
      END AS slug
    FROM src
  )
  INSERT INTO public.categories (name, slug, status, kind)
  SELECT DISTINCT ON (slug) name, slug, 'published'::content_status, category_kind
  FROM normalized
  ON CONFLICT (slug) DO NOTHING;

  SELECT array_agg(c.id ORDER BY o.ord) INTO ids
  FROM jsonb_array_elements(_cats) WITH ORDINALITY o(x, ord)
  JOIN public.categories c
    ON c.kind = category_kind
   AND c.slug = CASE
     WHEN category_kind = 'channel'
      AND EXISTS (SELECT 1 FROM public.categories other WHERE other.slug = left(o.x->>'slug',100) AND other.kind <> 'channel')
     THEN left(o.x->>'slug',90) || '-canais'
     ELSE left(o.x->>'slug',100)
   END;

  IF ids IS NULL THEN RETURN 0; END IF;
  IF _kind = 'movie' THEN
    UPDATE public.movies SET category_id = ids[1] WHERE id = _id AND category_id IS NULL;
    INSERT INTO public.movie_categories SELECT _id, unnest(ids) ON CONFLICT DO NOTHING;
    GET DIAGNOSTICS n = ROW_COUNT;
  ELSIF _kind = 'series' THEN
    UPDATE public.series SET category_id = ids[1] WHERE id = _id AND category_id IS NULL;
    INSERT INTO public.series_categories SELECT _id, unnest(ids) ON CONFLICT DO NOTHING;
    GET DIAGNOSTICS n = ROW_COUNT;
  ELSE
    UPDATE public.channels SET category_id = ids[1] WHERE id = _id AND (category_id IS NULL OR NOT EXISTS (SELECT 1 FROM public.categories c WHERE c.id = category_id AND c.kind = 'channel'));
    GET DIAGNOSTICS n = ROW_COUNT;
  END IF;
  RETURN n;
END $$;
REVOKE ALL ON FUNCTION public.import_link_categories(text, uuid, jsonb) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.import_link_categories(text, uuid, jsonb) TO authenticated, service_role;
