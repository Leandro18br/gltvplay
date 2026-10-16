DO $$
DECLARE f text; src text;
BEGIN
  FOREACH f IN ARRAY ARRAY['public.complete_tmdb_metadata(text,uuid,jsonb,integer[])','public.apply_tmdb_extras(text,uuid,jsonb,jsonb,jsonb)'] LOOP
    src := pg_get_functiondef(f::regprocedure);
    src := replace(src, 'IF auth.uid() IS NULL OR NOT public.is_staff(auth.uid()) THEN', 'IF coalesce(auth.role(), '''') <> ''service_role'' AND (auth.uid() IS NULL OR NOT public.is_staff(auth.uid())) THEN');
    IF position('service_role' in src) = 0 THEN RAISE EXCEPTION 'guard not found in %', f; END IF;
    EXECUTE src;
  END LOOP;
END $$;
REVOKE EXECUTE ON FUNCTION public.complete_tmdb_metadata(text,uuid,jsonb,integer[]) FROM anon;
REVOKE EXECUTE ON FUNCTION public.apply_tmdb_extras(text,uuid,jsonb,jsonb,jsonb) FROM anon;