CREATE OR REPLACE FUNCTION public.m3u_finalize_sources_chunk(_list uuid, _gen integer, _after uuid, _limit integer)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE r jsonb;
BEGIN
  WITH c AS (
    SELECT p.id, p.external_ref FROM playback_sources p
    WHERE p.m3u_list_id = _list AND (_after IS NULL OR p.id > _after) ORDER BY p.id LIMIT _limit
  ), seen AS (
    UPDATE playback_sources p SET url = i.url, source_type = COALESCE(i.stream_type, p.source_type), last_seen_at = now(), unavailable_since = NULL
    FROM c JOIN m3u_items i ON i.list_id = _list AND i.ext_key = c.external_ref
    WHERE p.id = c.id AND i.seen_gen = _gen AND i.url IS NOT NULL AND (p.url IS DISTINCT FROM i.url OR p.unavailable_since IS NOT NULL)
    RETURNING p.id
  ), gone AS (
    UPDATE playback_sources p SET unavailable_since = now()
    FROM c JOIN m3u_items i ON i.list_id = _list AND i.ext_key = c.external_ref
    WHERE p.id = c.id AND i.missing AND p.unavailable_since IS NULL
    RETURNING p.id
  )
  SELECT jsonb_build_object('rows', (SELECT count(*) FROM c), 'last', (SELECT max(id::text) FROM c),
    'updated', (SELECT count(*) FROM seen), 'unavailable', (SELECT count(*) FROM gone)) INTO r;
  RETURN r;
END $$;
REVOKE ALL ON FUNCTION public.m3u_finalize_sources_chunk(uuid, integer, uuid, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.m3u_finalize_sources_chunk(uuid, integer, uuid, integer) TO service_role;