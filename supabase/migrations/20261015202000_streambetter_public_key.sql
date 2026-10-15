-- Optional StreamBetter Creator public embed key. This key is designed to be visible in iframe URLs.
ALTER TABLE public.site_settings ADD COLUMN IF NOT EXISTS streambetter_public_key text;
