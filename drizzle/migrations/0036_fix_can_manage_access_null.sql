CREATE OR REPLACE FUNCTION public.can_manage_access(_me uuid, acc access_accounts)
 RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $function$
  SELECT coalesce(_me IS NOT NULL AND (public.is_super_admin(_me) OR (acc.reseller_id IS NOT NULL AND acc.reseller_id = _me AND public.is_active_reseller(_me))), false)
$function$;