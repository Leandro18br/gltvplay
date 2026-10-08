-- ===== Role helpers =====
CREATE OR REPLACE FUNCTION public.is_admin(_user_id uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = _user_id AND role IN ('admin','super_admin'))
$$;
CREATE OR REPLACE FUNCTION public.is_staff(_user_id uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = _user_id AND role IN ('admin','editor','super_admin'))
$$;
CREATE OR REPLACE FUNCTION public.my_role() RETURNS text
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT CASE
    WHEN EXISTS (SELECT 1 FROM user_roles WHERE user_id = auth.uid() AND role = 'super_admin') THEN 'super_admin'
    WHEN EXISTS (SELECT 1 FROM user_roles WHERE user_id = auth.uid() AND role = 'admin') THEN 'admin'
    WHEN EXISTS (SELECT 1 FROM user_roles WHERE user_id = auth.uid() AND role = 'editor') THEN 'editor'
    WHEN auth.uid() IS NOT NULL THEN 'user' ELSE NULL END
$$;
GRANT EXECUTE ON FUNCTION public.is_admin(uuid), public.is_staff(uuid), public.my_role() TO authenticated;

-- Promote existing admins to super_admin if none exists
INSERT INTO public.user_roles(user_id, role)
SELECT user_id, 'super_admin' FROM public.user_roles WHERE role = 'admin'
  AND NOT EXISTS (SELECT 1 FROM public.user_roles WHERE role = 'super_admin')
ON CONFLICT DO NOTHING;

CREATE OR REPLACE FUNCTION public.handle_new_user() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE nm text := left(trim(COALESCE(NEW.raw_user_meta_data->>'name', NEW.raw_user_meta_data->>'full_name', split_part(NEW.email,'@',1))), 80);
BEGIN
  INSERT INTO public.profiles (id, name, email, avatar_url) VALUES (NEW.id, nm, NEW.email, NEW.raw_user_meta_data->>'avatar_url');
  INSERT INTO public.user_roles (user_id, role) VALUES (NEW.id, 'user');
  IF NOT EXISTS (SELECT 1 FROM public.user_roles WHERE role IN ('admin','super_admin')) THEN
    INSERT INTO public.user_roles (user_id, role) VALUES (NEW.id, 'super_admin'), (NEW.id, 'admin');
  END IF;
  INSERT INTO public.viewer_profiles (user_id, name) VALUES (NEW.id, nm);
  RETURN NEW;
END; $$;

-- Role management: super_admin manages admin/super_admin; admins manage editors
CREATE OR REPLACE FUNCTION public.admin_set_role(_user_id uuid, _role app_role, _enabled boolean) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
BEGIN
  IF _role = 'user' THEN RAISE EXCEPTION 'invalid role'; END IF;
  IF _role IN ('admin','super_admin') AND NOT public.has_role(auth.uid(),'super_admin') THEN RAISE EXCEPTION 'forbidden: only super admin'; END IF;
  IF _role = 'editor' AND NOT public.is_admin(auth.uid()) THEN RAISE EXCEPTION 'forbidden'; END IF;
  IF public.has_role(_user_id,'super_admin') AND NOT public.has_role(auth.uid(),'super_admin') THEN RAISE EXCEPTION 'forbidden'; END IF;
  IF _user_id = auth.uid() AND _role IN ('admin','super_admin') AND NOT _enabled THEN RAISE EXCEPTION 'cannot remove your own role'; END IF;
  IF _enabled THEN
    INSERT INTO user_roles(user_id, role) VALUES (_user_id, _role) ON CONFLICT DO NOTHING;
  ELSE
    DELETE FROM user_roles WHERE user_id = _user_id AND role = _role;
  END IF;
END; $$;

