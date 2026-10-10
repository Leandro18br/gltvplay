CREATE OR REPLACE FUNCTION public.is_super_admin(_user_id uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = _user_id AND role = 'super_admin')
$$;
GRANT EXECUTE ON FUNCTION public.is_super_admin(uuid) TO authenticated;

ALTER TABLE public.credit_transactions ADD COLUMN IF NOT EXISTS request_id uuid UNIQUE;
ALTER TABLE public.credit_orders ADD COLUMN IF NOT EXISTS granted_quantity integer CHECK (granted_quantity IS NULL OR granted_quantity BETWEEN 1 AND 10000);
ALTER TABLE public.credit_orders ADD COLUMN IF NOT EXISTS admin_note text;

CREATE TABLE public.content_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  reseller_id uuid NOT NULL REFERENCES public.resellers(user_id) ON DELETE CASCADE,
  kind text NOT NULL CHECK (kind IN ('movie','series')),
  title text NOT NULL CHECK (length(title) BETWEEN 1 AND 200),
  release_year integer CHECK (release_year IS NULL OR release_year BETWEEN 1880 AND 2100),
  tmdb_id integer,
  note text,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','in_progress','completed','rejected')),
  admin_note text,
  decided_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX content_requests_status_idx ON public.content_requests(status, created_at DESC);
GRANT SELECT ON public.content_requests TO authenticated;
GRANT ALL ON public.content_requests TO service_role;
ALTER TABLE public.content_requests ENABLE ROW LEVEL SECURITY;
CREATE POLICY "content requests read" ON public.content_requests FOR SELECT TO authenticated
  USING (public.is_super_admin(auth.uid()) OR reseller_id = auth.uid());

-- Only the main administrator (super_admin) manages resellers/credits.
DROP POLICY "resellers read" ON public.resellers;
DROP POLICY "accesses read" ON public.access_accounts;
DROP POLICY "credit tx read" ON public.credit_transactions;
DROP POLICY "orders read" ON public.credit_orders;
CREATE POLICY "resellers read" ON public.resellers FOR SELECT TO authenticated USING (public.is_super_admin(auth.uid()) OR user_id = auth.uid());
CREATE POLICY "accesses read" ON public.access_accounts FOR SELECT TO authenticated USING (public.is_super_admin(auth.uid()) OR reseller_id = auth.uid());
CREATE POLICY "credit tx read" ON public.credit_transactions FOR SELECT TO authenticated USING (public.is_super_admin(auth.uid()) OR reseller_id = auth.uid());
CREATE POLICY "orders read" ON public.credit_orders FOR SELECT TO authenticated USING (public.is_super_admin(auth.uid()) OR reseller_id = auth.uid());

CREATE OR REPLACE FUNCTION public.create_access(_kind text, _hours integer DEFAULT NULL, _reseller_id uuid DEFAULT NULL, _note text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public, extensions AS $$
DECLARE me uuid := auth.uid(); admin bool; owner uuid; hrs int; lg text; pw text; acc public.access_accounts; bal int; tries int := 0;
BEGIN
  IF me IS NULL THEN RAISE EXCEPTION 'forbidden'; END IF;
  admin := public.is_super_admin(me);
  IF admin THEN owner := _reseller_id;
  ELSIF public.is_active_reseller(me) THEN
    IF _reseller_id IS NOT NULL AND _reseller_id <> me THEN RAISE EXCEPTION 'forbidden'; END IF;
    owner := me;
  ELSE RAISE EXCEPTION 'forbidden'; END IF;
  IF _kind = 'normal' THEN hrs := 720;
  ELSIF _kind = 'trial' AND _hours IN (3,6,12) THEN hrs := _hours;
  ELSE RAISE EXCEPTION 'invalid access type or duration'; END IF;
  IF owner IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.resellers WHERE user_id=owner AND status='active') THEN
    RAISE EXCEPTION 'reseller not active'; END IF;
  IF _kind='normal' AND owner IS NOT NULL THEN
    UPDATE public.resellers SET credits = credits - 1, updated_at = now()
      WHERE user_id = owner AND credits >= 1 RETURNING credits INTO bal;
    IF bal IS NULL THEN RAISE EXCEPTION 'insufficient credits'; END IF;
  END IF;
  pw := public.random_access_code();
  LOOP
    lg := public.random_access_code();
    BEGIN
      INSERT INTO public.access_accounts(login, kind, duration_hours, reseller_id, created_by, note, starts_at, expires_at)
        VALUES (lg, _kind, hrs, owner, me, left(_note,500), now(), now() + make_interval(hours => hrs)) RETURNING * INTO acc;
      EXIT;
    EXCEPTION WHEN unique_violation THEN
      tries := tries + 1; IF tries > 20 THEN RAISE EXCEPTION 'could not allocate login'; END IF;
    END;
  END LOOP;
  INSERT INTO public.access_credentials(access_id, password_hash) VALUES (acc.id, extensions.crypt(pw, extensions.gen_salt('bf', 10)));
  IF bal IS NOT NULL THEN
    INSERT INTO public.credit_transactions(reseller_id, delta, balance_after, reason, access_id, actor_id)
      VALUES (owner, -1, bal, 'access_created', acc.id, me);
  END IF;
  RETURN jsonb_build_object('id', acc.id, 'login', acc.login, 'password', pw, 'kind', acc.kind,
    'starts_at', acc.starts_at, 'expires_at', acc.expires_at, 'reseller_id', owner, 'credits_after', bal);
