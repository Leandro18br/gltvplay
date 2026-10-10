CREATE TABLE public.reseller_credentials (
  user_id uuid PRIMARY KEY REFERENCES public.resellers(user_id) ON DELETE CASCADE,
  login text NOT NULL UNIQUE CHECK (login ~ '^[0-9]{6}$'),
  password_hash text NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT ALL ON public.reseller_credentials TO service_role;
ALTER TABLE public.reseller_credentials ENABLE ROW LEVEL SECURITY;

-- Owner-only: issues (or reissues) the reseller's numeric login/password. Plain password is returned once, stored only as bcrypt.
CREATE OR REPLACE FUNCTION public.issue_reseller_login(_user_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE l text; pw text;
BEGIN
  IF NOT public.is_super_admin(auth.uid()) THEN RAISE EXCEPTION 'forbidden'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.resellers WHERE user_id = _user_id) THEN RAISE EXCEPTION 'reseller not found'; END IF;
  SELECT login INTO l FROM public.reseller_credentials WHERE user_id = _user_id;
  IF l IS NULL THEN
    LOOP
      l := public.random_access_code();
      EXIT WHEN NOT EXISTS (SELECT 1 FROM public.reseller_credentials WHERE login = l)
            AND NOT EXISTS (SELECT 1 FROM public.access_accounts WHERE login = l);
    END LOOP;
  END IF;
  LOOP pw := public.random_access_code(); EXIT WHEN pw <> l; END LOOP;
  INSERT INTO public.reseller_credentials(user_id, login, password_hash)
  VALUES (_user_id, l, extensions.crypt(pw, extensions.gen_salt('bf', 10)))
  ON CONFLICT (user_id) DO UPDATE SET password_hash = EXCLUDED.password_hash, updated_at = now();
  INSERT INTO public.audit_logs(actor_id, action, entity, entity_id, summary)
  VALUES (auth.uid(), 'update', 'reseller_credentials', _user_id::text, 'Credenciais de revendedor emitidas');
  RETURN jsonb_build_object('login', l, 'password', pw);
END $$;
REVOKE ALL ON FUNCTION public.issue_reseller_login(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.issue_reseller_login(uuid) TO authenticated, service_role;

-- Server-only verifier for the reseller login screen.
CREATE OR REPLACE FUNCTION public.verify_reseller_login(_login text, _password text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE c public.reseller_credentials;
BEGIN
  IF _login !~ '^[0-9]{6}$' OR _password !~ '^[0-9]{6}$' THEN RETURN jsonb_build_object('ok', false, 'reason', 'invalid'); END IF;
  SELECT * INTO c FROM public.reseller_credentials WHERE login = _login;
  IF c.user_id IS NULL OR extensions.crypt(_password, c.password_hash) <> c.password_hash THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'invalid'); END IF;
  IF NOT public.is_active_reseller(c.user_id) THEN RETURN jsonb_build_object('ok', false, 'reason', 'blocked'); END IF;
  RETURN jsonb_build_object('ok', true, 'user_id', c.user_id);
END $$;
REVOKE ALL ON FUNCTION public.verify_reseller_login(text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.verify_reseller_login(text, text) TO service_role;