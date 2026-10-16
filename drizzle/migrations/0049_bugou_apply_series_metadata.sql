CREATE OR REPLACE FUNCTION public.bugou_apply_series(_series_id uuid, _items jsonb, _actor uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE n_items int; n_seasons int := 0; n_eps int := 0; n_src_new int := 0; n_src_upd int := 0; n_saved int; n_player int; n_meta int := 0; n_smeta int := 0; t text;
BEGIN
  SELECT title INTO t FROM public.series WHERE id = _series_id;
  IF t IS NULL THEN RAISE EXCEPTION 'Série não encontrada'; END IF;
  PERFORM set_config('app.bulk_op', 'on', true);
  CREATE TEMP TABLE IF NOT EXISTS _bg (s int, e int, ref text, title text, img text, dur int, url text, descr text, dt date, vote numeric, tmdb int,
    s_descr text, s_dt date, s_img text, s_tmdb int, season_id uuid, episode_id uuid) ON COMMIT DROP;
  TRUNCATE _bg;
  INSERT INTO _bg (s, e, ref, title, img, dur, url, descr, dt, vote, tmdb, s_descr, s_dt, s_img, s_tmdb)
  SELECT DISTINCT ON ((x->>'s')::int, (x->>'e')::int) (x->>'s')::int, (x->>'e')::int, left(x->>'ref', 200), left(coalesce(nullif(btrim(x->>'t'), ''), 'Episódio ' || (x->>'e')), 200),
    nullif(x->>'img', ''), nullif(x->>'dur', '')::int, x->>'url',
    left(nullif(btrim(x->>'d'), ''), 5000),
    CASE WHEN (x->>'dt') ~ '^\d{4}-\d{2}-\d{2}$' THEN (x->>'dt')::date END,
    CASE WHEN (x->>'v') ~ '^\d+(\.\d+)?$' AND (x->>'v')::numeric BETWEEN 0.1 AND 10 THEN (x->>'v')::numeric END,
    CASE WHEN (x->>'tm') ~ '^\d{1,9}$' THEN (x->>'tm')::int END,
    left(nullif(btrim(x->>'sd'), ''), 5000),
    CASE WHEN (x->>'sa') ~ '^\d{4}-\d{2}-\d{2}$' THEN (x->>'sa')::date END,
    nullif(x->>'sp', ''),
    CASE WHEN (x->>'st') ~ '^\d{1,9}$' THEN (x->>'st')::int END
  FROM jsonb_array_elements(_items) x WHERE (x->>'s') IS NOT NULL AND (x->>'e') IS NOT NULL
  ORDER BY (x->>'s')::int, (x->>'e')::int;
  GET DIAGNOSTICS n_items = ROW_COUNT;

  INSERT INTO public.seasons (series_id, season_number, title, status, sort_order)
  SELECT DISTINCT _series_id, s, 'Temporada ' || s, 'published'::public.content_status, s FROM _bg
  ON CONFLICT (series_id, season_number) DO NOTHING;
  GET DIAGNOSTICS n_seasons = ROW_COUNT;
  UPDATE _bg b SET season_id = x.id FROM public.seasons x WHERE x.series_id = _series_id AND x.season_number = b.s;

  -- Fill-only season metadata (never overwrites existing values).
  UPDATE public.seasons x SET
    description = coalesce(nullif(btrim(x.description), ''), m.s_descr),
    air_date = coalesce(x.air_date, m.s_dt),
    poster_url = coalesce(nullif(x.poster_url, ''), m.s_img),
    tmdb_id = coalesce(x.tmdb_id, m.s_tmdb)
  FROM (SELECT DISTINCT ON (season_id) season_id, s_descr, s_dt, s_img, s_tmdb FROM _bg WHERE season_id IS NOT NULL ORDER BY season_id, (s_descr IS NULL), (s_dt IS NULL)) m
  WHERE x.id = m.season_id
    AND ((nullif(btrim(x.description), '') IS NULL AND m.s_descr IS NOT NULL) OR (x.air_date IS NULL AND m.s_dt IS NOT NULL)
      OR (nullif(x.poster_url, '') IS NULL AND m.s_img IS NOT NULL) OR (x.tmdb_id IS NULL AND m.s_tmdb IS NOT NULL));
  GET DIAGNOSTICS n_smeta = ROW_COUNT;

  INSERT INTO public.episodes (season_id, episode_number, title, thumbnail_url, duration_minutes, description, release_date, vote_average, tmdb_id, status)
  SELECT season_id, e, title, img, dur, descr, dt, vote, tmdb, 'published'::public.content_status FROM _bg
  ON CONFLICT (season_id, episode_number) DO NOTHING;
  GET DIAGNOSTICS n_eps = ROW_COUNT;
  UPDATE _bg b SET episode_id = x.id FROM public.episodes x WHERE x.season_id = b.season_id AND x.episode_number = b.e;

  -- Fill-only episode metadata for rows that already existed.
  UPDATE public.episodes x SET
    description = coalesce(nullif(btrim(x.description), ''), b.descr),
    release_date = coalesce(x.release_date, b.dt),
    vote_average = coalesce(x.vote_average, b.vote),
    tmdb_id = coalesce(x.tmdb_id, b.tmdb),
    thumbnail_url = coalesce(nullif(x.thumbnail_url, ''), b.img),
    duration_minutes = coalesce(x.duration_minutes, b.dur)
  FROM _bg b
  WHERE x.id = b.episode_id
    AND ((nullif(btrim(x.description), '') IS NULL AND b.descr IS NOT NULL) OR (x.release_date IS NULL AND b.dt IS NOT NULL)
      OR (x.vote_average IS NULL AND b.vote IS NOT NULL) OR (x.tmdb_id IS NULL AND b.tmdb IS NOT NULL)
      OR (nullif(x.thumbnail_url, '') IS NULL AND b.img IS NOT NULL) OR (x.duration_minutes IS NULL AND b.dur IS NOT NULL));
  GET DIAGNOSTICS n_meta = ROW_COUNT;

  UPDATE public.playback_sources p SET url = b.url FROM _bg b
  WHERE p.content_kind = 'episode' AND p.content_id = b.episode_id AND p.external_ref = b.ref AND b.url IS NOT NULL AND p.url IS DISTINCT FROM b.url;
  GET DIAGNOSTICS n_src_upd = ROW_COUNT;

  INSERT INTO public.playback_sources (content_kind, content_id, url, source_type, provider, label, external_ref, is_active, is_primary, sort_order, drm)
  SELECT 'episode'::public.content_kind, b.episode_id, b.url, 'embed', 'BugouMods', 'BugouMods', b.ref, true, ex.n = 0, ex.n, '{}'::jsonb
  FROM _bg b CROSS JOIN LATERAL (SELECT count(*)::int n FROM public.playback_sources p WHERE p.content_kind = 'episode' AND p.content_id = b.episode_id) ex
  WHERE b.url IS NOT NULL AND b.episode_id IS NOT NULL
    AND NOT EXISTS (SELECT 1 FROM public.playback_sources p WHERE p.content_kind = 'episode' AND p.content_id = b.episode_id AND p.external_ref = b.ref);
  GET DIAGNOSTICS n_src_new = ROW_COUNT;

  SELECT count(*) INTO n_saved FROM _bg b JOIN public.episodes x ON x.id = b.episode_id JOIN public.seasons s ON s.id = x.season_id AND s.series_id = _series_id;
  SELECT count(*) INTO n_player FROM _bg b WHERE EXISTS (SELECT 1 FROM public.playback_sources p WHERE p.content_kind = 'episode' AND p.content_id = b.episode_id AND p.external_ref = b.ref AND p.is_active);

  IF n_seasons + n_eps + n_src_new + n_src_upd + n_meta + n_smeta > 0 THEN
    INSERT INTO public.audit_logs (actor_id, actor_role, action, entity, entity_id, changes, summary)
    VALUES (_actor, CASE WHEN _actor IS NULL THEN NULL ELSE (SELECT role::text FROM public.user_roles WHERE user_id = _actor ORDER BY role DESC LIMIT 1) END, 'import', 'series', _series_id::text,
      jsonb_build_object('seasons', n_seasons, 'episodes', n_eps, 'sources_new', n_src_new, 'sources_updated', n_src_upd, 'episodes_metadata', n_meta, 'seasons_metadata', n_smeta),
      'Importação BugouMods VIP em "' || left(t, 120) || '": ' || n_seasons || ' temporada(s), ' || n_eps || ' episódio(s), ' || n_src_new || ' player(s) novos, ' || n_meta || ' episódio(s) com metadados completados.');
  END IF;
  RETURN jsonb_build_object('items', n_items, 'seasons', n_seasons, 'episodes', n_eps, 'sources_new', n_src_new, 'sources_updated', n_src_upd, 'saved', n_saved, 'with_player', n_player, 'episodes_metadata', n_meta, 'seasons_metadata', n_smeta);
END; $function$;

REVOKE ALL ON FUNCTION public.bugou_apply_series(uuid, jsonb, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.bugou_apply_series(uuid, jsonb, uuid) TO service_role;