CREATE INDEX IF NOT EXISTS movies_original_title_trgm ON public.movies USING gin (original_title extensions.gin_trgm_ops);
CREATE INDEX IF NOT EXISTS series_original_title_trgm ON public.series USING gin (original_title extensions.gin_trgm_ops);
CREATE INDEX IF NOT EXISTS episodes_title_trgm ON public.episodes USING gin (title extensions.gin_trgm_ops);

-- Ranked, paginated title search (exact > prefix > partial), RLS applies (invoker).
CREATE OR REPLACE FUNCTION public.search_titles(_kind text, _term text, _page integer, _size integer)
RETURNS TABLE(id uuid, total bigint)
LANGUAGE sql STABLE SET search_path = public, extensions AS $$
  WITH q AS (SELECT lower(btrim(regexp_replace(coalesce(_term,''), '\s+', ' ', 'g'))) AS t),
  hits AS (
    SELECT m.id, lower(m.title) AS a, lower(coalesce(m.original_title,'')) AS b
      FROM movies m, q WHERE _kind = 'movie' AND m.status = 'published'
       AND (m.title ILIKE '%'||q.t||'%' OR m.original_title ILIKE '%'||q.t||'%')
    UNION ALL
    SELECT s.id, lower(s.title), lower(coalesce(s.original_title,''))
      FROM series s, q WHERE _kind = 'series' AND s.status = 'published'
       AND (s.title ILIKE '%'||q.t||'%' OR s.original_title ILIKE '%'||q.t||'%')
  )
  SELECT h.id, count(*) OVER () AS total FROM hits h, q
  ORDER BY CASE WHEN h.a = q.t OR h.b = q.t THEN 0
                WHEN h.a LIKE q.t||'%' OR h.b LIKE q.t||'%' THEN 1
                WHEN h.a LIKE '% '||q.t||'%' THEN 2 ELSE 3 END,
           length(h.a), h.a, h.id
  OFFSET greatest(_page - 1, 0) * _size LIMIT least(greatest(_size, 1), 60);
$$;
GRANT EXECUTE ON FUNCTION public.search_titles(text, text, integer, integer) TO anon, authenticated;