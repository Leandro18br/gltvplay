CREATE TABLE public.resellers (
  user_id uuid PRIMARY KEY REFERENCES public.profiles(id) ON DELETE CASCADE,
  display_name text,
  credits integer NOT NULL DEFAULT 0 CHECK (credits >= 0),
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active','suspended')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE public.access_accounts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  login text NOT NULL UNIQUE CHECK (login ~ '^[0-9]{6}$'),
  kind text NOT NULL CHECK (kind IN ('normal','trial')),
  duration_hours integer NOT NULL CHECK (duration_hours IN (3,6,12,720)),
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active','suspended','revoked')),
  reseller_id uuid REFERENCES public.resellers(user_id) ON DELETE SET NULL,
  created_by uuid,
  note text,
  created_at timestamptz NOT NULL DEFAULT now(),
  starts_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  CHECK ((kind='normal' AND duration_hours=720) OR (kind='trial' AND duration_hours IN (3,6,12))),
  CHECK (expires_at > starts_at)
);
CREATE INDEX access_accounts_reseller_idx ON public.access_accounts(reseller_id, created_at DESC);
CREATE TABLE public.access_credentials (
  access_id uuid PRIMARY KEY REFERENCES public.access_accounts(id) ON DELETE CASCADE,
  password_hash text NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE public.credit_transactions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  reseller_id uuid NOT NULL REFERENCES public.resellers(user_id) ON DELETE CASCADE,
  delta integer NOT NULL CHECK (delta <> 0),
  balance_after integer NOT NULL CHECK (balance_after >= 0),
  reason text NOT NULL CHECK (reason IN ('access_created','admin_adjust','order_approved')),
  access_id uuid UNIQUE REFERENCES public.access_accounts(id) ON DELETE SET NULL,
  order_id uuid,
  actor_id uuid,
  note text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX credit_tx_reseller_idx ON public.credit_transactions(reseller_id, created_at DESC);
CREATE TABLE public.credit_orders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  reseller_id uuid NOT NULL REFERENCES public.resellers(user_id) ON DELETE CASCADE,
  quantity integer NOT NULL CHECK (quantity BETWEEN 1 AND 10000),
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','rejected','cancelled')),
  note text,
  decided_by uuid,
  decided_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT ON public.resellers, public.access_accounts, public.credit_transactions, public.credit_orders TO authenticated;
GRANT ALL ON public.resellers, public.access_accounts, public.access_credentials, public.credit_transactions, public.credit_orders TO service_role;
ALTER TABLE public.resellers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.access_accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.access_credentials ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.credit_transactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.credit_orders ENABLE ROW LEVEL SECURITY;

CREATE POLICY "resellers read" ON public.resellers FOR SELECT TO authenticated USING (public.is_admin(auth.uid()) OR user_id = auth.uid());
CREATE POLICY "accesses read" ON public.access_accounts FOR SELECT TO authenticated USING (public.is_admin(auth.uid()) OR reseller_id = auth.uid());
CREATE POLICY "credit tx read" ON public.credit_transactions FOR SELECT TO authenticated USING (public.is_admin(auth.uid()) OR reseller_id = auth.uid());
CREATE POLICY "orders read" ON public.credit_orders FOR SELECT TO authenticated USING (public.is_admin(auth.uid()) OR reseller_id = auth.uid());

CREATE OR REPLACE FUNCTION public.is_active_reseller(_user_id uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM public.resellers r JOIN public.profiles p ON p.id=r.user_id
    WHERE r.user_id=_user_id AND r.status='active' AND p.status='active')
$$;

CREATE OR REPLACE FUNCTION public.access_code_ok(c text) RETURNS boolean
LANGUAGE plpgsql IMMUTABLE AS $$
DECLARE i int; up bool := true; down bool := true; same bool := true;
BEGIN
  FOR i IN 2..6 LOOP
    IF (substr(c,i,1)::int - substr(c,i-1,1)::int + 10) % 10 <> 1 THEN up := false; END IF;
    IF (substr(c,i-1,1)::int - substr(c,i,1)::int + 10) % 10 <> 1 THEN down := false; END IF;
    IF substr(c,i,1) <> substr(c,1,1) THEN same := false; END IF;
  END LOOP;
  RETURN NOT (up OR down OR same);
END $$;

CREATE OR REPLACE FUNCTION public.random_access_code() RETURNS text
LANGUAGE plpgsql VOLATILE SET search_path = public, extensions AS $$
DECLARE b bytea; n bigint; c text;
BEGIN
  LOOP
    b := extensions.gen_random_bytes(4);
    n := (get_byte(b,0)::bigint<<24 | get_byte(b,1)<<16 | get_byte(b,2)<<8 | get_byte(b,3));
    IF n < 4294000000 THEN  -- avoid modulo bias
      c := lpad((n % 1000000)::text, 6, '0');
      IF public.access_code_ok(c) THEN RETURN c; END IF;
    END IF;
  END LOOP;
END $$;

CREATE OR REPLACE FUNCTION public.create_access(_kind text, _hours integer DEFAULT NULL, _reseller_id uuid DEFAULT NULL, _note text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public, extensions AS $$
DECLARE me uuid := auth.uid(); admin bool; owner uuid; hrs int; lg text; pw text; acc public.access_accounts; bal int; tries int := 0;
BEGIN
  IF me IS NULL THEN RAISE EXCEPTION 'forbidden'; END IF;
  admin := public.is_admin(me);
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

  -- Charge before insert inside same transaction: any failure rolls both back.
  IF _kind='normal' AND owner IS NOT NULL AND NOT (admin AND owner IS NULL) THEN
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

CREATE OR REPLACE FUNCTION public.admin_adjust_credits(_reseller_id uuid, _delta integer, _note text DEFAULT NULL)
RETURNS integer LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public AS $$
DECLARE bal int;
BEGIN
  IF NOT public.is_admin(auth.uid()) THEN RAISE EXCEPTION 'forbidden'; END IF;
  IF _delta = 0 THEN RAISE EXCEPTION 'delta must be non-zero'; END IF;
  UPDATE public.resellers SET credits = credits + _delta, updated_at = now()
    WHERE user_id = _reseller_id AND credits + _delta >= 0 RETURNING credits INTO bal;
  IF bal IS NULL THEN RAISE EXCEPTION 'insufficient credits or reseller not found'; END IF;
  INSERT INTO public.credit_transactions(reseller_id, delta, balance_after, reason, actor_id, note)
    VALUES (_reseller_id, _delta, bal, 'admin_adjust', auth.uid(), left(_note,500));
  RETURN bal;
END $$;

CREATE OR REPLACE FUNCTION public.admin_upsert_reseller(_user_id uuid, _display_name text, _status text DEFAULT 'active')
RETURNS void LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT public.is_admin(auth.uid()) THEN RAISE EXCEPTION 'forbidden'; END IF;
  IF _status NOT IN ('active','suspended') THEN RAISE EXCEPTION 'invalid status'; END IF;
  INSERT INTO public.resellers(user_id, display_name, status) VALUES (_user_id, left(_display_name,120), _status)
  ON CONFLICT (user_id) DO UPDATE SET display_name = EXCLUDED.display_name, status = EXCLUDED.status, updated_at = now();
END $$;

CREATE OR REPLACE FUNCTION public.set_access_status(_access_id uuid, _status text)
RETURNS void LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public AS $$
DECLARE me uuid := auth.uid();
BEGIN
  IF _status NOT IN ('active','suspended','revoked') THEN RAISE EXCEPTION 'invalid status'; END IF;
  UPDATE public.access_accounts SET status = _status
    WHERE id = _access_id AND (public.is_admin(me) OR (reseller_id = me AND public.is_active_reseller(me)));
  IF NOT FOUND THEN RAISE EXCEPTION 'forbidden'; END IF;
END $$;

CREATE OR REPLACE FUNCTION public.request_credits(_quantity integer, _note text DEFAULT NULL)
RETURNS uuid LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public AS $$
DECLARE oid uuid;
BEGIN
  IF NOT public.is_active_reseller(auth.uid()) THEN RAISE EXCEPTION 'forbidden'; END IF;
  INSERT INTO public.credit_orders(reseller_id, quantity, note) VALUES (auth.uid(), _quantity, left(_note,500)) RETURNING id INTO oid;
  RETURN oid;
END $$;

CREATE OR REPLACE FUNCTION public.decide_credit_order(_order_id uuid, _approve boolean)
RETURNS void LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public AS $$
DECLARE o public.credit_orders; bal int;
BEGIN
  IF NOT public.is_admin(auth.uid()) THEN RAISE EXCEPTION 'forbidden'; END IF;
  UPDATE public.credit_orders SET status = CASE WHEN _approve THEN 'approved' ELSE 'rejected' END,
    decided_by = auth.uid(), decided_at = now()
    WHERE id = _order_id AND status = 'pending' RETURNING * INTO o;
  IF o.id IS NULL THEN RAISE EXCEPTION 'order not pending'; END IF;
  IF _approve THEN
    UPDATE public.resellers SET credits = credits + o.quantity, updated_at = now() WHERE user_id = o.reseller_id RETURNING credits INTO bal;
    INSERT INTO public.credit_transactions(reseller_id, delta, balance_after, reason, order_id, actor_id)
      VALUES (o.reseller_id, o.quantity, bal, 'order_approved', o.id, auth.uid());
  END IF;
END $$;

REVOKE ALL ON FUNCTION public.create_access(text,integer,uuid,text), public.admin_adjust_credits(uuid,integer,text),
  public.admin_upsert_reseller(uuid,text,text), public.set_access_status(uuid,text), public.request_credits(integer,text),
  public.decide_credit_order(uuid,boolean), public.random_access_code(), public.is_active_reseller(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_access(text,integer,uuid,text), public.admin_adjust_credits(uuid,integer,text),
  public.admin_upsert_reseller(uuid,text,text), public.set_access_status(uuid,text), public.request_credits(integer,text),
  public.decide_credit_order(uuid,boolean), public.is_active_reseller(uuid) TO authenticated;
