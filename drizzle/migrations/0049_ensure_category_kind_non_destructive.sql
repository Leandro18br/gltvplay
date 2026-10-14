-- Ensure categories.kind exists and preserve separation using actual relationships.
ALTER TABLE public.categories
  ADD COLUMN IF NOT EXISTS kind text NOT NULL DEFAULT 'catalog';

UPDATE public.categories
SET kind = 'catalog'
WHERE kind IS NULL OR kind NOT IN ('catalog', 'channel');

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'categories_kind_check'
      AND conrelid = 'public.categories'::regclass
  ) THEN
    ALTER TABLE public.categories
      ADD CONSTRAINT categories_kind_check
      CHECK (kind IN ('catalog', 'channel'));
  END IF;
END $$;

-- If a legacy category is shared by catalog items and channels, create a
-- channel-specific copy and move only channel links. Never detach catalog links.
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
    new_slug := CASE
      WHEN right(c.slug, 7) = '-canais' THEN c.slug
      ELSE left(c.slug, 90) || '-canais'
    END;
    IF EXISTS (SELECT 1 FROM public.categories WHERE slug = new_slug AND kind <> 'channel') THEN
      new_slug := left(c.slug, 80) || '-canais-' || left(c.id::text, 8);
    END IF;

    INSERT INTO public.categories (name, slug, description, image_url, status, sort_order, kind)
    VALUES (c.name, new_slug, c.description, c.image_url, c.status, c.sort_order, 'channel')
    ON CONFLICT (slug) DO NOTHING
    RETURNING id INTO new_id;

    IF new_id IS NULL THEN
      SELECT id INTO new_id
      FROM public.categories
      WHERE slug = new_slug AND kind = 'channel'
      LIMIT 1;
    END IF;

    IF new_id IS NOT NULL THEN
      UPDATE public.channels SET category_id = new_id WHERE category_id = c.id;
    END IF;
  END LOOP;
END $$;

-- Categories used only by channels are classified as channel categories.
UPDATE public.categories cat
SET kind = 'channel'
WHERE EXISTS (SELECT 1 FROM public.channels ch WHERE ch.category_id = cat.id)
  AND NOT EXISTS (SELECT 1 FROM public.movies m WHERE m.category_id = cat.id)
  AND NOT EXISTS (SELECT 1 FROM public.series s WHERE s.category_id = cat.id)
  AND NOT EXISTS (SELECT 1 FROM public.movie_categories mc WHERE mc.category_id = cat.id)
  AND NOT EXISTS (SELECT 1 FROM public.series_categories sc WHERE sc.category_id = cat.id);

CREATE INDEX IF NOT EXISTS categories_kind_status_sort_idx
  ON public.categories (kind, status, sort_order, name);

-- Keep the legacy RPC compatible with the discriminator and category separation.
CREATE OR REPLACE FUNCTION public.import_link_categories(_kind text, _id uuid, _cats jsonb)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  ids uuid[];
  n integer := 0;
  category_kind text;
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

  category_kind := CASE WHEN _kind = 'channel' THEN 'channel' ELSE 'catalog' END;

  INSERT INTO public.categories (name, slug, status, kind)
  SELECT DISTINCT ON (normalized.slug)
    normalized.name,
    normalized.slug,
    'published'::content_status,
    category_kind
  FROM (
    SELECT
      left(btrim(x->>'name'), 120) AS name,
      CASE
        WHEN _kind = 'channel' AND right(x->>'slug', 7) <> '-canais'
          THEN left(x->>'slug', 90) || '-canais'
        ELSE x->>'slug'
      END AS slug
    FROM jsonb_array_elements(_cats) AS x
  ) AS normalized
  WHERE coalesce(normalized.slug, '') <> ''
    AND coalesce(normalized.name, '') <> ''
  ORDER BY normalized.slug, normalized.name
  ON CONFLICT (slug) DO NOTHING;

  SELECT array_agg(c.id ORDER BY src.ord)
    INTO ids
  FROM jsonb_array_elements(_cats) WITH ORDINALITY AS src(x, ord)
  JOIN public.categories AS c
    ON c.slug = CASE
      WHEN _kind = 'channel' AND right(src.x->>'slug', 7) <> '-canais'
        THEN left(src.x->>'slug', 90) || '-canais'
      ELSE src.x->>'slug'
    END
   AND c.kind = category_kind
  WHERE coalesce(src.x->>'slug', '') <> '';

  IF ids IS NULL OR cardinality(ids) = 0 THEN
    RETURN 0;
  END IF;

  IF _kind = 'movie' THEN
    UPDATE public.movies SET category_id = ids[1] WHERE id = _id AND category_id IS NULL;
    INSERT INTO public.movie_categories
      SELECT _id, category_id FROM unnest(ids) AS u(category_id)
      ON CONFLICT DO NOTHING;
    GET DIAGNOSTICS n = ROW_COUNT;
  ELSIF _kind = 'series' THEN
    UPDATE public.series SET category_id = ids[1] WHERE id = _id AND category_id IS NULL;
    INSERT INTO public.series_categories
      SELECT _id, category_id FROM unnest(ids) AS u(category_id)
      ON CONFLICT DO NOTHING;
    GET DIAGNOSTICS n = ROW_COUNT;
  ELSE
    UPDATE public.channels SET category_id = ids[1] WHERE id = _id AND category_id IS NULL;
    GET DIAGNOSTICS n = ROW_COUNT;
  END IF;

  RETURN n;
END;
$$;

REVOKE ALL ON FUNCTION public.import_link_categories(text, uuid, jsonb) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.import_link_categories(text, uuid, jsonb) TO authenticated, service_role;
