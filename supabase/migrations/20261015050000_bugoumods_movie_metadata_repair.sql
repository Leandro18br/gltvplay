-- Staff-only, non-destructive keyset scan of BugouMods movies with missing synopsis or genre links.
CREATE OR REPLACE FUNCTION public.bugoumods_movies_needing_metadata_batch(
  _after uuid DEFAULT NULL,
  _limit integer DEFAULT 5
)
RETURNS TABLE(id uuid, title text, release_year integer, external_id text, description text)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
  SELECT m.id, m.title::text, m.release_year, COALESCE(CASE WHEN m.external_source = 'bugoumods' THEN m.external_id::text END,
    (SELECT regexp_replace(ps.external_ref, '^bugoumods:', '') FROM public.playback_sources AS ps
     WHERE ps.content_kind = 'movie' AND ps.content_id = m.id AND ps.external_ref ~ '^bugoumods:[0-9]+
  FROM public.movies AS m
  WHERE (m.external_source = 'bugoumods' OR EXISTS (
      SELECT 1 FROM public.playback_sources AS ps
      WHERE ps.content_kind = 'movie' AND ps.content_id = m.id
        AND ps.external_ref ~ '^bugoumods:[0-9]+
    AND (
      NULLIF(BTRIM(m.description), '') IS NULL
      OR NOT EXISTS (
        SELECT 1 FROM public.movie_genres AS mg WHERE mg.movie_id = m.id
      )
    )
  ORDER BY m.id
  LIMIT LEAST(GREATEST(COALESCE(_limit, 5), 1), 10);
$$;

REVOKE ALL ON FUNCTION public.bugoumods_movies_needing_metadata_batch(uuid, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.bugoumods_movies_needing_metadata_batch(uuid, integer) TO service_role;

    ))
    AND (_after IS NULL OR m.id > _after)
    AND (
      NULLIF(BTRIM(m.description), '') IS NULL
      OR NOT EXISTS (
        SELECT 1 FROM public.movie_genres AS mg WHERE mg.movie_id = m.id
      )
    )
  ORDER BY m.id
  LIMIT LEAST(GREATEST(COALESCE(_limit, 5), 1), 10);
$$;

REVOKE ALL ON FUNCTION public.bugoumods_movies_needing_metadata_batch(uuid, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.bugoumods_movies_needing_metadata_batch(uuid, integer) TO service_role;

     ORDER BY ps.sort_order NULLS LAST LIMIT 1)), m.description::text
  FROM public.movies AS m
  WHERE (m.external_source = 'bugoumods' OR EXISTS (
      SELECT 1 FROM public.playback_sources AS ps
      WHERE ps.content_kind = 'movie' AND ps.content_id = m.id
        AND ps.external_ref ~ '^bugoumods:[0-9]+
    AND (
      NULLIF(BTRIM(m.description), '') IS NULL
      OR NOT EXISTS (
        SELECT 1 FROM public.movie_genres AS mg WHERE mg.movie_id = m.id
      )
    )
  ORDER BY m.id
  LIMIT LEAST(GREATEST(COALESCE(_limit, 5), 1), 10);
$$;

REVOKE ALL ON FUNCTION public.bugoumods_movies_needing_metadata_batch(uuid, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.bugoumods_movies_needing_metadata_batch(uuid, integer) TO service_role;

    ))
    AND (_after IS NULL OR m.id > _after)
    AND (
      NULLIF(BTRIM(m.description), '') IS NULL
      OR NOT EXISTS (
        SELECT 1 FROM public.movie_genres AS mg WHERE mg.movie_id = m.id
      )
    )
  ORDER BY m.id
  LIMIT LEAST(GREATEST(COALESCE(_limit, 5), 1), 10);
$$;

REVOKE ALL ON FUNCTION public.bugoumods_movies_needing_metadata_batch(uuid, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.bugoumods_movies_needing_metadata_batch(uuid, integer) TO service_role;
