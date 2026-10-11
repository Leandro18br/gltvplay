CREATE TABLE public.bugou_catalog (
  kind text NOT NULL DEFAULT 'series',
  ext_id text NOT NULL,
  title text NOT NULL,
  title_norm text NOT NULL,
  title_compact text NOT NULL,
  year integer,
  poster_url text,
  category text,
  seen_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (kind, ext_id)
);
CREATE INDEX bugou_catalog_norm_idx ON public.bugou_catalog (kind, title_norm);
GRANT SELECT, INSERT, UPDATE ON public.bugou_catalog TO authenticated;
GRANT ALL ON public.bugou_catalog TO service_role;
ALTER TABLE public.bugou_catalog ENABLE ROW LEVEL SECURITY;
CREATE POLICY "staff read bugou catalog" ON public.bugou_catalog FOR SELECT TO authenticated USING (public.is_staff(auth.uid()));
CREATE POLICY "staff insert bugou catalog" ON public.bugou_catalog FOR INSERT TO authenticated WITH CHECK (public.is_staff(auth.uid()));
CREATE POLICY "staff update bugou catalog" ON public.bugou_catalog FOR UPDATE TO authenticated USING (public.is_staff(auth.uid())) WITH CHECK (public.is_staff(auth.uid()));

CREATE TABLE public.bugou_sync (
  kind text PRIMARY KEY,
  synced_at timestamptz NOT NULL DEFAULT now(),
  total integer NOT NULL DEFAULT 0
);
GRANT SELECT, INSERT, UPDATE ON public.bugou_sync TO authenticated;
GRANT ALL ON public.bugou_sync TO service_role;
ALTER TABLE public.bugou_sync ENABLE ROW LEVEL SECURITY;
CREATE POLICY "staff all bugou sync" ON public.bugou_sync FOR ALL TO authenticated USING (public.is_staff(auth.uid())) WITH CHECK (public.is_staff(auth.uid()));

CREATE TABLE public.bugou_import_jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  label text NOT NULL DEFAULT '',
  status text NOT NULL DEFAULT 'running',
  total integer NOT NULL DEFAULT 0,
  done integer NOT NULL DEFAULT 0,
  failed integer NOT NULL DEFAULT 0,
  episodes_created integer NOT NULL DEFAULT 0,
  lease_until timestamptz,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE ON public.bugou_import_jobs TO authenticated;
GRANT ALL ON public.bugou_import_jobs TO service_role;
ALTER TABLE public.bugou_import_jobs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "staff all bugou jobs" ON public.bugou_import_jobs FOR ALL TO authenticated USING (public.is_staff(auth.uid())) WITH CHECK (public.is_staff(auth.uid()));

CREATE TABLE public.bugou_import_items (
  job_id uuid NOT NULL REFERENCES public.bugou_import_jobs(id) ON DELETE CASCADE,
  ext_id text NOT NULL,
  title text,
  state text NOT NULL DEFAULT 'pending',
  attempts integer NOT NULL DEFAULT 0,
  error text,
  result jsonb,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (job_id, ext_id)
);
CREATE INDEX bugou_import_items_state_idx ON public.bugou_import_items (job_id, state);
GRANT SELECT, INSERT, UPDATE ON public.bugou_import_items TO authenticated;
GRANT ALL ON public.bugou_import_items TO service_role;
ALTER TABLE public.bugou_import_items ENABLE ROW LEVEL SECURITY;
CREATE POLICY "staff all bugou items" ON public.bugou_import_items FOR ALL TO authenticated USING (public.is_staff(auth.uid())) WITH CHECK (public.is_staff(auth.uid()));

CREATE INDEX IF NOT EXISTS series_external_idx ON public.series (external_source, external_id);
CREATE INDEX IF NOT EXISTS playback_sources_content_idx ON public.playback_sources (content_kind, content_id);