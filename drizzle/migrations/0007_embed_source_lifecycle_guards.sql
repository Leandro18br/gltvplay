CREATE OR REPLACE FUNCTION public.guard_embed_source() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$ BEGIN
IF NEW.source_type='embed' AND NEW.is_active AND NOT public.embed_url_allowed(NEW.url) THEN RAISE EXCEPTION 'Domínio de embed não autorizado ou URL inválida'; END IF;
IF NEW.content_kind='series' THEN RAISE EXCEPTION 'Configure a reprodução por episódio'; END IF;
IF TG_OP='INSERT' AND NOT (CASE NEW.content_kind WHEN 'movie' THEN EXISTS(SELECT 1 FROM public.movies WHERE id=NEW.content_id) WHEN 'episode' THEN EXISTS(SELECT 1 FROM public.episodes WHERE id=NEW.content_id) WHEN 'channel' THEN EXISTS(SELECT 1 FROM public.channels WHERE id=NEW.content_id) ELSE false END) THEN RAISE EXCEPTION 'Conteúdo não encontrado'; END IF;
RETURN NEW; END $$;
CREATE FUNCTION public.cleanup_content_playback() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$ BEGIN
DELETE FROM public.playback_sources WHERE content_id=OLD.id AND content_kind=(CASE TG_TABLE_NAME WHEN 'movies' THEN 'movie'::public.content_kind WHEN 'episodes' THEN 'episode'::public.content_kind ELSE 'channel'::public.content_kind END);
RETURN OLD; END $$;
CREATE TRIGGER movie_playback_cleanup AFTER DELETE ON public.movies FOR EACH ROW EXECUTE FUNCTION public.cleanup_content_playback();
CREATE TRIGGER episode_playback_cleanup AFTER DELETE ON public.episodes FOR EACH ROW EXECUTE FUNCTION public.cleanup_content_playback();
CREATE TRIGGER channel_playback_cleanup AFTER DELETE ON public.channels FOR EACH ROW EXECUTE FUNCTION public.cleanup_content_playback();