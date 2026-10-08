CREATE TYPE public.app_role AS ENUM ('admin','editor','user');
CREATE TYPE public.account_status AS ENUM ('active','suspended','banned');
CREATE TYPE public.content_status AS ENUM ('draft','published','archived');
CREATE TYPE public.content_kind AS ENUM ('movie','series','episode','channel');

CREATE OR REPLACE FUNCTION public.set_updated_at() RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END; $$;

CREATE TABLE public.profiles (
  id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  name text,
  email text,
  avatar_url text,
  status public.account_status NOT NULL DEFAULT 'active',
  last_seen_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE ON public.profiles TO authenticated;
GRANT ALL ON public.profiles TO service_role;
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

CREATE TABLE public.user_roles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role public.app_role NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, role)
);
GRANT SELECT ON public.user_roles TO authenticated;
GRANT ALL ON public.user_roles TO service_role;
ALTER TABLE public.user_roles ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public.has_role(_user_id uuid, _role public.app_role)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = _user_id AND role = _role)
$$;
CREATE OR REPLACE FUNCTION public.is_staff(_user_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = _user_id AND role IN ('admin','editor'))
$$;

CREATE POLICY "own profile read" ON public.profiles FOR SELECT TO authenticated USING (auth.uid() = id OR public.is_staff(auth.uid()));
CREATE POLICY "own profile update" ON public.profiles FOR UPDATE TO authenticated USING (auth.uid() = id OR public.has_role(auth.uid(),'admin'));
CREATE POLICY "own profile insert" ON public.profiles FOR INSERT TO authenticated WITH CHECK (auth.uid() = id);
CREATE POLICY "own roles read" ON public.user_roles FOR SELECT TO authenticated USING (auth.uid() = user_id OR public.has_role(auth.uid(),'admin'));
CREATE TRIGGER trg_profiles_upd BEFORE UPDATE ON public.profiles FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE OR REPLACE FUNCTION public.guard_profile_status() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.status IS DISTINCT FROM OLD.status AND NOT public.has_role(auth.uid(),'admin') THEN
    NEW.status = OLD.status;
  END IF;
  RETURN NEW;
END; $$;
CREATE TRIGGER trg_profiles_guard BEFORE UPDATE ON public.profiles FOR EACH ROW EXECUTE FUNCTION public.guard_profile_status();

CREATE TABLE public.viewer_profiles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  name text NOT NULL,
  avatar_url text,
  is_kids boolean NOT NULL DEFAULT false,
  preferences jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ON public.viewer_profiles(user_id);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.viewer_profiles TO authenticated;
GRANT ALL ON public.viewer_profiles TO service_role;
ALTER TABLE public.viewer_profiles ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own viewer profiles" ON public.viewer_profiles FOR ALL TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE TRIGGER trg_vp_upd BEFORE UPDATE ON public.viewer_profiles FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE OR REPLACE FUNCTION public.handle_new_user() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  INSERT INTO public.profiles (id, name, email, avatar_url)
  VALUES (NEW.id, COALESCE(NEW.raw_user_meta_data->>'name', NEW.raw_user_meta_data->>'full_name', split_part(NEW.email,'@',1)), NEW.email, NEW.raw_user_meta_data->>'avatar_url');
  INSERT INTO public.user_roles (user_id, role) VALUES (NEW.id, 'user');
  IF NOT EXISTS (SELECT 1 FROM public.user_roles WHERE role = 'admin') THEN
    INSERT INTO public.user_roles (user_id, role) VALUES (NEW.id, 'admin');
  END IF;
  INSERT INTO public.viewer_profiles (user_id, name) VALUES (NEW.id, COALESCE(NEW.raw_user_meta_data->>'name', NEW.raw_user_meta_data->>'full_name', split_part(NEW.email,'@',1)));
  RETURN NEW;
END; $$;
CREATE TRIGGER on_auth_user_created AFTER INSERT ON auth.users FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

