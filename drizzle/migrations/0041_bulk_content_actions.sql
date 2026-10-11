CREATE OR REPLACE FUNCTION public.audit_trigger() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $fn$
DECLARE
  o jsonb := CASE WHEN TG_OP <> 'INSERT' THEN to_jsonb(OLD) END;
  n jsonb := CASE WHEN TG_OP <> 'DELETE' THEN to_jsonb(NEW) END;
  label text; verb text; title text; who text; role text; recent int;
BEGIN
  -- Bulk RPCs write one summary audit row themselves.
  IF current_setting('app.bulk_op', true) = 'on' THEN RETURN COALESCE(NEW, OLD); END IF;
  IF auth.uid() IS NOT NULL AND TG_TABLE_NAME NOT IN ('profiles') THEN
    SELECT count(*) INTO recent FROM audit_logs WHERE actor_id = auth.uid() AND created_at > now() - interval '1 minute';
    IF recent > 300 THEN RAISE EXCEPTION 'rate limit exceeded, try again in a minute'; END IF;
  END IF;
  label := CASE TG_TABLE_NAME WHEN 'movies' THEN 'o filme' WHEN 'series' THEN 'a série' WHEN 'seasons' THEN 'a temporada'
    WHEN 'episodes' THEN 'o episódio' WHEN 'channels' THEN 'o canal' WHEN 'categories' THEN 'a categoria' WHEN 'genres' THEN 'o gênero'
    WHEN 'banners' THEN 'o banner' WHEN 'site_settings' THEN 'as configurações' WHEN 'playback_sources' THEN 'a fonte de reprodução'
    WHEN 'user_roles' THEN 'a permissão' WHEN 'profiles' THEN 'o usuário' ELSE TG_TABLE_NAME END;
  title := COALESCE(n->>'title', n->>'name', o->>'title', o->>'name', n->>'role', o->>'role',
    CASE WHEN TG_TABLE_NAME = 'seasons' THEN 'T' || COALESCE(n->>'season_number', o->>'season_number') END, '');
  verb := CASE TG_OP WHEN 'INSERT' THEN 'adicionou' WHEN 'DELETE' THEN 'excluiu' ELSE
    CASE
      WHEN o ? 'status' AND (o->>'status') IS DISTINCT FROM (n->>'status') THEN
        CASE n->>'status' WHEN 'published' THEN 'publicou' WHEN 'archived' THEN 'desativou' WHEN 'draft' THEN 'moveu para rascunho'
          WHEN 'suspended' THEN 'suspendeu' WHEN 'banned' THEN 'baniu' WHEN 'active' THEN 'reativou' ELSE 'alterou' END
      WHEN o ? 'is_active' AND (o->>'is_active') IS DISTINCT FROM (n->>'is_active') THEN
        CASE WHEN (n->>'is_active')::boolean THEN 'ativou' ELSE 'desativou' END
      WHEN o ? 'featured' AND (o->>'featured') IS DISTINCT FROM (n->>'featured') THEN
        CASE WHEN (n->>'featured')::boolean THEN 'destacou' ELSE 'removeu o destaque de' END
      ELSE 'alterou' END END;
  SELECT COALESCE(p.name, p.email) INTO who FROM profiles p WHERE p.id = auth.uid();
  role := public.my_role();
  INSERT INTO public.audit_logs (actor_id, actor_role, action, entity, entity_id, changes, summary)
  VALUES (auth.uid(), role, lower(TG_OP), TG_TABLE_NAME, COALESCE(n->>'id', o->>'id'),
    jsonb_build_object('old', o, 'new', n),
    trim(COALESCE(CASE role WHEN 'super_admin' THEN 'Super admin ' WHEN 'admin' THEN 'Administrador ' WHEN 'editor' THEN 'Editor ' ELSE '' END || who, 'Sistema')
      || ' ' || verb || ' ' || label || CASE WHEN title <> '' THEN ' "' || left(title, 120) || '"' ELSE '' END || '.'));
  RETURN COALESCE(NEW, OLD);
END; $fn$;

-- Episodes are public only when their series is published too.
DROP POLICY IF EXISTS "public read" ON public.episodes;
CREATE POLICY "public read" ON public.episodes FOR SELECT USING (
  status = 'published'::content_status
  AND (SELECT public.has_site_access(auth.uid()))
  AND EXISTS (SELECT 1 FROM public.seasons se JOIN public.series s ON s.id = se.series_id
              WHERE se.id = episodes.season_id AND s.status = 'published'::content_status));

