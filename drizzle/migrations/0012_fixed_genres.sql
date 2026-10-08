ALTER TABLE public.genres ADD COLUMN IF NOT EXISTS tmdb_genre_ids integer[] NOT NULL DEFAULT '{}';
ALTER TABLE public.genres ADD COLUMN IF NOT EXISTS is_fixed boolean NOT NULL DEFAULT false;

CREATE OR REPLACE FUNCTION public.norm_genre(t text) RETURNS text LANGUAGE sql IMMUTABLE SET search_path = public AS $$
  SELECT regexp_replace(lower(translate(coalesce(t,''), 'ÁÀÂÃÄáàâãäÉÈÊËéèêëÍÌÎÏíìîïÓÒÔÕÖóòôõöÚÙÛÜúùûüÇç', 'AAAAAaaaaaEEEEeeeeIIIIiiiiOOOOOoooooUUUUuuuuCc')), '[^a-z0-9]+', '', 'g')
$$;

CREATE OR REPLACE FUNCTION public.ensure_fixed_genres() RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE r record; gid uuid;
BEGIN
  FOR r IN SELECT * FROM (VALUES
    ('Ação','acao',ARRAY[28,10759],ARRAY['acao','action']),
    ('Aventura','aventura',ARRAY[12,10759],ARRAY['aventura','adventure']),
    ('Animação','animacao',ARRAY[16],ARRAY['animacao','animation']),
    ('Comédia','comedia',ARRAY[35],ARRAY['comedia','comedy']),
    ('Crime','crime',ARRAY[80],ARRAY['crime']),
    ('Documentário','documentario',ARRAY[99],ARRAY['documentario','documentary']),
    ('Drama','drama',ARRAY[18],ARRAY['drama']),
    ('Família','familia',ARRAY[10751],ARRAY['familia','family']),
    ('Fantasia','fantasia',ARRAY[14,10765],ARRAY['fantasia','fantasy']),
    ('História','historia',ARRAY[36],ARRAY['historia','history']),
    ('Terror','terror',ARRAY[27],ARRAY['terror','horror']),
    ('Música','musica',ARRAY[10402],ARRAY['musica','music']),
    ('Mistério','misterio',ARRAY[9648],ARRAY['misterio','mystery']),
    ('Romance','romance',ARRAY[10749],ARRAY['romance']),
    ('Ficção Científica','ficcao-cientifica',ARRAY[878,10765],ARRAY['ficcaocientifica','sciencefiction']),
    ('Cinema TV','cinema-tv',ARRAY[10770],ARRAY['cinematv','tvmovie']),
    ('Thriller / Suspense','thriller-suspense',ARRAY[53],ARRAY['thrillersuspense','thriller','suspense']),
    ('Guerra','guerra',ARRAY[10752,10768],ARRAY['guerra','war']),
    ('Faroeste','faroeste',ARRAY[37],ARRAY['faroeste','western'])
  ) AS v(name, slug, ids, aliases)
  LOOP
    SELECT id INTO gid FROM public.genres WHERE public.norm_genre(name) = ANY(r.aliases) OR slug = r.slug ORDER BY (slug = r.slug) DESC, created_at LIMIT 1;
    IF gid IS NULL THEN
      INSERT INTO public.genres(name, slug, tmdb_genre_ids, is_fixed) VALUES (r.name, r.slug, r.ids, true);
    ELSE
      UPDATE public.genres SET tmdb_genre_ids = r.ids, is_fixed = true WHERE id = gid;
    END IF;
  END LOOP;
END $$;
REVOKE ALL ON FUNCTION public.ensure_fixed_genres() FROM PUBLIC, anon, authenticated;

SELECT public.ensure_fixed_genres();