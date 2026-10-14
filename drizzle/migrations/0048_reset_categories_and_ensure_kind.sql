-- Repair installations where the channel-category migration was not applied.
-- Category cleanup is intentionally limited to category rows and category associations.
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
      ADD CONSTRAINT categories_kind_check
      CHECK (kind IN ('catalog', 'channel'));
  END IF;
END $$;

-- Detach categories from content first; preserve every movie, series and channel.
UPDATE public.movies SET category_id = NULL WHERE category_id IS NOT NULL;
UPDATE public.series SET category_id = NULL WHERE category_id IS NOT NULL;
UPDATE public.channels SET category_id = NULL WHERE category_id IS NOT NULL;

-- Clear category associations and then all existing category records.
DELETE FROM public.movie_categories;
DELETE FROM public.series_categories;
DELETE FROM public.categories;

CREATE INDEX IF NOT EXISTS categories_kind_status_sort_idx
  ON public.categories (kind, status, sort_order, name);
