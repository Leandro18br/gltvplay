ALTER TABLE public.resellers DROP CONSTRAINT resellers_status_check;
ALTER TABLE public.resellers ADD CONSTRAINT resellers_status_check CHECK (status IN ('active','suspended','deleted'));

-- Logical deletion: keeps accesses, credit history and requests intact.
CREATE OR REPLACE FUNCTION public.admin_delete_reseller(_user_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT public.is_super_admin(auth.uid()) THEN RAISE EXCEPTION 'forbidden'; END IF;
  UPDATE public.resellers SET status='deleted', updated_at=now() WHERE user_id=_user_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'not found'; END IF;
  INSERT INTO public.audit_logs(actor_id, action, entity, entity_id, summary)
  VALUES (auth.uid(), 'delete', 'resellers', _user_id::text, 'Revendedor excluído (exclusão lógica)');
END $$;
REVOKE ALL ON FUNCTION public.admin_delete_reseller(uuid) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.admin_delete_reseller(uuid) TO authenticated;