CREATE TABLE public.categories (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  slug text NOT NULL UNIQUE,
  description text,
  image_url text,
  status public.content_status NOT NULL DEFAULT 'published',
  sort_order int NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE public.genres (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  slug text NOT NULL UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.movies (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title text NOT NULL,
  original_title text,
  slug text UNIQUE,
  description text,
  poster_url text,
  backdrop_url text,
  trailer_url text,
  release_year int,
  duration_minutes int,
  age_rating text,
  quality text,
  language text,
  country text,
  status public.content_status NOT NULL DEFAULT 'draft',
  featured boolean NOT NULL DEFAULT false,
  category_id uuid REFERENCES public.categories(id) ON DELETE SET NULL,
  external_source text,
  external_id text,
  sort_order int NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ON public.movies(status, featured);

CREATE TABLE public.series (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title text NOT NULL,
  original_title text,
  slug text UNIQUE,
  description text,
  poster_url text,
  backdrop_url text,
  trailer_url text,
  release_year int,
  age_rating text,
  status public.content_status NOT NULL DEFAULT 'draft',
  featured boolean NOT NULL DEFAULT false,
  category_id uuid REFERENCES public.categories(id) ON DELETE SET NULL,
  external_source text,
  external_id text,
  sort_order int NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ON public.series(status, featured);
CREATE TABLE public.seasons (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  series_id uuid NOT NULL REFERENCES public.series(id) ON DELETE CASCADE,
  season_number int NOT NULL,
  title text,
  poster_url text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (series_id, season_number)
);
CREATE TABLE public.episodes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  season_id uuid NOT NULL REFERENCES public.seasons(id) ON DELETE CASCADE,
  episode_number int NOT NULL,
  title text NOT NULL,
  description text,
  thumbnail_url text,
  duration_minutes int,
  release_date date,
  status public.content_status NOT NULL DEFAULT 'draft',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (season_id, episode_number)
);

CREATE TABLE public.channels (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  slug text UNIQUE,
  logo_url text,
  description text,
  category_id uuid REFERENCES public.categories(id) ON DELETE SET NULL,
  status public.content_status NOT NULL DEFAULT 'draft',
  featured boolean NOT NULL DEFAULT false,
  sort_order int NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.movie_genres (movie_id uuid REFERENCES public.movies(id) ON DELETE CASCADE, genre_id uuid REFERENCES public.genres(id) ON DELETE CASCADE, PRIMARY KEY (movie_id, genre_id));
CREATE TABLE public.series_genres (series_id uuid REFERENCES public.series(id) ON DELETE CASCADE, genre_id uuid REFERENCES public.genres(id) ON DELETE CASCADE, PRIMARY KEY (series_id, genre_id));

CREATE TABLE public.playback_sources (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  content_kind public.content_kind NOT NULL,
  content_id uuid NOT NULL,
  url text NOT NULL,
  provider text,
  quality text,
  drm jsonb NOT NULL DEFAULT '{}'::jsonb,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ON public.playback_sources(content_kind, content_id);

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['categories','genres','movies','series','seasons','episodes','channels','movie_genres','series_genres'] LOOP
    EXECUTE format('GRANT SELECT ON public.%I TO anon', t);
    EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON public.%I TO authenticated', t);
    EXECUTE format('GRANT ALL ON public.%I TO service_role', t);
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('CREATE POLICY "staff manage" ON public.%I FOR ALL TO authenticated USING (public.is_staff(auth.uid())) WITH CHECK (public.is_staff(auth.uid()))', t);
  END LOOP;
END $$;
CREATE POLICY "public read" ON public.categories FOR SELECT TO anon, authenticated USING (status = 'published');
CREATE POLICY "public read" ON public.genres FOR SELECT TO anon, authenticated USING (true);
CREATE POLICY "public read" ON public.movies FOR SELECT TO anon, authenticated USING (status = 'published');
CREATE POLICY "public read" ON public.series FOR SELECT TO anon, authenticated USING (status = 'published');
CREATE POLICY "public read" ON public.seasons FOR SELECT TO anon, authenticated USING (EXISTS (SELECT 1 FROM public.series s WHERE s.id = series_id AND s.status = 'published'));
CREATE POLICY "public read" ON public.episodes FOR SELECT TO anon, authenticated USING (status = 'published');
CREATE POLICY "public read" ON public.channels FOR SELECT TO anon, authenticated USING (status = 'published');
CREATE POLICY "public read" ON public.movie_genres FOR SELECT TO anon, authenticated USING (true);
CREATE POLICY "public read" ON public.series_genres FOR SELECT TO anon, authenticated USING (true);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.playback_sources TO authenticated;
GRANT ALL ON public.playback_sources TO service_role;
ALTER TABLE public.playback_sources ENABLE ROW LEVEL SECURITY;
CREATE POLICY "staff manage" ON public.playback_sources FOR ALL TO authenticated USING (public.is_staff(auth.uid())) WITH CHECK (public.is_staff(auth.uid()));

CREATE TRIGGER t1 BEFORE UPDATE ON public.categories FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
CREATE TRIGGER t1 BEFORE UPDATE ON public.movies FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
CREATE TRIGGER t1 BEFORE UPDATE ON public.series FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
CREATE TRIGGER t1 BEFORE UPDATE ON public.seasons FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
CREATE TRIGGER t1 BEFORE UPDATE ON public.episodes FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
CREATE TRIGGER t1 BEFORE UPDATE ON public.channels FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
CREATE TRIGGER t1 BEFORE UPDATE ON public.playback_sources FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TABLE public.watch_history (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  viewer_profile_id uuid REFERENCES public.viewer_profiles(id) ON DELETE CASCADE,
  content_kind public.content_kind NOT NULL,
  content_id uuid NOT NULL,
  position_seconds int NOT NULL DEFAULT 0,
  progress_percent numeric(5,2) NOT NULL DEFAULT 0,
  watched_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, viewer_profile_id, content_kind, content_id)
);
CREATE TABLE public.watchlist (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  viewer_profile_id uuid REFERENCES public.viewer_profiles(id) ON DELETE CASCADE,
  content_kind public.content_kind NOT NULL,
  content_id uuid NOT NULL,
  added_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, viewer_profile_id, content_kind, content_id)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.watch_history, public.watchlist TO authenticated;
GRANT ALL ON public.watch_history, public.watchlist TO service_role;
ALTER TABLE public.watch_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.watchlist ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own history" ON public.watch_history FOR ALL TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE POLICY "own list" ON public.watchlist FOR ALL TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

CREATE TABLE public.site_settings (
  id int PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  platform_name text NOT NULL DEFAULT 'Streaming',
  logo_url text,
  favicon_url text,
  colors jsonb NOT NULL DEFAULT '{}'::jsonb,
  banner jsonb NOT NULL DEFAULT '{}'::jsonb,
  texts jsonb NOT NULL DEFAULT '{}'::jsonb,
  social_links jsonb NOT NULL DEFAULT '{}'::jsonb,
  general jsonb NOT NULL DEFAULT '{}'::jsonb,
  updated_at timestamptz NOT NULL DEFAULT now()
);
INSERT INTO public.site_settings (id) VALUES (1);
GRANT SELECT ON public.site_settings TO anon;
GRANT SELECT, UPDATE ON public.site_settings TO authenticated;
GRANT ALL ON public.site_settings TO service_role;
ALTER TABLE public.site_settings ENABLE ROW LEVEL SECURITY;
CREATE POLICY "public read" ON public.site_settings FOR SELECT TO anon, authenticated USING (true);
CREATE POLICY "admin update" ON public.site_settings FOR UPDATE TO authenticated USING (public.has_role(auth.uid(),'admin')) WITH CHECK (public.has_role(auth.uid(),'admin'));
CREATE TRIGGER t1 BEFORE UPDATE ON public.site_settings FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TABLE public.audit_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_id uuid,
  action text NOT NULL,
  entity text NOT NULL,
  entity_id text,
  changes jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ON public.audit_logs(created_at DESC);
GRANT SELECT ON public.audit_logs TO authenticated;
GRANT ALL ON public.audit_logs TO service_role;
ALTER TABLE public.audit_logs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "admin read" ON public.audit_logs FOR SELECT TO authenticated USING (public.has_role(auth.uid(),'admin'));

CREATE OR REPLACE FUNCTION public.audit_trigger() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  INSERT INTO public.audit_logs (actor_id, action, entity, entity_id, changes)
  VALUES (auth.uid(), lower(TG_OP), TG_TABLE_NAME,
    COALESCE((to_jsonb(NEW)->>'id'), (to_jsonb(OLD)->>'id')),
    jsonb_build_object('old', CASE WHEN TG_OP <> 'INSERT' THEN to_jsonb(OLD) END, 'new', CASE WHEN TG_OP <> 'DELETE' THEN to_jsonb(NEW) END));
  RETURN COALESCE(NEW, OLD);
END; $$;
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['categories','genres','movies','series','seasons','episodes','channels','playback_sources','site_settings','user_roles'] LOOP
    EXECUTE format('CREATE TRIGGER audit AFTER INSERT OR UPDATE OR DELETE ON public.%I FOR EACH ROW EXECUTE FUNCTION public.audit_trigger()', t);
  END LOOP;
END $$;

CREATE OR REPLACE FUNCTION public.get_playback_url(_kind public.content_kind, _content_id uuid)
RETURNS text LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE u text;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'not authenticated'; END IF;
  IF EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND status <> 'active') THEN RAISE EXCEPTION 'account inactive'; END IF;
  SELECT url INTO u FROM public.playback_sources WHERE content_kind = _kind AND content_id = _content_id AND is_active ORDER BY created_at DESC LIMIT 1;
  RETURN u;
END; $$;
REVOKE EXECUTE ON FUNCTION public.get_playback_url FROM anon, public;
GRANT EXECUTE ON FUNCTION public.get_playback_url TO authenticated;

CREATE POLICY "media read" ON storage.objects FOR SELECT TO anon, authenticated USING (bucket_id = 'media');
CREATE POLICY "media staff write" ON storage.objects FOR INSERT TO authenticated WITH CHECK (bucket_id = 'media' AND public.is_staff(auth.uid()));
CREATE POLICY "media staff update" ON storage.objects FOR UPDATE TO authenticated USING (bucket_id = 'media' AND public.is_staff(auth.uid()));
CREATE POLICY "media staff delete" ON storage.objects FOR DELETE TO authenticated USING (bucket_id = 'media' AND public.is_staff(auth.uid()));