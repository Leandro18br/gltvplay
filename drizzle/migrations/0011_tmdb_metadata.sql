ALTER TABLE public.movies
  ADD COLUMN IF NOT EXISTS tmdb_id integer,
  ADD COLUMN IF NOT EXISTS imdb_id text,
  ADD COLUMN IF NOT EXISTS release_date date,
  ADD COLUMN IF NOT EXISTS vote_average numeric,
  ADD COLUMN IF NOT EXISTS vote_count integer,
  ADD COLUMN IF NOT EXISTS popularity numeric,
  ADD COLUMN IF NOT EXISTS tagline text,
  ADD COLUMN IF NOT EXISTS tmdb_status text,
  ADD COLUMN IF NOT EXISTS poster_path text,
  ADD COLUMN IF NOT EXISTS backdrop_path text,
  ADD COLUMN IF NOT EXISTS tmdb_synced_at timestamptz;
CREATE UNIQUE INDEX IF NOT EXISTS movies_tmdb_id_uq ON public.movies(tmdb_id) WHERE tmdb_id IS NOT NULL;

ALTER TABLE public.series
  ADD COLUMN IF NOT EXISTS tmdb_id integer,
  ADD COLUMN IF NOT EXISTS imdb_id text,
  ADD COLUMN IF NOT EXISTS first_air_date date,
  ADD COLUMN IF NOT EXISTS vote_average numeric,
  ADD COLUMN IF NOT EXISTS vote_count integer,
  ADD COLUMN IF NOT EXISTS popularity numeric,
  ADD COLUMN IF NOT EXISTS tagline text,
  ADD COLUMN IF NOT EXISTS tmdb_status text,
  ADD COLUMN IF NOT EXISTS language text,
  ADD COLUMN IF NOT EXISTS country text,
  ADD COLUMN IF NOT EXISTS number_of_seasons integer,
  ADD COLUMN IF NOT EXISTS number_of_episodes integer,
  ADD COLUMN IF NOT EXISTS poster_path text,
  ADD COLUMN IF NOT EXISTS backdrop_path text,
  ADD COLUMN IF NOT EXISTS tmdb_synced_at timestamptz;
CREATE UNIQUE INDEX IF NOT EXISTS series_tmdb_id_uq ON public.series(tmdb_id) WHERE tmdb_id IS NOT NULL;

ALTER TABLE public.seasons
  ADD COLUMN IF NOT EXISTS tmdb_id integer,
  ADD COLUMN IF NOT EXISTS air_date date;

ALTER TABLE public.episodes
  ADD COLUMN IF NOT EXISTS tmdb_id integer,
  ADD COLUMN IF NOT EXISTS original_title text,
  ADD COLUMN IF NOT EXISTS vote_average numeric,
  ADD COLUMN IF NOT EXISTS vote_count integer,
  ADD COLUMN IF NOT EXISTS still_path text;

CREATE TABLE public.tmdb_cache (
  cache_key text PRIMARY KEY,
  body jsonb NOT NULL,
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT ALL ON public.tmdb_cache TO service_role;
ALTER TABLE public.tmdb_cache ENABLE ROW LEVEL SECURITY;