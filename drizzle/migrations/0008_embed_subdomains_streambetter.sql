CREATE OR REPLACE FUNCTION public.embed_url_allowed(u text)
 RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
SELECT char_length(u) <= 2048 AND u ~ '^https://[a-z0-9.-]+(/[^[:space:]<>]*)?$' AND EXISTS(
  SELECT 1 FROM public.embed_domains d
  WHERE split_part(split_part(u,'://',2),'/',1) = d.hostname
     OR split_part(split_part(u,'://',2),'/',1) LIKE '%.' || d.hostname);
$function$;

INSERT INTO public.embed_domains(hostname) VALUES ('streambetter.shop') ON CONFLICT DO NOTHING;

UPDATE public.playback_sources SET source_type='embed'
WHERE source_type='url' AND url LIKE 'https://streambetter.shop/%' AND content_kind IN ('movie','episode');