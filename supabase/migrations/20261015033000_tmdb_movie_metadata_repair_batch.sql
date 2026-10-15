-- Staff-triggered TMDB repair uses the service-role client after authorization.
-- Return only incomplete movies in stable keyset order so completed rows are not rescanned.
CREATE OR REPLACE FUNCTION public.tmdb_movies_needing_metadata_batch(
  _after uuid DEFAULT NULL,
  _limit integer DEFAULT 5
)
RETURNS TABLE(id uuid)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
  SELECT m.id
  FROM public.movies AS m
  WHERE (_after IS NULL OR m.id > _after)
    AND (
      NULLIF(BTRIM(m.description), '') IS NULL
      OR NULLIF(BTRIM(m.original_title), '') IS NULL
      OR m.tmdb_id IS NULL
      OR m.release_date IS NULL
      OR NULLIF(BTRIM(m.poster_url), '') IS NULL
      OR NULLIF(BTRIM(m.backdrop_url), '') IS NULL
      OR NOT EXISTS (
        SELECT 1
        FROM public.movie_genres AS mg
        WHERE mg.movie_id = m.id
      )
    )
  ORDER BY m.id
  LIMIT LEAST(GREATEST(COALESCE(_limit, 5), 1), 25);
$$;

REVOKE ALL ON FUNCTION public.tmdb_movies_needing_metadata_batch(uuid, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.tmdb_movies_needing_metadata_batch(uuid, integer) TO service_role;
