CREATE OR REPLACE FUNCTION public.complete_tmdb_metadata(_kind text, _id uuid, _patch jsonb, _genre_ids integer[] DEFAULT '{}') RETURNS jsonb
LANGUAGE plpgsql SECURITY INVOKER SET search_path = public AS $$
DECLARE
  tab text; allowed text[]; current_row jsonb; applied jsonb := '{}'; k text; v jsonb; assignments text; filled integer := 0; genre_count integer := 0;
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_staff(auth.uid()) THEN RAISE EXCEPTION 'Acesso negado'; END IF;
  CASE _kind
    WHEN 'movie' THEN tab := 'movies'; allowed := ARRAY['tmdb_id','imdb_id','title','original_title','description','release_date','release_year','duration_minutes','poster_url','backdrop_url','poster_path','backdrop_path','vote_average','vote_count','popularity','tagline','tmdb_status','language','country'];
    WHEN 'series' THEN tab := 'series'; allowed := ARRAY['tmdb_id','imdb_id','title','original_title','description','first_air_date','release_year','poster_url','backdrop_url','poster_path','backdrop_path','vote_average','vote_count','popularity','tagline','tmdb_status','language','country','number_of_seasons','number_of_episodes'];
    WHEN 'season' THEN tab := 'seasons'; allowed := ARRAY['tmdb_id','title','description','air_date','poster_url'];
    WHEN 'episode' THEN tab := 'episodes'; allowed := ARRAY['tmdb_id','title','original_title','description','release_date','duration_minutes','vote_average','vote_count','still_path','thumbnail_url'];
    ELSE RAISE EXCEPTION 'Tipo inválido';
  END CASE;
  EXECUTE format('SELECT to_jsonb(t) FROM public.%I t WHERE id = $1 FOR UPDATE', tab) INTO current_row USING _id;
  IF current_row IS NULL THEN RAISE EXCEPTION 'Conteúdo não encontrado'; END IF;
  FOR k, v IN SELECT key, value FROM jsonb_each(_patch) LOOP
    IF NOT k = ANY(allowed) OR v = 'null'::jsonb OR btrim(v #>> '{}') = '' THEN CONTINUE; END IF;
    IF NOT (current_row->k IS NULL OR current_row->k = 'null'::jsonb OR btrim(current_row->>k) = '' OR (k = ANY(ARRAY['tmdb_id','release_year','duration_minutes','number_of_seasons','number_of_episodes']) AND current_row->>k = '0')) THEN CONTINUE; END IF;
    IF k = 'poster_path' AND coalesce(btrim(current_row->>'poster_url'),'') <> '' THEN CONTINUE; END IF;
    IF k = 'backdrop_path' AND coalesce(btrim(current_row->>'backdrop_url'),'') <> '' THEN CONTINUE; END IF;
    IF k = 'still_path' AND coalesce(btrim(current_row->>'thumbnail_url'),'') <> '' THEN CONTINUE; END IF;
    applied := applied || jsonb_build_object(k,v);
  END LOOP;
  SELECT string_agg(format('%I = src.%I', key, key), ', '), count(*) INTO assignments, filled FROM jsonb_each(applied);
  IF filled > 0 THEN
    EXECUTE format('UPDATE public.%I t SET %s FROM jsonb_populate_record(NULL::public.%I, $1) src WHERE t.id = $2', tab, assignments, tab) USING applied, _id;
  END IF;
  IF _kind = 'movie' THEN
    INSERT INTO public.movie_genres(movie_id,genre_id) SELECT _id,id FROM public.genres WHERE tmdb_genre_ids && _genre_ids ON CONFLICT DO NOTHING;
    GET DIAGNOSTICS genre_count = ROW_COUNT;
  ELSIF _kind = 'series' THEN
    INSERT INTO public.series_genres(series_id,genre_id) SELECT _id,id FROM public.genres WHERE tmdb_genre_ids && _genre_ids ON CONFLICT DO NOTHING;
    GET DIAGNOSTICS genre_count = ROW_COUNT;
  END IF;
  RETURN jsonb_build_object('filled',filled,'genres',genre_count,'fields',applied);
END;
$$;
REVOKE ALL ON FUNCTION public.complete_tmdb_metadata(text,uuid,jsonb,integer[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.complete_tmdb_metadata(text,uuid,jsonb,integer[]) TO authenticated;