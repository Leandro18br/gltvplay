ALTER TABLE public.credit_transactions DROP CONSTRAINT credit_transactions_reason_check;
ALTER TABLE public.credit_transactions ADD CONSTRAINT credit_transactions_reason_check CHECK (reason = ANY (ARRAY['access_created','admin_adjust','order_approved','access_renewed','access_converted']));

CREATE OR REPLACE FUNCTION public.can_manage_access(_me uuid, acc public.access_accounts)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT _me IS NOT NULL AND (public.is_super_admin(_me) OR (acc.reseller_id = _me AND public.is_active_reseller(_me)))
$$;

CREATE OR REPLACE FUNCTION public.convert_trial_access(_access_id uuid, _request_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE me uuid := auth.uid(); acc public.access_accounts; bal int;
BEGIN
  IF me IS NULL OR _request_id IS NULL THEN RAISE EXCEPTION 'forbidden'; END IF;
  SELECT * INTO acc FROM public.access_accounts WHERE id = _access_id FOR UPDATE;
  IF acc.id IS NULL OR NOT public.can_manage_access(me, acc) THEN RAISE EXCEPTION 'forbidden'; END IF;
  -- Repeated action: already converted, never charge again
  IF acc.kind = 'normal' THEN
    RETURN jsonb_build_object('expires_at', acc.expires_at, 'duplicate', true);
  END IF;
  IF acc.status = 'revoked' THEN RAISE EXCEPTION 'access cancelled'; END IF;
  IF acc.reseller_id IS NOT NULL THEN
    UPDATE public.resellers SET credits = credits - 1, updated_at = now()
      WHERE user_id = acc.reseller_id AND status = 'active' AND credits >= 1 RETURNING credits INTO bal;
    IF bal IS NULL THEN RAISE EXCEPTION 'insufficient credits'; END IF;
  END IF;
  UPDATE public.access_accounts SET kind = 'normal', duration_hours = 720, status = 'active',
    starts_at = now(), expires_at = now() + interval '30 days' WHERE id = acc.id RETURNING * INTO acc;
  IF bal IS NOT NULL THEN
    INSERT INTO public.credit_transactions(reseller_id, delta, balance_after, reason, access_id, actor_id, request_id)
      VALUES (acc.reseller_id, -1, bal, 'access_converted', acc.id, me, _request_id);
  END IF;
  INSERT INTO public.audit_logs(actor_id, action, entity, entity_id, summary)
    VALUES (me, 'update', 'access_accounts', acc.id::text, 'Teste ' || acc.login || ' convertido em acesso de 30 dias');
  RETURN jsonb_build_object('expires_at', acc.expires_at, 'credits_after', bal, 'duplicate', false);
END $$;

CREATE OR REPLACE FUNCTION public.delete_trial_access(_access_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE me uuid := auth.uid(); acc public.access_accounts;
BEGIN
  SELECT * INTO acc FROM public.access_accounts WHERE id = _access_id FOR UPDATE;
  IF acc.id IS NULL THEN RETURN; END IF; -- already deleted: idempotent
  IF NOT public.can_manage_access(me, acc) THEN RAISE EXCEPTION 'forbidden'; END IF;
  IF acc.kind <> 'trial' THEN RAISE EXCEPTION 'only trials can be deleted'; END IF;
  DELETE FROM public.access_accounts WHERE id = acc.id;
  INSERT INTO public.audit_logs(actor_id, action, entity, entity_id, summary)
    VALUES (me, 'delete', 'access_accounts', acc.id::text, 'Teste ' || acc.login || ' excluído');
END $$;

CREATE OR REPLACE FUNCTION public.reset_access_password(_access_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions AS $$
DECLARE me uuid := auth.uid(); acc public.access_accounts; pw text;
BEGIN
  SELECT * INTO acc FROM public.access_accounts WHERE id = _access_id;
  IF acc.id IS NULL OR NOT public.can_manage_access(me, acc) THEN RAISE EXCEPTION 'forbidden'; END IF;
  IF acc.status = 'revoked' THEN RAISE EXCEPTION 'access cancelled'; END IF;
  pw := public.random_access_code();
  INSERT INTO public.access_credentials(access_id, password_hash, updated_at)
    VALUES (acc.id, extensions.crypt(pw, extensions.gen_salt('bf', 10)), now())
    ON CONFLICT (access_id) DO UPDATE SET password_hash = EXCLUDED.password_hash, updated_at = now();
  INSERT INTO public.audit_logs(actor_id, action, entity, entity_id, summary)
    VALUES (me, 'update', 'access_accounts', acc.id::text, 'Senha do acesso ' || acc.login || ' redefinida');
  RETURN jsonb_build_object('login', acc.login, 'password', pw);
END $$;

REVOKE EXECUTE ON FUNCTION public.can_manage_access(uuid, public.access_accounts) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.convert_trial_access(uuid, uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.delete_trial_access(uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.reset_access_password(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.convert_trial_access(uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.delete_trial_access(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.reset_access_password(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.can_manage_access(uuid, public.access_accounts) TO authenticated;