CREATE OR REPLACE FUNCTION public.admin_bulk_content(_kind text, _action text, _ids uuid[])
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $fn$
DECLARE
  me uuid := auth.uid();
  found uuid[]; ep uuid[]; n int := 0; eps int := 0; seas int := 0;
  tbl text; ck content_kind; label text;
BEGIN
  IF me IS NULL THEN RAISE EXCEPTION 'not authenticated'; END IF;
  IF _kind NOT IN ('movie','series','channel') THEN RAISE EXCEPTION 'invalid kind'; END IF;
  IF _action NOT IN ('draft','delete') THEN RAISE EXCEPTION 'invalid action'; END IF;
  IF _action = 'draft' AND NOT public.is_staff(me) THEN RAISE EXCEPTION 'forbidden'; END IF;
  IF _action = 'delete' AND NOT public.is_admin(me) THEN RAISE EXCEPTION 'forbidden'; END IF;
  IF coalesce(array_length(_ids,1),0) = 0 THEN RETURN jsonb_build_object('requested',0,'affected',0,'missing','[]'::jsonb); END IF;
  IF array_length(_ids,1) > 1000 THEN RAISE EXCEPTION 'too many ids (max 1000)'; END IF;
  PERFORM set_config('app.bulk_op','on',true);
  tbl := CASE _kind WHEN 'movie' THEN 'movies' WHEN 'series' THEN 'series' ELSE 'channels' END;
  ck := _kind::content_kind;
  label := CASE _kind WHEN 'movie' THEN 'filme(s)' WHEN 'series' THEN 'série(s)' ELSE 'canal(is)' END;
  EXECUTE format('SELECT coalesce(array_agg(id), ''{}'') FROM public.%I WHERE id = ANY($1)', tbl) INTO found USING _ids;

  IF _action = 'draft' THEN
    EXECUTE format('UPDATE public.%I SET status = ''draft'' WHERE id = ANY($1)', tbl) USING found;
    n := coalesce(array_length(found,1),0);
  ELSE
    IF _kind = 'series' THEN
      SELECT coalesce(array_agg(e.id),'{}'), count(*) INTO ep, eps FROM episodes e JOIN seasons se ON se.id = e.season_id WHERE se.series_id = ANY(found);
      SELECT count(*) INTO seas FROM seasons WHERE series_id = ANY(found);
      DELETE FROM playback_sources WHERE content_kind = 'episode' AND content_id = ANY(ep);
      DELETE FROM watch_history WHERE (content_kind = 'episode' AND content_id = ANY(ep)) OR (content_kind = 'series' AND content_id = ANY(found));
      DELETE FROM watchlist WHERE (content_kind = 'episode' AND content_id = ANY(ep)) OR (content_kind = 'series' AND content_id = ANY(found));
      UPDATE m3u_items SET content_id = NULL, imported_at = NULL WHERE content_id = ANY(found) OR content_id = ANY(ep);
    ELSE
      DELETE FROM playback_sources WHERE content_kind = ck AND content_id = ANY(found);
      DELETE FROM watch_history WHERE content_kind = ck AND content_id = ANY(found);
      DELETE FROM watchlist WHERE content_kind = ck AND content_id = ANY(found);
      UPDATE m3u_items SET content_id = NULL, imported_at = NULL WHERE content_id = ANY(found);
    END IF;
    UPDATE banners SET content_id = NULL, content_kind = NULL WHERE content_id = ANY(found);
    EXECUTE format('DELETE FROM public.%I WHERE id = ANY($1)', tbl) USING found;
    GET DIAGNOSTICS n = ROW_COUNT;
  END IF;

  INSERT INTO audit_logs (actor_id, actor_role, action, entity, entity_id, changes, summary)
  VALUES (me, public.my_role(), CASE _action WHEN 'draft' THEN 'bulk_draft' ELSE 'bulk_delete' END, tbl, NULL,
    jsonb_build_object('ids', to_jsonb(found), 'seasons', seas, 'episodes', eps),
    CASE _action WHEN 'draft' THEN 'Moveu para rascunho ' ELSE 'Excluiu ' END || n || ' ' || label ||
      CASE WHEN eps > 0 THEN ' (' || seas || ' temporada(s), ' || eps || ' episódio(s))' ELSE '' END || ' em massa.');

  RETURN jsonb_build_object('requested', array_length(_ids,1), 'affected', n, 'seasons', seas, 'episodes', eps,
    'missing', (SELECT coalesce(jsonb_agg(x),'[]'::jsonb) FROM unnest(_ids) x WHERE NOT x = ANY(found)));
END; $fn$;

REVOKE ALL ON FUNCTION public.admin_bulk_content(text,text,uuid[]) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.admin_bulk_content(text,text,uuid[]) TO authenticated;