ALTER TABLE public.movies ADD COLUMN IF NOT EXISTS production_companies text[], ADD COLUMN IF NOT EXISTS production_countries text[];
ALTER TABLE public.series ADD COLUMN IF NOT EXISTS production_companies text[], ADD COLUMN IF NOT EXISTS production_countries text[], ADD COLUMN IF NOT EXISTS last_air_date date, ADD COLUMN IF NOT EXISTS in_production boolean, ADD COLUMN IF NOT EXISTS networks text[];

CREATE TABLE public.content_credits (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  content_kind public.content_kind NOT NULL,
  content_id uuid NOT NULL,
  tmdb_credit_id text NOT NULL,
  tmdb_person_id integer,
  credit_type text NOT NULL CHECK (credit_type IN ('cast','crew')),
  name text NOT NULL,
  character text,
  job text,
  department text,
  profile_url text,
  sort_order integer NOT NULL DEFAULT 0,
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (content_kind, content_id, tmdb_credit_id)
);
CREATE INDEX content_credits_content_idx ON public.content_credits(content_kind, content_id, credit_type, sort_order);
GRANT SELECT ON public.content_credits TO anon, authenticated;
GRANT INSERT, UPDATE, DELETE ON public.content_credits TO authenticated;
GRANT ALL ON public.content_credits TO service_role;
ALTER TABLE public.content_credits ENABLE ROW LEVEL SECURITY;
CREATE POLICY "credits public read" ON public.content_credits FOR SELECT TO anon, authenticated USING (true);
CREATE POLICY "credits staff write" ON public.content_credits FOR ALL TO authenticated USING (public.is_staff(auth.uid())) WITH CHECK (public.is_staff(auth.uid()));

CREATE TABLE public.content_videos (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  content_kind public.content_kind NOT NULL,
  content_id uuid NOT NULL,
  tmdb_video_id text NOT NULL,
  name text,
  video_type text,
  site text,
  video_key text NOT NULL,
  iso_639_1 text,
  iso_3166_1 text,
  official boolean,
  published_at timestamptz,
  is_primary boolean NOT NULL DEFAULT false,
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (content_kind, content_id, tmdb_video_id)
);
CREATE INDEX content_videos_content_idx ON public.content_videos(content_kind, content_id);
GRANT SELECT ON public.content_videos TO anon, authenticated;
GRANT INSERT, UPDATE, DELETE ON public.content_videos TO authenticated;
GRANT ALL ON public.content_videos TO service_role;
ALTER TABLE public.content_videos ENABLE ROW LEVEL SECURITY;
CREATE POLICY "videos public read" ON public.content_videos FOR SELECT TO anon, authenticated USING (true);
CREATE POLICY "videos staff write" ON public.content_videos FOR ALL TO authenticated USING (public.is_staff(auth.uid())) WITH CHECK (public.is_staff(auth.uid()));

