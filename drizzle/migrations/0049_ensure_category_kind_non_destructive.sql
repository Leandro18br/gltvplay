-- Ensure the category discriminator exists and preserve/repair classifications.
-- The original category model was catalog-first; infer channel-only categories
-- from actual channel relationships instead of blindly classifying every row.
ALTER TABLE public.categories
  ADD COLUMN IF NOT EXISTS kind text NOT NULL DEFAULT 'catalog';

UPDATE public.categories c
SET kind = 'channel'
WHERE EXISTS (
  SELECT 1 FROM public.channels ch WHERE ch.category_id = c.id
)
AND NOT EXISTS (
  SELECT 1 FROM public.movies m WHERE m.category_id = c.id
)
AND NOT EXISTS (
  SELECT 1 FROM public.series s WHERE s.category_id = c.id
)
AND NOT EXISTS (
  SELECT 1 FROM public.movie_categories mc WHERE mc.category_id = c.id
)
AND NOT EXISTS (
  SELECT 1 FROM public.series_categories sc WHERE sc.category_id = c.id
);

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

CREATE INDEX IF NOT EXISTS categories_kind_status_sort_idx
  ON public.categories (kind, status, sort_order, name);
