-- Finalizing in id-range chunks keeps every statement far below the 8s API statement timeout.
CREATE OR REPLACE FUNCTION public.m3u_finalize_chunk(_list uuid, _gen integer, _from bigint, _limit integer)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE r jsonb;
BEGIN
  WITH c AS (
    SELECT id, kind, seen_gen FROM m3u_items WHERE list_id = _list AND id >= _from ORDER BY id LIMIT _limit
  ), upd AS (
    UPDATE m3u_items m SET missing = true FROM c WHERE m.id = c.id AND c.seen_gen < _gen AND NOT m.missing RETURNING m.id
  )
  SELECT jsonb_build_object(
    'rows', count(*),
    'next', COALESCE(max(id) + 1, _from),
    'movie', count(*) FILTER (WHERE kind = 'movie' AND seen_gen = _gen),
    'series', count(*) FILTER (WHERE kind = 'series' AND seen_gen = _gen),
    'episode', count(*) FILTER (WHERE kind = 'episode' AND seen_gen = _gen),
    'channel', count(*) FILTER (WHERE kind = 'channel' AND seen_gen = _gen),
    'missing', (SELECT count(*) FROM upd))
  INTO r FROM c;
  RETURN r;
END $$;
REVOKE EXECUTE ON FUNCTION public.m3u_finalize_chunk(uuid, integer, bigint, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.m3u_finalize_chunk(uuid, integer, bigint, integer) TO service_role;

-- Refreshes / flags the M3U sources of already imported content (touches only imported rows).
CREATE OR REPLACE FUNCTION public.m3u_finalize_sources(_list uuid, _gen integer)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  UPDATE playback_sources p SET url = i.url, source_type = COALESCE(i.stream_type, p.source_type), last_seen_at = now(), unavailable_since = NULL
    FROM m3u_items i
    WHERE p.m3u_list_id = _list AND i.list_id = _list AND i.ext_key = p.external_ref AND i.seen_gen = _gen AND i.url IS NOT NULL
      AND (p.url IS DISTINCT FROM i.url OR p.unavailable_since IS NOT NULL);
  UPDATE playback_sources p SET unavailable_since = now()
    FROM m3u_items i
    WHERE p.m3u_list_id = _list AND i.list_id = _list AND i.ext_key = p.external_ref AND i.missing AND p.unavailable_since IS NULL;
END $$;
REVOKE EXECUTE ON FUNCTION public.m3u_finalize_sources(uuid, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.m3u_finalize_sources(uuid, integer) TO service_role;

-- Episode counts only for the series shown on one explore page.
CREATE OR REPLACE FUNCTION public.m3u_episode_counts(_list uuid, _keys text[])
RETURNS TABLE(series_key text, n bigint) LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT series_key, count(*) FROM m3u_items
  WHERE list_id = _list AND kind = 'episode' AND series_key = ANY(_keys) AND NOT missing
  GROUP BY 1
$$;
REVOKE EXECUTE ON FUNCTION public.m3u_episode_counts(uuid, text[]) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.m3u_episode_counts(uuid, text[]) TO service_role;

COMMENT ON FUNCTION public.m3u_finalize_index(uuid, integer) IS 'DEPRECATED: full-table pass exceeded the API statement timeout on large lists; use m3u_finalize_chunk + m3u_finalize_sources.';