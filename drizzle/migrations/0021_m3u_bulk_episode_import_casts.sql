CREATE OR REPLACE FUNCTION public.m3u_import_series_chunk(_list uuid, _series_key text, _series_id uuid, _job_start timestamptz, _limit integer DEFAULT 250)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  list_label text; n_items int := 0; n_invalid int := 0; n_seasons int := 0; n_eps int := 0; n_src_new int := 0; n_src_upd int := 0; n_remaining int := 0;
BEGIN
  SELECT left(name, 60) INTO list_label FROM public.m3u_lists WHERE id = _list;
  IF list_label IS NULL THEN RAISE EXCEPTION 'Lista não encontrada'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.series WHERE id = _series_id) THEN RAISE EXCEPTION 'Série não encontrada'; END IF;

  CREATE TEMP TABLE IF NOT EXISTS _m3u_chunk (item_id bigint, ext_key text, season int, episode int, title text, logo text, url text, stream_type text, attempts int, season_id uuid, episode_id uuid, valid boolean, err text) ON COMMIT DROP;
  TRUNCATE _m3u_chunk;

  INSERT INTO _m3u_chunk (item_id, ext_key, season, episode, title, logo, url, stream_type, attempts, valid)
  SELECT i.id, i.ext_key, i.season, i.episode, i.title, i.logo, i.url, i.stream_type, i.import_attempts, true
  FROM public.m3u_items i
  WHERE i.list_id = _list AND i.kind = 'episode' AND i.series_key = _series_key AND i.content_id IS NULL AND NOT i.missing
    AND (i.import_error IS NULL OR i.last_attempt_at < _job_start)
  ORDER BY i.season, i.episode, i.id
  LIMIT greatest(1, least(_limit, 1000))
  FOR UPDATE SKIP LOCKED;
  GET DIAGNOSTICS n_items = ROW_COUNT;

  UPDATE _m3u_chunk SET valid = false, err = 'Temporada ou episódio ausente no nome do item' WHERE season IS NULL OR episode IS NULL OR season < 0 OR episode < 0;
  UPDATE _m3u_chunk SET valid = false, err = 'URL de reprodução inválida' WHERE valid AND url IS NOT NULL AND (url !~* '^https?://' OR char_length(url) > 2048);
  SELECT count(*) INTO n_invalid FROM _m3u_chunk WHERE NOT valid;

  INSERT INTO public.seasons (series_id, season_number, title, status, sort_order)
  SELECT DISTINCT _series_id, season, 'Temporada ' || season, 'published'::public.content_status, season FROM _m3u_chunk WHERE valid
  ON CONFLICT (series_id, season_number) DO NOTHING;
  GET DIAGNOSTICS n_seasons = ROW_COUNT;
  UPDATE _m3u_chunk c SET season_id = s.id FROM public.seasons s WHERE c.valid AND s.series_id = _series_id AND s.season_number = c.season;

  INSERT INTO public.episodes (season_id, episode_number, title, thumbnail_url, status)
  SELECT DISTINCT ON (season_id, episode) season_id, episode,
    coalesce(nullif(left(btrim(title), 200), ''), 'Episódio ' || episode), logo, 'published'::public.content_status
  FROM _m3u_chunk WHERE valid ORDER BY season_id, episode, item_id
  ON CONFLICT (season_id, episode_number) DO NOTHING;
  GET DIAGNOSTICS n_eps = ROW_COUNT;
  UPDATE _m3u_chunk c SET episode_id = e.id FROM public.episodes e WHERE c.valid AND e.season_id = c.season_id AND e.episode_number = c.episode;
  UPDATE public.episodes e SET thumbnail_url = x.logo
  FROM (SELECT DISTINCT ON (episode_id) episode_id, logo FROM _m3u_chunk WHERE valid AND logo IS NOT NULL ORDER BY episode_id, item_id) x
  WHERE e.id = x.episode_id AND e.thumbnail_url IS NULL;

  UPDATE public.playback_sources p SET url = c.url, source_type = CASE WHEN c.stream_type = 'hls' THEN 'hls' ELSE 'url' END, last_seen_at = now(), unavailable_since = NULL
  FROM _m3u_chunk c
  WHERE c.valid AND c.url IS NOT NULL AND p.m3u_list_id = _list AND p.content_kind = 'episode' AND p.content_id = c.episode_id AND p.external_ref = left(c.ext_key, 200);
  GET DIAGNOSTICS n_src_upd = ROW_COUNT;

  INSERT INTO public.playback_sources (content_kind, content_id, url, source_type, external_ref, m3u_list_id, label, provider, is_active, is_primary, sort_order, drm, last_seen_at)
  SELECT 'episode'::public.content_kind, c.episode_id, c.url, CASE WHEN c.stream_type = 'hls' THEN 'hls' ELSE 'url' END, left(c.ext_key, 200), _list, list_label, 'm3u', true,
    (ex.n = 0 AND c.rn = 1), ex.n + c.rn - 1, '{}'::jsonb, now()
  FROM (SELECT *, row_number() OVER (PARTITION BY episode_id ORDER BY item_id) rn FROM _m3u_chunk
        WHERE valid AND url IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.playback_sources p WHERE p.m3u_list_id = _list AND p.content_kind = 'episode' AND p.content_id = _m3u_chunk.episode_id AND p.external_ref = left(_m3u_chunk.ext_key, 200))) c
  CROSS JOIN LATERAL (SELECT count(*)::int n FROM public.playback_sources p WHERE p.content_kind = 'episode' AND p.content_id = c.episode_id AND p.is_active) ex;
  GET DIAGNOSTICS n_src_new = ROW_COUNT;

  UPDATE public.m3u_items i SET content_id = c.episode_id, imported_at = now(), import_error = NULL, import_attempts = c.attempts + 1, last_attempt_at = now()
  FROM _m3u_chunk c WHERE c.valid AND i.id = c.item_id;
  UPDATE public.m3u_items i SET import_error = c.err, import_attempts = c.attempts + 1, last_attempt_at = now()
  FROM _m3u_chunk c WHERE NOT c.valid AND i.id = c.item_id;
  INSERT INTO public.m3u_import_errors (list_id, item_id, batch_id, error, attempt)
  SELECT _list, item_id, 'bulk', err, attempts + 1 FROM _m3u_chunk WHERE NOT valid;

  SELECT count(*) INTO n_remaining FROM public.m3u_items i
  WHERE i.list_id = _list AND i.kind = 'episode' AND i.series_key = _series_key AND i.content_id IS NULL AND NOT i.missing
    AND (i.import_error IS NULL OR i.last_attempt_at < _job_start);

  RETURN jsonb_build_object('processed', n_items, 'errors', n_invalid, 'seasons', n_seasons, 'episodes', n_eps,
    'reused', greatest(0, (SELECT count(DISTINCT episode_id) FROM _m3u_chunk WHERE valid) - n_eps), 'sources_new', n_src_new, 'sources_updated', n_src_upd, 'remaining', n_remaining);
END;
$$;
REVOKE ALL ON FUNCTION public.m3u_import_series_chunk(uuid, text, uuid, timestamptz, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.m3u_import_series_chunk(uuid, text, uuid, timestamptz, integer) TO service_role;