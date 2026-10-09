CREATE OR REPLACE FUNCTION public.m3u_stats(_list uuid)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public SET statement_timeout = '7s' AS $$
  SELECT jsonb_build_object(
    'imported', (SELECT count(*) FROM m3u_items WHERE list_id = _list AND content_id IS NOT NULL AND kind <> 'series'),
    'errors',   (SELECT count(*) FROM m3u_items WHERE list_id = _list AND import_error IS NOT NULL AND content_id IS NULL)
  );
$$;
REVOKE ALL ON FUNCTION public.m3u_stats(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.m3u_stats(uuid) TO service_role;