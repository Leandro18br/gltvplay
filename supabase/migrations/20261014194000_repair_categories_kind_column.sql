-- Safe repair for production databases where public.categories.kind is missing.
-- This migration is intentionally additive: it does not delete categories,
-- detach content, or alter movie/series/channel records.
ALTER TABLE public.categories
  ADD COLUMN IF NOT EXISTS kind text NOT NULL DEFAULT 'catalog';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'categories_kind_check'
      AND conrelid = 'public.categories'::regclass
  ) THEN
    ALTER TABLE public.categories
      ADD CONSTRAINT categories_kind_check
      CHECK (kind IN ('catalog', 'channel'));
  END IF;
END
$$;

CREATE INDEX IF NOT EXISTS categories_kind_status_sort_idx
  ON public.categories (kind, status, sort_order, name);