END $$;

DROP FUNCTION public.admin_adjust_credits(uuid,integer,text);
CREATE FUNCTION public.admin_adjust_credits(_reseller_id uuid, _delta integer, _note text, _request_id uuid)
RETURNS integer LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public AS $$
DECLARE bal int;
BEGIN
  IF NOT public.is_super_admin(auth.uid()) THEN RAISE EXCEPTION 'forbidden'; END IF;
  IF _delta = 0 OR abs(_delta) > 100000 THEN RAISE EXCEPTION 'invalid quantity'; END IF;
  IF coalesce(length(trim(_note)),0) < 3 THEN RAISE EXCEPTION 'reason required'; END IF;
  IF _request_id IS NULL THEN RAISE EXCEPTION 'request id required'; END IF;
  SELECT balance_after INTO bal FROM public.credit_transactions WHERE request_id = _request_id;
  IF FOUND THEN RETURN bal; END IF; -- duplicate submit: no second movement
  UPDATE public.resellers SET credits = credits + _delta, updated_at = now()
    WHERE user_id = _reseller_id AND credits + _delta >= 0 RETURNING credits INTO bal;
  IF bal IS NULL THEN RAISE EXCEPTION 'insufficient credits or reseller not found'; END IF;
  INSERT INTO public.credit_transactions(reseller_id, delta, balance_after, reason, actor_id, note, request_id)
    VALUES (_reseller_id, _delta, bal, 'admin_adjust', auth.uid(), left(trim(_note),500), _request_id);
  RETURN bal;
END $$;

CREATE OR REPLACE FUNCTION public.admin_upsert_reseller(_user_id uuid, _display_name text, _status text DEFAULT 'active')
RETURNS void LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT public.is_super_admin(auth.uid()) THEN RAISE EXCEPTION 'forbidden'; END IF;
  IF _status NOT IN ('active','suspended') THEN RAISE EXCEPTION 'invalid status'; END IF;
  IF public.is_staff(_user_id) THEN RAISE EXCEPTION 'staff accounts cannot be resellers'; END IF;
  INSERT INTO public.resellers(user_id, display_name, status) VALUES (_user_id, left(trim(_display_name),120), _status)
  ON CONFLICT (user_id) DO UPDATE SET display_name = EXCLUDED.display_name, status = EXCLUDED.status, updated_at = now();
END $$;

CREATE OR REPLACE FUNCTION public.set_access_status(_access_id uuid, _status text)
RETURNS void LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public AS $$
DECLARE me uuid := auth.uid();
BEGIN
  IF _status NOT IN ('active','suspended','revoked') THEN RAISE EXCEPTION 'invalid status'; END IF;
  UPDATE public.access_accounts SET status = _status
    WHERE id = _access_id AND (public.is_super_admin(me) OR (reseller_id = me AND public.is_active_reseller(me)));
  IF NOT FOUND THEN RAISE EXCEPTION 'forbidden'; END IF;
END $$;