CREATE OR REPLACE FUNCTION public.guard_profile_status() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
BEGIN
  IF NEW.status IS DISTINCT FROM OLD.status AND (
       NOT public.is_admin(auth.uid())
       OR (public.has_role(NEW.id,'super_admin') AND NOT public.has_role(auth.uid(),'super_admin'))
       OR NEW.id = auth.uid()) THEN
    NEW.status = OLD.status;
  END IF;
  IF NEW.email IS DISTINCT FROM OLD.email AND auth.uid() IS NOT NULL THEN NEW.email = OLD.email; END IF;
  NEW.name = left(trim(NEW.name), 80);
  RETURN NEW;
END; $$;

-- ===== Content policies: editors create/edit, admins delete =====
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['movies','series','seasons','episodes','channels','categories','genres','banners','playback_sources','movie_genres','series_genres'] LOOP
    EXECUTE format('DROP POLICY IF EXISTS "staff manage" ON public.%I', t);
    EXECUTE format('DROP POLICY IF EXISTS "staff read" ON public.%I', t);
    EXECUTE format('DROP POLICY IF EXISTS "staff insert" ON public.%I', t);
    EXECUTE format('DROP POLICY IF EXISTS "staff update" ON public.%I', t);
    EXECUTE format('DROP POLICY IF EXISTS "delete policy" ON public.%I', t);
    EXECUTE format('CREATE POLICY "staff read" ON public.%I FOR SELECT TO authenticated USING (public.is_staff(auth.uid()))', t);
    EXECUTE format('CREATE POLICY "staff insert" ON public.%I FOR INSERT TO authenticated WITH CHECK (public.is_staff(auth.uid()))', t);
    EXECUTE format('CREATE POLICY "staff update" ON public.%I FOR UPDATE TO authenticated USING (public.is_staff(auth.uid())) WITH CHECK (public.is_staff(auth.uid()))', t);
    IF t IN ('movie_genres','series_genres') THEN
      EXECUTE format('CREATE POLICY "delete policy" ON public.%I FOR DELETE TO authenticated USING (public.is_staff(auth.uid()))', t);
    ELSE
      EXECUTE format('CREATE POLICY "delete policy" ON public.%I FOR DELETE TO authenticated USING (public.is_admin(auth.uid()))', t);
    END IF;
  END LOOP;
END $$;

DROP POLICY IF EXISTS "admin update" ON public.site_settings;
CREATE POLICY "admin update" ON public.site_settings FOR UPDATE TO authenticated USING (public.is_admin(auth.uid())) WITH CHECK (public.is_admin(auth.uid()));
DROP POLICY IF EXISTS "admin read" ON public.audit_logs;
CREATE POLICY "admin read" ON public.audit_logs FOR SELECT TO authenticated USING (public.is_admin(auth.uid()));
DROP POLICY IF EXISTS "own profile update" ON public.profiles;
CREATE POLICY "own profile update" ON public.profiles FOR UPDATE TO authenticated USING (auth.uid() = id OR public.is_admin(auth.uid())) WITH CHECK (auth.uid() = id OR public.is_admin(auth.uid()));
DROP POLICY IF EXISTS "own roles read" ON public.user_roles;
CREATE POLICY "own roles read" ON public.user_roles FOR SELECT TO authenticated USING (auth.uid() = user_id OR public.is_admin(auth.uid()));

