ALTER TABLE public.credit_transactions DROP CONSTRAINT IF EXISTS credit_transactions_access_id_key;
CREATE UNIQUE INDEX IF NOT EXISTS credit_tx_access_created_once ON public.credit_transactions(access_id) WHERE reason = 'access_created';
ALTER TABLE public.credit_transactions DROP CONSTRAINT IF EXISTS credit_transactions_reason_check;
ALTER TABLE public.credit_transactions ADD CONSTRAINT credit_transactions_reason_check
  CHECK (reason IN ('access_created','admin_adjust','order_approved','access_renewed'));

CREATE OR REPLACE FUNCTION public.renew_access(_access_id uuid, _request_id uuid)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public AS $$
DECLARE me uuid := auth.uid(); acc public.access_accounts; bal int; newexp timestamptz; prev public.credit_transactions;
BEGIN
  IF me IS NULL OR _request_id IS NULL THEN RAISE EXCEPTION 'forbidden'; END IF;
  SELECT * INTO prev FROM public.credit_transactions WHERE request_id = _request_id;
  IF FOUND THEN
    IF prev.access_id IS DISTINCT FROM _access_id THEN RAISE EXCEPTION 'forbidden'; END IF;
    SELECT * INTO acc FROM public.access_accounts WHERE id = _access_id;
    RETURN jsonb_build_object('expires_at', acc.expires_at, 'credits_after', prev.balance_after, 'duplicate', true);
  END IF;
  SELECT * INTO acc FROM public.access_accounts WHERE id = _access_id FOR UPDATE;
  IF acc.id IS NULL THEN RAISE EXCEPTION 'forbidden'; END IF;
  IF NOT (public.is_super_admin(me) OR (acc.reseller_id = me AND public.is_active_reseller(me))) THEN RAISE EXCEPTION 'forbidden'; END IF;
  IF acc.kind <> 'normal' THEN RAISE EXCEPTION 'trials cannot be renewed'; END IF;
  IF acc.status <> 'active' THEN RAISE EXCEPTION 'access not active'; END IF;
  newexp := greatest(acc.expires_at, now()) + interval '30 days';
  IF acc.reseller_id IS NOT NULL THEN
    UPDATE public.resellers SET credits = credits - 1, updated_at = now()
      WHERE user_id = acc.reseller_id AND status = 'active' AND credits >= 1 RETURNING credits INTO bal;
    IF bal IS NULL THEN RAISE EXCEPTION 'insufficient credits'; END IF;
    INSERT INTO public.credit_transactions(reseller_id, delta, balance_after, reason, access_id, actor_id, request_id)
      VALUES (acc.reseller_id, -1, bal, 'access_renewed', acc.id, me, _request_id);
  END IF;
  UPDATE public.access_accounts SET expires_at = newexp,
    starts_at = CASE WHEN acc.expires_at <= now() THEN now() ELSE starts_at END WHERE id = acc.id;
  RETURN jsonb_build_object('expires_at', newexp, 'credits_after', bal, 'duplicate', false);
END $$;

CREATE OR REPLACE FUNCTION public.set_access_status(_access_id uuid, _status text)
RETURNS void LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public AS $$
DECLARE me uuid := auth.uid(); acc public.access_accounts;
BEGIN
  IF _status NOT IN ('active','suspended','revoked') THEN RAISE EXCEPTION 'invalid status'; END IF;
  SELECT * INTO acc FROM public.access_accounts WHERE id = _access_id FOR UPDATE;
  IF acc.id IS NULL THEN RAISE EXCEPTION 'forbidden'; END IF;
  IF NOT public.is_super_admin(me) THEN
    IF acc.reseller_id IS DISTINCT FROM me OR NOT public.is_active_reseller(me) THEN RAISE EXCEPTION 'forbidden'; END IF;
    -- Cancelled accesses can only be reactivated by the main administrator.
    IF acc.status = 'revoked' THEN RAISE EXCEPTION 'access cancelled'; END IF;
  END IF;
  UPDATE public.access_accounts SET status = _status WHERE id = acc.id;
END $$;

-- Validates a client login; expired, blocked or cancelled accesses are refused.
CREATE OR REPLACE FUNCTION public.verify_access_login(_login text, _password text)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public, extensions AS $$
DECLARE acc public.access_accounts; h text;
BEGIN
  IF _login !~ '^[0-9]{6}$' OR _password !~ '^[0-9]{6}$' THEN RETURN jsonb_build_object('ok', false, 'reason', 'invalid'); END IF;
  SELECT a.* INTO acc FROM public.access_accounts a WHERE a.login = _login;
  SELECT password_hash INTO h FROM public.access_credentials WHERE access_id = acc.id;
  IF acc.id IS NULL OR h IS NULL OR extensions.crypt(_password, h) <> h THEN RETURN jsonb_build_object('ok', false, 'reason', 'invalid'); END IF;
  IF acc.status <> 'active' THEN RETURN jsonb_build_object('ok', false, 'reason', acc.status); END IF;
  IF acc.expires_at <= now() OR acc.starts_at > now() THEN RETURN jsonb_build_object('ok', false, 'reason', 'expired'); END IF;
  IF acc.reseller_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.resellers WHERE user_id = acc.reseller_id AND status = 'active') THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'reseller_blocked'); END IF;
  RETURN jsonb_build_object('ok', true, 'access_id', acc.id, 'expires_at', acc.expires_at, 'kind', acc.kind);
END $$;

REVOKE ALL ON FUNCTION public.renew_access(uuid,uuid), public.verify_access_login(text,text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.renew_access(uuid,uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.verify_access_login(text,text) TO service_role;