CREATE OR REPLACE FUNCTION public.my_credit_balance()
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE me uuid := auth.uid(); bal int;
BEGIN
  IF me IS NULL THEN RAISE EXCEPTION 'forbidden'; END IF;
  IF public.is_super_admin(me) THEN RETURN jsonb_build_object('unlimited', true, 'credits', null); END IF;
  SELECT credits INTO bal FROM public.resellers WHERE user_id = me;
  IF NOT FOUND THEN RAISE EXCEPTION 'forbidden'; END IF;
  RETURN jsonb_build_object('unlimited', false, 'credits', bal);
END $$;
REVOKE ALL ON FUNCTION public.my_credit_balance() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.my_credit_balance() TO authenticated;