-- ===== Validation / sanitization =====
ALTER TABLE public.movies ADD CONSTRAINT movies_title_len CHECK (char_length(trim(title)) BETWEEN 1 AND 300) NOT VALID;
ALTER TABLE public.series ADD CONSTRAINT series_title_len CHECK (char_length(trim(title)) BETWEEN 1 AND 300) NOT VALID;
ALTER TABLE public.episodes ADD CONSTRAINT episodes_title_len CHECK (char_length(trim(title)) BETWEEN 1 AND 300) NOT VALID;
ALTER TABLE public.channels ADD CONSTRAINT channels_name_len CHECK (char_length(trim(name)) BETWEEN 1 AND 200) NOT VALID;
ALTER TABLE public.categories ADD CONSTRAINT categories_slug_fmt CHECK (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$') NOT VALID;
ALTER TABLE public.genres ADD CONSTRAINT genres_slug_fmt CHECK (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$') NOT VALID;
ALTER TABLE public.movies ADD CONSTRAINT movies_year CHECK (release_year IS NULL OR release_year BETWEEN 1880 AND 2100) NOT VALID;
ALTER TABLE public.series ADD CONSTRAINT series_year CHECK (release_year IS NULL OR release_year BETWEEN 1880 AND 2100) NOT VALID;
ALTER TABLE public.movies ADD CONSTRAINT movies_duration CHECK (duration_minutes IS NULL OR duration_minutes BETWEEN 1 AND 1500) NOT VALID;
ALTER TABLE public.playback_sources ADD CONSTRAINT playback_url_fmt CHECK (url ~* '^https?://' AND char_length(url) <= 2048) NOT VALID;
ALTER TABLE public.banners ADD CONSTRAINT banners_button_url_fmt CHECK (button_url IS NULL OR button_url = '' OR button_url ~* '^(https?://|/)') NOT VALID;
ALTER TABLE public.viewer_profiles ADD CONSTRAINT viewer_profiles_name_len CHECK (char_length(trim(name)) BETWEEN 1 AND 40) NOT VALID;

-- ===== Audit with human-readable summary + rate limit =====
ALTER TABLE public.audit_logs ADD COLUMN IF NOT EXISTS summary text;
ALTER TABLE public.audit_logs ADD COLUMN IF NOT EXISTS actor_role text;
CREATE INDEX IF NOT EXISTS audit_logs_actor_time_idx ON public.audit_logs (actor_id, created_at DESC);

CREATE OR REPLACE FUNCTION public.audit_trigger() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
  o jsonb := CASE WHEN TG_OP <> 'INSERT' THEN to_jsonb(OLD) END;
  n jsonb := CASE WHEN TG_OP <> 'DELETE' THEN to_jsonb(NEW) END;
  label text; verb text; title text; who text; role text; recent int;
BEGIN
  IF auth.uid() IS NOT NULL AND TG_TABLE_NAME NOT IN ('profiles') THEN
    SELECT count(*) INTO recent FROM audit_logs WHERE actor_id = auth.uid() AND created_at > now() - interval '1 minute';
    IF recent > 300 THEN RAISE EXCEPTION 'rate limit exceeded, try again in a minute'; END IF;
  END IF;
  label := CASE TG_TABLE_NAME WHEN 'movies' THEN 'o filme' WHEN 'series' THEN 'a série' WHEN 'seasons' THEN 'a temporada'
    WHEN 'episodes' THEN 'o episódio' WHEN 'channels' THEN 'o canal' WHEN 'categories' THEN 'a categoria' WHEN 'genres' THEN 'o gênero'
    WHEN 'banners' THEN 'o banner' WHEN 'site_settings' THEN 'as configurações' WHEN 'playback_sources' THEN 'a fonte de reprodução'
    WHEN 'user_roles' THEN 'a permissão' WHEN 'profiles' THEN 'o usuário' ELSE TG_TABLE_NAME END;
  title := COALESCE(n->>'title', n->>'name', o->>'title', o->>'name', n->>'role', o->>'role',
    CASE WHEN TG_TABLE_NAME = 'seasons' THEN 'T' || COALESCE(n->>'season_number', o->>'season_number') END, '');
  verb := CASE TG_OP WHEN 'INSERT' THEN 'adicionou' WHEN 'DELETE' THEN 'excluiu' ELSE
    CASE
      WHEN o ? 'status' AND (o->>'status') IS DISTINCT FROM (n->>'status') THEN
        CASE n->>'status' WHEN 'published' THEN 'publicou' WHEN 'archived' THEN 'desativou' WHEN 'draft' THEN 'moveu para rascunho'
          WHEN 'suspended' THEN 'suspendeu' WHEN 'banned' THEN 'baniu' WHEN 'active' THEN 'reativou' ELSE 'alterou' END
      WHEN o ? 'is_active' AND (o->>'is_active') IS DISTINCT FROM (n->>'is_active') THEN
        CASE WHEN (n->>'is_active')::boolean THEN 'ativou' ELSE 'desativou' END
      WHEN o ? 'featured' AND (o->>'featured') IS DISTINCT FROM (n->>'featured') THEN
        CASE WHEN (n->>'featured')::boolean THEN 'destacou' ELSE 'removeu o destaque de' END
      ELSE 'alterou' END END;
  SELECT COALESCE(p.name, p.email) INTO who FROM profiles p WHERE p.id = auth.uid();
  role := public.my_role();
  INSERT INTO public.audit_logs (actor_id, actor_role, action, entity, entity_id, changes, summary)
  VALUES (auth.uid(), role, lower(TG_OP), TG_TABLE_NAME, COALESCE(n->>'id', o->>'id'),
    jsonb_build_object('old', o, 'new', n),
    trim(COALESCE(CASE role WHEN 'super_admin' THEN 'Super admin ' WHEN 'admin' THEN 'Administrador ' WHEN 'editor' THEN 'Editor ' ELSE '' END || who, 'Sistema')
      || ' ' || verb || ' ' || label || CASE WHEN title <> '' THEN ' "' || left(title, 120) || '"' ELSE '' END || '.'));
  RETURN COALESCE(NEW, OLD);
END; $$;

-- ===== Multi-profile: history & list per viewer profile =====
DROP INDEX IF EXISTS public.watch_history_user_content_uidx;
DROP INDEX IF EXISTS public.watchlist_user_content_uidx;
CREATE UNIQUE INDEX watch_history_profile_content_uidx ON public.watch_history (user_id, viewer_profile_id, content_kind, content_id) NULLS NOT DISTINCT;
CREATE UNIQUE INDEX watchlist_profile_content_uidx ON public.watchlist (user_id, viewer_profile_id, content_kind, content_id) NULLS NOT DISTINCT;

CREATE OR REPLACE FUNCTION public.guard_viewer_profile_ref() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.viewer_profile_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM viewer_profiles WHERE id = NEW.viewer_profile_id AND user_id = NEW.user_id) THEN
    RAISE EXCEPTION 'invalid profile';
  END IF;
  RETURN NEW;
END; $$;
CREATE TRIGGER guard_vp_history BEFORE INSERT OR UPDATE ON public.watch_history FOR EACH ROW EXECUTE FUNCTION public.guard_viewer_profile_ref();
CREATE TRIGGER guard_vp_list BEFORE INSERT OR UPDATE ON public.watchlist FOR EACH ROW EXECUTE FUNCTION public.guard_viewer_profile_ref();

CREATE OR REPLACE FUNCTION public.limit_viewer_profiles() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF (SELECT count(*) FROM viewer_profiles WHERE user_id = NEW.user_id) >= 5 THEN RAISE EXCEPTION 'max 5 profiles'; END IF;
  NEW.name = left(trim(NEW.name), 40);
  RETURN NEW;
END; $$;
CREATE TRIGGER limit_vp BEFORE INSERT ON public.viewer_profiles FOR EACH ROW EXECUTE FUNCTION public.limit_viewer_profiles();

-- ===== Avatar uploads (own folder in media bucket) =====
CREATE POLICY "own avatar insert" ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'media' AND (storage.foldername(name))[1] = 'avatars' AND (storage.foldername(name))[2] = auth.uid()::text);
CREATE POLICY "own avatar update" ON storage.objects FOR UPDATE TO authenticated
  USING (bucket_id = 'media' AND (storage.foldername(name))[1] = 'avatars' AND (storage.foldername(name))[2] = auth.uid()::text);

-- ===== Realtime: public site refreshes when the admin changes content =====
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['movies','series','seasons','episodes','channels','categories','genres','banners','site_settings'] LOOP
    BEGIN
      EXECUTE format('ALTER PUBLICATION supabase_realtime ADD TABLE public.%I', t);
    EXCEPTION WHEN duplicate_object THEN NULL;
    END;
  END LOOP;
END $$;