DROP FUNCTION public.decide_credit_order(uuid,boolean);
CREATE FUNCTION public.decide_credit_order(_order_id uuid, _approve boolean, _granted integer DEFAULT NULL, _note text DEFAULT NULL)
RETURNS void LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public AS $$
DECLARE o public.credit_orders; bal int; g int;
BEGIN
  IF NOT public.is_super_admin(auth.uid()) THEN RAISE EXCEPTION 'forbidden'; END IF;
  SELECT * INTO o FROM public.credit_orders WHERE id = _order_id FOR UPDATE;
  IF o.id IS NULL OR o.status <> 'pending' THEN RAISE EXCEPTION 'order not pending'; END IF;
  g := CASE WHEN _approve THEN coalesce(_granted, o.quantity) END;
  IF _approve AND (g < 1 OR g > 10000) THEN RAISE EXCEPTION 'invalid quantity'; END IF;
  UPDATE public.credit_orders SET status = CASE WHEN _approve THEN 'approved' ELSE 'rejected' END,
    granted_quantity = g, admin_note = left(_note,500), decided_by = auth.uid(), decided_at = now() WHERE id = o.id;
  IF _approve THEN
    UPDATE public.resellers SET credits = credits + g, updated_at = now() WHERE user_id = o.reseller_id RETURNING credits INTO bal;
    INSERT INTO public.credit_transactions(reseller_id, delta, balance_after, reason, order_id, actor_id, note)
      VALUES (o.reseller_id, g, bal, 'order_approved', o.id, auth.uid(), left(_note,500));
  END IF;
END $$;
CREATE UNIQUE INDEX IF NOT EXISTS credit_tx_order_once ON public.credit_transactions(order_id) WHERE order_id IS NOT NULL;

CREATE OR REPLACE FUNCTION public.request_content(_kind text, _title text, _year integer DEFAULT NULL, _tmdb_id integer DEFAULT NULL, _note text DEFAULT NULL)
RETURNS uuid LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public AS $$
DECLARE rid uuid;
BEGIN
  IF NOT public.is_active_reseller(auth.uid()) THEN RAISE EXCEPTION 'forbidden'; END IF;
  INSERT INTO public.content_requests(reseller_id, kind, title, release_year, tmdb_id, note)
    VALUES (auth.uid(), _kind, left(trim(_title),200), _year, _tmdb_id, left(_note,500)) RETURNING id INTO rid;
  RETURN rid;
END $$;

CREATE OR REPLACE FUNCTION public.set_content_request_status(_id uuid, _status text, _note text DEFAULT NULL)
RETURNS void LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT public.is_super_admin(auth.uid()) THEN RAISE EXCEPTION 'forbidden'; END IF;
  IF _status NOT IN ('pending','in_progress','completed','rejected') THEN RAISE EXCEPTION 'invalid status'; END IF;
  UPDATE public.content_requests SET status = _status, admin_note = coalesce(left(_note,500), admin_note),
    decided_by = auth.uid(), updated_at = now() WHERE id = _id;
  IF NOT FOUND THEN RAISE EXCEPTION 'not found'; END IF;
END $$;

REVOKE ALL ON FUNCTION public.admin_adjust_credits(uuid,integer,text,uuid), public.decide_credit_order(uuid,boolean,integer,text),
  public.request_content(text,text,integer,integer,text), public.set_content_request_status(uuid,text,text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_adjust_credits(uuid,integer,text,uuid), public.decide_credit_order(uuid,boolean,integer,text),
  public.request_content(text,text,integer,integer,text), public.set_content_request_status(uuid,text,text) TO authenticated;

CREATE TRIGGER audit_resellers AFTER INSERT OR UPDATE OR DELETE ON public.resellers FOR EACH ROW EXECUTE FUNCTION public.audit_trigger();
CREATE TRIGGER audit_credit_orders AFTER UPDATE ON public.credit_orders FOR EACH ROW EXECUTE FUNCTION public.audit_trigger();
CREATE TRIGGER audit_content_requests AFTER UPDATE ON public.content_requests FOR EACH ROW EXECUTE FUNCTION public.audit_trigger();
CREATE TRIGGER audit_credit_tx AFTER INSERT ON public.credit_transactions FOR EACH ROW EXECUTE FUNCTION public.audit_trigger();