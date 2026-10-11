ALTER TABLE public.api_integrations DROP CONSTRAINT IF EXISTS api_integrations_kind_check;
ALTER TABLE public.api_integrations ADD CONSTRAINT api_integrations_kind_check CHECK (kind = ANY (ARRAY['catalog','movie_player','episode_player','live','series']));
ALTER TABLE public.api_integrations DROP CONSTRAINT IF EXISTS api_integrations_provider_check;
ALTER TABLE public.api_integrations ADD CONSTRAINT api_integrations_provider_check CHECK (provider IS NULL OR provider = ANY (ARRAY['bugoumods_live','bugoumods_series']));