CREATE EXTENSION IF NOT EXISTS pg_trgm WITH SCHEMA extensions;

-- Indexed M3U catalog: one row per distinct list entry (movie / series / episode / channel).
-- Holds stream URLs (may embed credentials) so it is service-role only.
CREATE TABLE public.m3u_items (
  id bigserial PRIMARY KEY,
  list_id uuid NOT NULL REFERENCES public.m3u_lists(id) ON DELETE CASCADE,
  ext_key text NOT NULL,
  kind text NOT NULL CHECK (kind IN ('movie','series','episode','channel')),
  title text NOT NULL,
  title_norm text NOT NULL DEFAULT '',
  series_key text,
  season integer,
  episode integer,
  year integer,
  group_title text,
  logo text,
  url text,
  stream_type text,
  tvg_id text,
  tmdb_id integer,
  episode_count integer,
  seen_gen integer NOT NULL DEFAULT 0,
  missing boolean NOT NULL DEFAULT false,
  content_id uuid,
  imported_at timestamptz,
  import_error text,
  import_attempts integer NOT NULL DEFAULT 0,
  last_attempt_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (list_id, ext_key)
);
GRANT ALL ON public.m3u_items TO service_role;
GRANT USAGE ON SEQUENCE public.m3u_items_id_seq TO service_role;
ALTER TABLE public.m3u_items ENABLE ROW LEVEL SECURITY;
CREATE INDEX m3u_items_browse ON public.m3u_items (list_id, kind, title_norm, id);
CREATE INDEX m3u_items_browse_all ON public.m3u_items (list_id, title_norm, id) WHERE kind <> 'episode';
CREATE INDEX m3u_items_title_trgm ON public.m3u_items USING gin (title_norm extensions.gin_trgm_ops);
CREATE INDEX m3u_items_group ON public.m3u_items (list_id, kind, group_title);
CREATE INDEX m3u_items_series ON public.m3u_items (list_id, series_key, season, episode) WHERE kind = 'episode';
CREATE INDEX m3u_items_gen ON public.m3u_items (list_id, seen_gen);
CREATE INDEX m3u_items_imported ON public.m3u_items (list_id, content_id) WHERE content_id IS NOT NULL;
CREATE INDEX m3u_items_tmdb ON public.m3u_items (tmdb_id) WHERE tmdb_id IS NOT NULL;

