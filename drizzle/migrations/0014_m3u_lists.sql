CREATE TABLE public.m3u_lists (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  list_type text NOT NULL DEFAULT 'auto' CHECK (list_type IN ('auto','m3u','m3u_plus')),
  detected_type text,
  url_hint text,
  is_active boolean NOT NULL DEFAULT true,
  enrich_tmdb boolean NOT NULL DEFAULT true,
  sync_state text NOT NULL DEFAULT 'idle',
  sync_started_at timestamptz,
  last_synced_at timestamptz,
  last_error text,
  movies_count integer NOT NULL DEFAULT 0,
  series_count integer NOT NULL DEFAULT 0,
  episodes_count integer NOT NULL DEFAULT 0,
  channels_count integer NOT NULL DEFAULT 0,
  total_items integer NOT NULL DEFAULT 0,
  processed_items integer NOT NULL DEFAULT 0,
  last_report jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.m3u_lists TO authenticated;
GRANT ALL ON public.m3u_lists TO service_role;
ALTER TABLE public.m3u_lists ENABLE ROW LEVEL SECURITY;
CREATE POLICY "staff read" ON public.m3u_lists FOR SELECT TO authenticated USING (public.is_staff(auth.uid()));
CREATE POLICY "admin insert" ON public.m3u_lists FOR INSERT TO authenticated WITH CHECK (public.is_admin(auth.uid()));
CREATE POLICY "admin update" ON public.m3u_lists FOR UPDATE TO authenticated USING (public.is_admin(auth.uid())) WITH CHECK (public.is_admin(auth.uid()));
CREATE POLICY "admin delete" ON public.m3u_lists FOR DELETE TO authenticated USING (public.is_admin(auth.uid()));
CREATE TRIGGER t1 BEFORE UPDATE ON public.m3u_lists FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- Full list URL (may hold user/password): server-only.
CREATE TABLE public.m3u_list_secrets (
  list_id uuid PRIMARY KEY REFERENCES public.m3u_lists(id) ON DELETE CASCADE,
  url text NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT ALL ON public.m3u_list_secrets TO service_role;
ALTER TABLE public.m3u_list_secrets ENABLE ROW LEVEL SECURITY;

-- Parsed entries waiting to be applied (chunked processing).
CREATE TABLE public.m3u_staging (
  id bigserial PRIMARY KEY,
  list_id uuid NOT NULL REFERENCES public.m3u_lists(id) ON DELETE CASCADE,
  kind text NOT NULL,
  sort_key text NOT NULL DEFAULT '',
  data jsonb NOT NULL,
  done boolean NOT NULL DEFAULT false
);
CREATE INDEX m3u_staging_queue ON public.m3u_staging(list_id, done, kind, sort_key, id);
GRANT ALL ON public.m3u_staging TO service_role;
GRANT USAGE ON SEQUENCE public.m3u_staging_id_seq TO service_role;
ALTER TABLE public.m3u_staging ENABLE ROW LEVEL SECURITY;

-- Stable mapping list entry -> catalog row (dedupe across syncs).
CREATE TABLE public.m3u_entities (
  list_id uuid NOT NULL REFERENCES public.m3u_lists(id) ON DELETE CASCADE,
  kind text NOT NULL,
  ext_key text NOT NULL,
  content_id uuid NOT NULL,
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (list_id, kind, ext_key)
);
GRANT ALL ON public.m3u_entities TO service_role;
ALTER TABLE public.m3u_entities ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.playback_sources ADD COLUMN m3u_list_id uuid REFERENCES public.m3u_lists(id) ON DELETE SET NULL,
  ADD COLUMN last_seen_at timestamptz, ADD COLUMN unavailable_since timestamptz;
CREATE INDEX playback_sources_m3u ON public.playback_sources(m3u_list_id, external_ref);
COMMENT ON COLUMN public.playback_sources.unavailable_since IS 'Set when the source was missing from the last M3U sync (kept, not deleted).';