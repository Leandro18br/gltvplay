ALTER TABLE public.access_accounts ADD COLUMN IF NOT EXISTS client_name text;
ALTER TABLE public.access_accounts ADD COLUMN IF NOT EXISTS deleted_at timestamptz;
ALTER TABLE public.access_accounts DROP CONSTRAINT access_accounts_status_check;
ALTER TABLE public.access_accounts ADD CONSTRAINT access_accounts_status_check CHECK (status = ANY (ARRAY['active','suspended','revoked','deleted']));
ALTER TABLE public.access_accounts ADD CONSTRAINT access_accounts_client_name_len CHECK (client_name IS NULL OR length(client_name) <= 120);

-- A deleted access is final: no RPC may change it afterwards.
CREATE OR REPLACE FUNCTION public.guard_deleted_access() RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF OLD.status = 'deleted' THEN RAISE EXCEPTION 'access deleted'; END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS guard_deleted_access ON public.access_accounts;
CREATE TRIGGER guard_deleted_access BEFORE UPDATE ON public.access_accounts FOR EACH ROW EXECUTE FUNCTION public.guard_deleted_access();

CREATE OR REPLACE FUNCTION public.create_client_access(_kind text, _hours integer, _reseller_id uuid, _name text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE r jsonb; n text := nullif(trim(coalesce(_name,'')), '');
BEGIN
  IF n IS NOT NULL AND length(n) > 120 THEN RAISE EXCEPTION 'name too long'; END IF;
  r := public.create_access(_kind, _hours, _reseller_id, NULL);
  UPDATE public.access_accounts SET client_name = n WHERE id = (r->>'id')::uuid;
  RETURN r || jsonb_build_object('client_name', n);
END $$;

CREATE OR REPLACE FUNCTION public.set_access_name(_access_id uuid, _name text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE me uuid := auth.uid(); acc public.access_accounts; n text := nullif(trim(coalesce(_name,'')), '');
BEGIN
  IF n IS NOT NULL AND length(n) > 120 THEN RAISE EXCEPTION 'name too long'; END IF;
  SELECT * INTO acc FROM public.access_accounts WHERE id = _access_id FOR UPDATE;
  IF acc.id IS NULL OR NOT public.can_manage_access(me, acc) THEN RAISE EXCEPTION 'forbidden'; END IF;
  UPDATE public.access_accounts SET client_name = n WHERE id = acc.id;
END $$;

-- Logical deletion: keeps credit transactions/audit references; login stops working (status <> active).
CREATE OR REPLACE FUNCTION public.delete_access(_access_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE me uuid := auth.uid(); acc public.access_accounts;
BEGIN
  SELECT * INTO acc FROM public.access_accounts WHERE id = _access_id FOR UPDATE;
  IF acc.id IS NULL OR NOT public.can_manage_access(me, acc) THEN RAISE EXCEPTION 'forbidden'; END IF;
  IF acc.status = 'deleted' THEN RETURN; END IF;
  UPDATE public.access_accounts SET status = 'deleted', deleted_at = now() WHERE id = acc.id;
  DELETE FROM public.access_credentials WHERE access_id = acc.id;
  INSERT INTO public.audit_logs(actor_id, action, entity, entity_id, summary)
    VALUES (me, 'delete', 'access_accounts', acc.id::text,
      CASE WHEN acc.kind = 'trial' THEN 'Teste ' ELSE 'Cliente ' END || acc.login || coalesce(' (' || acc.client_name || ')', '') || ' excluído');
END $$;

CREATE OR REPLACE FUNCTION public.admin_adjust_credits(_reseller_id uuid, _delta integer, _note text, _request_id uuid)
 RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
DECLARE bal int;
BEGIN
  IF NOT public.is_super_admin(auth.uid()) THEN RAISE EXCEPTION 'forbidden'; END IF;
  IF _delta = 0 OR abs(_delta) > 100000 THEN RAISE EXCEPTION 'invalid quantity'; END IF;
  IF _delta < 0 AND coalesce(length(trim(_note)),0) < 3 THEN RAISE EXCEPTION 'reason required'; END IF;
  IF _request_id IS NULL THEN RAISE EXCEPTION 'request id required'; END IF;
  SELECT balance_after INTO bal FROM public.credit_transactions WHERE request_id = _request_id;
  IF FOUND THEN RETURN bal; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.resellers WHERE user_id = _reseller_id AND status <> 'deleted') THEN RAISE EXCEPTION 'reseller not found'; END IF;
  UPDATE public.resellers SET credits = credits + _delta, updated_at = now()
    WHERE user_id = _reseller_id AND credits + _delta >= 0 RETURNING credits INTO bal;
  IF bal IS NULL THEN RAISE EXCEPTION 'insufficient credits or reseller not found'; END IF;
  INSERT INTO public.credit_transactions(reseller_id, delta, balance_after, reason, actor_id, note, request_id)
    VALUES (_reseller_id, _delta, bal, 'admin_adjust', auth.uid(), nullif(left(trim(coalesce(_note,'')),500),''), _request_id);
  RETURN bal;
END $function$;

REVOKE ALL ON FUNCTION public.create_client_access(text,integer,uuid,text), public.set_access_name(uuid,text), public.delete_access(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_client_access(text,integer,uuid,text), public.set_access_name(uuid,text), public.delete_access(uuid) TO authenticated;