-- Per-item import failures (batch, item, error, attempt, date).
CREATE TABLE public.m3u_import_errors (
  id bigserial PRIMARY KEY,
  list_id uuid NOT NULL REFERENCES public.m3u_lists(id) ON DELETE CASCADE,
  item_id bigint REFERENCES public.m3u_items(id) ON DELETE CASCADE,
  batch_id text,
  error text NOT NULL,
  attempt integer NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT ALL ON public.m3u_import_errors TO service_role;
GRANT USAGE ON SEQUENCE public.m3u_import_errors_id_seq TO service_role;
ALTER TABLE public.m3u_import_errors ENABLE ROW LEVEL SECURITY;
CREATE INDEX m3u_import_errors_list ON public.m3u_import_errors (list_id, created_at DESC);

-- Resumable indexing checkpoint.
ALTER TABLE public.m3u_lists
  ADD COLUMN index_gen integer NOT NULL DEFAULT 0,
  ADD COLUMN index_offset bigint NOT NULL DEFAULT 0,
  ADD COLUMN index_entries integer NOT NULL DEFAULT 0,
  ADD COLUMN index_total_bytes bigint,
  ADD COLUMN index_flags jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN index_batch_size integer NOT NULL DEFAULT 500 CHECK (index_batch_size IN (100,250,500,1000)),
  ADD COLUMN index_range boolean;

UPDATE public.m3u_lists SET sync_state = 'idle', processed_items = 0 WHERE sync_state IN ('connecting','reading','processing');

COMMENT ON TABLE public.m3u_staging IS 'DEPRECATED: replaced by m3u_items (indexed catalog + on-demand import).';
COMMENT ON TABLE public.m3u_entities IS 'DEPRECATED: mapping now stored in m3u_items.content_id.';
COMMENT ON COLUMN public.m3u_lists.processed_items IS 'DEPRECATED: replaced by index_entries.';

-- Fast duplicate checks on the main catalog.
CREATE INDEX IF NOT EXISTS movies_title_trgm ON public.movies USING gin (title extensions.gin_trgm_ops);
CREATE INDEX IF NOT EXISTS series_title_trgm ON public.series USING gin (title extensions.gin_trgm_ops);
CREATE INDEX IF NOT EXISTS channels_name_trgm ON public.channels USING gin (name extensions.gin_trgm_ops);
CREATE INDEX IF NOT EXISTS movies_tmdb_idx ON public.movies (tmdb_id) WHERE tmdb_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS series_tmdb_idx ON public.series (tmdb_id) WHERE tmdb_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS playback_sources_url_hash ON public.playback_sources USING hash (url);
CREATE INDEX IF NOT EXISTS playback_sources_content ON public.playback_sources (content_kind, content_id);

-- Closes an indexing run: flags vanished entries, refreshes imported sources, recounts.
CREATE OR REPLACE FUNCTION public.m3u_finalize_index(_list uuid, _gen integer)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE r jsonb;
BEGIN
  UPDATE m3u_items SET missing = true WHERE list_id = _list AND seen_gen < _gen AND NOT missing;
  UPDATE m3u_items s SET episode_count = c.n
    FROM (SELECT series_key, count(*)::int n FROM m3u_items WHERE list_id = _list AND kind = 'episode' AND NOT missing GROUP BY series_key) c
    WHERE s.list_id = _list AND s.kind = 'series' AND s.series_key = c.series_key AND s.episode_count IS DISTINCT FROM c.n;
  UPDATE playback_sources p SET url = i.url, source_type = COALESCE(i.stream_type, p.source_type), last_seen_at = now(), unavailable_since = NULL
    FROM m3u_items i
    WHERE p.m3u_list_id = _list AND i.list_id = _list AND i.ext_key = p.external_ref AND i.seen_gen = _gen AND i.url IS NOT NULL
      AND (p.url IS DISTINCT FROM i.url OR p.unavailable_since IS NOT NULL);
  UPDATE playback_sources p SET unavailable_since = now()
    FROM m3u_items i
    WHERE p.m3u_list_id = _list AND i.list_id = _list AND i.ext_key = p.external_ref AND i.missing AND p.unavailable_since IS NULL;
  SELECT jsonb_build_object(
    'movies', count(*) FILTER (WHERE kind = 'movie'),
    'series', count(*) FILTER (WHERE kind = 'series'),
    'episodes', count(*) FILTER (WHERE kind = 'episode'),
    'channels', count(*) FILTER (WHERE kind = 'channel'),
    'missing', (SELECT count(*) FROM m3u_items WHERE list_id = _list AND missing))
  INTO r FROM m3u_items WHERE list_id = _list AND NOT missing;
  UPDATE m3u_lists SET movies_count = (r->>'movies')::int, series_count = (r->>'series')::int,
    episodes_count = (r->>'episodes')::int, channels_count = (r->>'channels')::int,
    total_items = (r->>'movies')::int + (r->>'episodes')::int + (r->>'channels')::int
  WHERE id = _list;
  RETURN r;
END $$;
REVOKE EXECUTE ON FUNCTION public.m3u_finalize_index(uuid, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.m3u_finalize_index(uuid, integer) TO service_role;

CREATE OR REPLACE FUNCTION public.m3u_groups(_list uuid, _kind text)
RETURNS TABLE(group_title text, n bigint) LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT group_title, count(*) FROM m3u_items
  WHERE list_id = _list AND NOT missing AND group_title IS NOT NULL
    AND ((_kind = 'all' AND kind <> 'episode') OR kind = _kind)
  GROUP BY 1 ORDER BY 2 DESC, 1 LIMIT 1000
$$;
REVOKE EXECUTE ON FUNCTION public.m3u_groups(uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.m3u_groups(uuid, text) TO service_role;