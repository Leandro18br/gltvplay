ALTER TABLE public.api_integrations DROP CONSTRAINT api_integrations_kind_check;
ALTER TABLE public.api_integrations ADD CONSTRAINT api_integrations_kind_check CHECK (kind = ANY (ARRAY['catalog','movie_player','episode_player','live']));
ALTER TABLE public.api_integrations ADD COLUMN IF NOT EXISTS provider text CHECK (provider IS NULL OR provider IN ('bugoumods_live'));
ALTER TABLE public.api_integrations ADD COLUMN IF NOT EXISTS last_synced_at timestamptz;
ALTER TABLE public.api_integrations ADD COLUMN IF NOT EXISTS batch_size integer NOT NULL DEFAULT 40 CHECK (batch_size BETWEEN 1 AND 200);
ALTER TABLE public.api_integrations ADD COLUMN IF NOT EXISTS timeout_seconds integer NOT NULL DEFAULT 25 CHECK (timeout_seconds BETWEEN 5 AND 60);

ALTER TABLE public.channels ADD COLUMN IF NOT EXISTS external_source text;
ALTER TABLE public.channels ADD COLUMN IF NOT EXISTS external_id text;
ALTER TABLE public.channels ADD COLUMN IF NOT EXISTS api_integration_id uuid REFERENCES public.api_integrations(id) ON DELETE SET NULL;
CREATE UNIQUE INDEX IF NOT EXISTS channels_integration_ext_uniq ON public.channels (api_integration_id, external_id) WHERE api_integration_id IS NOT NULL AND external_id IS NOT NULL;

CREATE TABLE public.live_catalog (
  integration_id uuid NOT NULL REFERENCES public.api_integrations(id) ON DELETE CASCADE,
  ext_id text NOT NULL,
  name text NOT NULL,
  logo_url text,
  category text NOT NULL,
  has_play boolean NOT NULL DEFAULT false,
  seen_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (integration_id, ext_id)
);
CREATE INDEX live_catalog_cat ON public.live_catalog (integration_id, category, name);
GRANT SELECT ON public.live_catalog TO authenticated;
GRANT ALL ON public.live_catalog TO service_role;
ALTER TABLE public.live_catalog ENABLE ROW LEVEL SECURITY;
CREATE POLICY "staff read live catalog" ON public.live_catalog FOR SELECT TO authenticated USING (public.is_staff(auth.uid()));
CREATE POLICY "staff write live catalog" ON public.live_catalog FOR INSERT TO authenticated WITH CHECK (public.is_staff(auth.uid()));
CREATE POLICY "staff update live catalog" ON public.live_catalog FOR UPDATE TO authenticated USING (public.is_staff(auth.uid())) WITH CHECK (public.is_staff(auth.uid()));
GRANT INSERT, UPDATE ON public.live_catalog TO authenticated;

ALTER TABLE public.bugou_import_jobs ADD COLUMN IF NOT EXISTS kind text NOT NULL DEFAULT 'series' CHECK (kind IN ('series','live'));
ALTER TABLE public.bugou_import_jobs ADD COLUMN IF NOT EXISTS integration_id uuid REFERENCES public.api_integrations(id) ON DELETE SET NULL;
ALTER TABLE public.bugou_import_jobs ADD COLUMN IF NOT EXISTS stats jsonb NOT NULL DEFAULT '{}'::jsonb;
CREATE INDEX IF NOT EXISTS bugou_import_jobs_kind ON public.bugou_import_jobs (kind, created_at DESC);