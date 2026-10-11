ALTER TABLE public.live_catalog ADD COLUMN IF NOT EXISTS ext text;

CREATE TABLE public.bugou_catalog_categories (
  kind text NOT NULL,
  ext_id text NOT NULL,
  category text NOT NULL,
  seen_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (kind, ext_id, category),
  FOREIGN KEY (kind, ext_id) REFERENCES public.bugou_catalog(kind, ext_id) ON DELETE CASCADE
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.bugou_catalog_categories TO authenticated;
GRANT ALL ON public.bugou_catalog_categories TO service_role;
ALTER TABLE public.bugou_catalog_categories ENABLE ROW LEVEL SECURITY;
CREATE POLICY "staff read bcc" ON public.bugou_catalog_categories FOR SELECT TO authenticated USING (public.is_staff(auth.uid()));
CREATE POLICY "staff write bcc" ON public.bugou_catalog_categories FOR INSERT TO authenticated WITH CHECK (public.is_staff(auth.uid()));
CREATE POLICY "staff update bcc" ON public.bugou_catalog_categories FOR UPDATE TO authenticated USING (public.is_staff(auth.uid())) WITH CHECK (public.is_staff(auth.uid()));
CREATE INDEX ON public.bugou_catalog_categories (kind, category);

CREATE TABLE public.live_catalog_categories (
  integration_id uuid NOT NULL,
  ext_id text NOT NULL,
  category text NOT NULL,
  seen_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (integration_id, ext_id, category),
  FOREIGN KEY (integration_id, ext_id) REFERENCES public.live_catalog(integration_id, ext_id) ON DELETE CASCADE
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.live_catalog_categories TO authenticated;
GRANT ALL ON public.live_catalog_categories TO service_role;
ALTER TABLE public.live_catalog_categories ENABLE ROW LEVEL SECURITY;
CREATE POLICY "staff read lcc" ON public.live_catalog_categories FOR SELECT TO authenticated USING (public.is_staff(auth.uid()));
CREATE POLICY "staff write lcc" ON public.live_catalog_categories FOR INSERT TO authenticated WITH CHECK (public.is_staff(auth.uid()));
CREATE POLICY "staff update lcc" ON public.live_catalog_categories FOR UPDATE TO authenticated USING (public.is_staff(auth.uid())) WITH CHECK (public.is_staff(auth.uid()));
CREATE INDEX ON public.live_catalog_categories (integration_id, category);

-- Backfill memberships from the current single-category indexes.
INSERT INTO public.bugou_catalog_categories (kind, ext_id, category, seen_at)
SELECT kind, ext_id, category, seen_at FROM public.bugou_catalog WHERE category IS NOT NULL ON CONFLICT DO NOTHING;
INSERT INTO public.live_catalog_categories (integration_id, ext_id, category, seen_at)
SELECT integration_id, ext_id, category, seen_at FROM public.live_catalog ON CONFLICT DO NOTHING;