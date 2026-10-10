CREATE OR REPLACE FUNCTION public.my_client_name()
RETURNS text
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT nullif(btrim(client_name), '')
  FROM public.access_accounts
  WHERE auth_user_id = auth.uid() AND status <> 'deleted'
  ORDER BY created_at DESC
  LIMIT 1
$$;
REVOKE ALL ON FUNCTION public.my_client_name() FROM public, anon;
GRANT EXECUTE ON FUNCTION public.my_client_name() TO authenticated;