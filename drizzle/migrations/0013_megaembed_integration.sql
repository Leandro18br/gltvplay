ALTER TABLE public.site_settings
  ADD COLUMN IF NOT EXISTS megaembed_enabled boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS megaembed_player text CHECK (megaembed_player IS NULL OR megaembed_player IN ('megaplay','megatube','vidstack','clappr')),
  ADD COLUMN IF NOT EXISTS megaembed_color text CHECK (megaembed_color IS NULL OR megaembed_color ~ '^#[0-9A-Fa-f]{3,8}$'),
  ADD COLUMN IF NOT EXISTS megaembed_movie_template text NOT NULL DEFAULT 'https://megaembed.com/embed/movie?tmdb={tmdb_id}',
  ADD COLUMN IF NOT EXISTS megaembed_episode_template text NOT NULL DEFAULT 'https://megaembed.com/embed/series?tmdb={tmdb_id}&sea={season}&epi={episode}',
  ADD COLUMN IF NOT EXISTS megaembed_json_movies_url text,
  ADD COLUMN IF NOT EXISTS megaembed_json_series_url text;
INSERT INTO public.embed_domains(hostname) VALUES ('megaembed.com') ON CONFLICT DO NOTHING;