-- Fill-only extras + idempotent credits/videos upsert. Never touches playback, seasons or episodes.
CREATE OR REPLACE FUNCTION public.apply_tmdb_extras(_kind text, _id uuid, _patch jsonb, _credits jsonb, _videos jsonb)
RETURNS jsonb LANGUAGE plpgsql SET search_path = public AS $$
DECLARE tab text; allowed text[]; cur jsonb; applied jsonb := '{}'; k text; v jsonb; assignments text; filled int := 0; nc int := 0; nv int := 0;
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_staff(auth.uid()) THEN RAISE EXCEPTION 'Acesso negado'; END IF;
  IF _kind = 'movie' THEN tab := 'movies'; allowed := ARRAY['age_rating','trailer_url','production_companies','production_countries'];
  ELSIF _kind = 'series' THEN tab := 'series'; allowed := ARRAY['age_rating','trailer_url','production_companies','production_countries','last_air_date','in_production','networks'];
  ELSE RAISE EXCEPTION 'Tipo inválido'; END IF;
  EXECUTE format('SELECT to_jsonb(t) FROM public.%I t WHERE id = $1 FOR UPDATE', tab) INTO cur USING _id;
  IF cur IS NULL THEN RAISE EXCEPTION 'Conteúdo não encontrado'; END IF;
  FOR k, v IN SELECT key, value FROM jsonb_each(coalesce(_patch,'{}')) LOOP
    IF NOT k = ANY(allowed) OR v = 'null'::jsonb OR v = '[]'::jsonb OR btrim(v #>> '{}') = '' THEN CONTINUE; END IF;
    IF k = 'in_production' THEN
      IF cur->k IS NOT DISTINCT FROM v THEN CONTINUE; END IF; -- TMDB-owned status
    ELSIF NOT (cur->k IS NULL OR cur->k = 'null'::jsonb OR cur->k = '[]'::jsonb OR btrim(cur->>k) = '') THEN CONTINUE; END IF;
    applied := applied || jsonb_build_object(k, v);
  END LOOP;
  SELECT string_agg(format('%I = src.%I', key, key), ', '), count(*) INTO assignments, filled FROM jsonb_each(applied);
  IF filled > 0 THEN
    EXECUTE format('UPDATE public.%I t SET %s FROM jsonb_populate_record(NULL::public.%I, $1) src WHERE t.id = $2', tab, assignments, tab) USING applied, _id;
  END IF;
  INSERT INTO public.content_credits(content_kind, content_id, tmdb_credit_id, tmdb_person_id, credit_type, name, character, job, department, profile_url, sort_order)
  SELECT _kind::public.content_kind, _id, c->>'credit_id', (c->>'person_id')::int, c->>'type', c->>'name', nullif(c->>'character',''), nullif(c->>'job',''), nullif(c->>'department',''), nullif(c->>'profile_url',''), coalesce((c->>'order')::int, 0)
  FROM jsonb_array_elements(coalesce(_credits,'[]')) c
  WHERE coalesce(c->>'credit_id','') <> '' AND coalesce(c->>'name','') <> '' AND c->>'type' IN ('cast','crew')
  ON CONFLICT (content_kind, content_id, tmdb_credit_id) DO UPDATE SET name = excluded.name, character = coalesce(excluded.character, content_credits.character), job = coalesce(excluded.job, content_credits.job), department = coalesce(excluded.department, content_credits.department), profile_url = coalesce(excluded.profile_url, content_credits.profile_url), sort_order = excluded.sort_order, tmdb_person_id = coalesce(excluded.tmdb_person_id, content_credits.tmdb_person_id), updated_at = now();
  GET DIAGNOSTICS nc = ROW_COUNT;
  IF jsonb_array_length(coalesce(_videos,'[]')) > 0 THEN
    UPDATE public.content_videos SET is_primary = false WHERE content_kind = _kind::public.content_kind AND content_id = _id AND is_primary;
  END IF;
  INSERT INTO public.content_videos(content_kind, content_id, tmdb_video_id, name, video_type, site, video_key, iso_639_1, iso_3166_1, official, published_at, is_primary)
  SELECT _kind::public.content_kind, _id, x->>'id', x->>'name', x->>'type', x->>'site', x->>'key', x->>'iso_639_1', x->>'iso_3166_1', (x->>'official')::boolean, (x->>'published_at')::timestamptz, coalesce((x->>'primary')::boolean, false)
  FROM jsonb_array_elements(coalesce(_videos,'[]')) x
  WHERE coalesce(x->>'id','') <> '' AND coalesce(x->>'key','') <> ''
  ON CONFLICT (content_kind, content_id, tmdb_video_id) DO UPDATE SET name = excluded.name, video_type = excluded.video_type, site = excluded.site, video_key = excluded.video_key, iso_639_1 = excluded.iso_639_1, iso_3166_1 = excluded.iso_3166_1, official = excluded.official, published_at = excluded.published_at, is_primary = excluded.is_primary, updated_at = now();
  GET DIAGNOSTICS nv = ROW_COUNT;
  RETURN jsonb_build_object('filled', filled, 'fields', applied, 'credits', nc, 'videos', nv);
END $$;
GRANT EXECUTE ON FUNCTION public.apply_tmdb_extras(text, uuid, jsonb, jsonb, jsonb) TO authenticated;