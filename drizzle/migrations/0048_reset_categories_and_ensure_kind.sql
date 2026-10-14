-- Compatibility repair for installations missing public.categories.kind.
-- IMPORTANT: despite the legacy filename, this migration must never reset category data.
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

CREATE INDEX IF NOT EXISTS categories_kind_status_sort_idx
  ON public.categories (kind, status, sort_order, name);
