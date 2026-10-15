-- StreamBetter catalog identity and authorized embed support. Additive only.
ALTER TABLE public.movies ADD COLUMN IF NOT EXISTS streambetter_id text;
ALTER TABLE public.movies ADD COLUMN IF NOT EXISTS streambetter_tmdb_id text;
ALTER TABLE public.series ADD COLUMN IF NOT EXISTS streambetter_id text;
ALTER TABLE public.series ADD COLUMN IF NOT EXISTS streambetter_tmdb_id text;
CREATE UNIQUE INDEX IF NOT EXISTS movies_streambetter_tmdb_id_uidx ON public.movies(streambetter_tmdb_id) WHERE streambetter_tmdb_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS series_streambetter_tmdb_id_uidx ON public.series(streambetter_tmdb_id) WHERE streambetter_tmdb_id IS NOT NULL;
INSERT INTO public.embed_domains(hostname) VALUES ('streambetter.shop') ON CONFLICT (hostname) DO NOTHING;
