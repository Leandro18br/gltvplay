-- lovable-cron-fallback-reviewed: queue worker armed on enqueue and unscheduled by the worker after the series queue drains; Workers cannot keep a request alive after the browser closes.
CREATE EXTENSION IF NOT EXISTS pg_cron;
CREATE EXTENSION IF NOT EXISTS pg_net;

CREATE OR REPLACE FUNCTION public.bugou_apply_series(_series_id uuid, _items jsonb, _actor uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE n_items int; n_seasons int := 0; n_eps int := 0; n_src_new int := 0; n_src_upd int := 0; n_saved int; n_player int; t text;
BEGIN
  SELECT title INTO t FROM public.series WHERE id = _series_id;
  IF t IS NULL THEN RAISE EXCEPTION 'Série não encontrada'; END IF;
  PERFORM set_config('app.bulk_op', 'on', true);
  CREATE TEMP TABLE IF NOT EXISTS _bg (s int, e int, ref text, title text, img text, dur int, url text, season_id uuid, episode_id uuid) ON COMMIT DROP;
  TRUNCATE _bg;
  INSERT INTO _bg (s, e, ref, title, img, dur, url)
  SELECT DISTINCT ON ((x->>'s')::int, (x->>'e')::int) (x->>'s')::int, (x->>'e')::int, left(x->>'ref', 200), left(coalesce(nullif(btrim(x->>'t'), ''), 'Episódio ' || (x->>'e')), 200),
    nullif(x->>'img', ''), nullif(x->>'dur', '')::int, x->>'url'
  FROM jsonb_array_elements(_items) x WHERE (x->>'s') IS NOT NULL AND (x->>'e') IS NOT NULL
  ORDER BY (x->>'s')::int, (x->>'e')::int;
  GET DIAGNOSTICS n_items = ROW_COUNT;

  INSERT INTO public.seasons (series_id, season_number, title, status, sort_order)
  SELECT DISTINCT _series_id, s, 'Temporada ' || s, 'published'::public.content_status, s FROM _bg
  ON CONFLICT (series_id, season_number) DO NOTHING;
  GET DIAGNOSTICS n_seasons = ROW_COUNT;
  UPDATE _bg b SET season_id = x.id FROM public.seasons x WHERE x.series_id = _series_id AND x.season_number = b.s;

  INSERT INTO public.episodes (season_id, episode_number, title, thumbnail_url, duration_minutes, status)
  SELECT season_id, e, title, img, dur, 'published'::public.content_status FROM _bg
  ON CONFLICT (season_id, episode_number) DO NOTHING;
  GET DIAGNOSTICS n_eps = ROW_COUNT;
  UPDATE _bg b SET episode_id = x.id FROM public.episodes x WHERE x.season_id = b.season_id AND x.episode_number = b.e;

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

  IF n_seasons + n_eps + n_src_new + n_src_upd > 0 THEN
    INSERT INTO public.audit_logs (actor_id, actor_role, action, entity, entity_id, changes, summary)
    VALUES (_actor, CASE WHEN _actor IS NULL THEN NULL ELSE (SELECT role::text FROM public.user_roles WHERE user_id = _actor ORDER BY role DESC LIMIT 1) END, 'import', 'series', _series_id::text,
      jsonb_build_object('seasons', n_seasons, 'episodes', n_eps, 'sources_new', n_src_new, 'sources_updated', n_src_upd),
      'Importação BugouMods VIP em "' || left(t, 120) || '": ' || n_seasons || ' temporada(s), ' || n_eps || ' episódio(s), ' || n_src_new || ' player(s) novos.');
  END IF;
  RETURN jsonb_build_object('items', n_items, 'seasons', n_seasons, 'episodes', n_eps, 'sources_new', n_src_new, 'sources_updated', n_src_upd, 'saved', n_saved, 'with_player', n_player);
END; $$;
REVOKE ALL ON FUNCTION public.bugou_apply_series(uuid, jsonb, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.bugou_apply_series(uuid, jsonb, uuid) TO service_role;

CREATE OR REPLACE FUNCTION public.bugou_worker_arm(_url text, _key text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
BEGIN
  IF _url !~ '^https://[a-z0-9.-]+\.lovable\.app/api/public/hooks/bugou-import$' THEN RAISE EXCEPTION 'URL inválida'; END IF;
  PERFORM cron.schedule('bugou-import-worker', '* * * * *', format(
    $c$select net.http_post(url := %L, headers := jsonb_build_object('Content-Type','application/json','Authorization','Bearer ' || %L), body := '{}'::jsonb, timeout_milliseconds := 58000)$c$, _url, _key));
END; $$;
CREATE OR REPLACE FUNCTION public.bugou_worker_disarm()
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'bugou-import-worker') THEN PERFORM cron.unschedule('bugou-import-worker'); END IF;
END; $$;
REVOKE ALL ON FUNCTION public.bugou_worker_arm(text, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.bugou_worker_disarm() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.bugou_worker_arm(text, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.bugou_worker_disarm() TO service_role;