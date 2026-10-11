ALTER TABLE public.bugou_import_items
  ADD COLUMN IF NOT EXISTS step text NOT NULL DEFAULT 'details',
  ADD COLUMN IF NOT EXISTS next_attempt_at timestamptz,
  ADD COLUMN IF NOT EXISTS rate_limited integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS seasons_found integer,
  ADD COLUMN IF NOT EXISTS episodes_imported integer,
  ADD COLUMN IF NOT EXISTS episodes_pending integer,
  ADD COLUMN IF NOT EXISTS details jsonb,
  ADD COLUMN IF NOT EXISTS series_id uuid;
ALTER TABLE public.bugou_import_jobs ADD COLUMN IF NOT EXISTS throttle_until timestamptz;
CREATE INDEX IF NOT EXISTS bugou_import_items_queue_idx ON public.bugou_import_items (job_id, state, next_attempt_at);
CREATE INDEX IF NOT EXISTS bugou_import_items_ext_state_idx ON public.bugou_import_items (ext_id, state);