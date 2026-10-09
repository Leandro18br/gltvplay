-- seen_gen changes on every sync; indexing it prevented HOT updates, so re-syncing an unchanged list rewrote all 9 indexes per row.
DROP INDEX IF EXISTS public.m3u_items_gen;
ALTER TABLE public.m3u_items SET (fillfactor = 85);