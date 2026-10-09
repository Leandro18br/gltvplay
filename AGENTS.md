<!-- LOVABLE:BEGIN -->
> [!IMPORTANT]
> This project is connected to [Lovable](https://lovable.dev). Avoid rewriting
> published git history — force pushing, or rebasing/amending/squashing commits
> that are already pushed — as it rewrites history on Lovable's side and the
> user will likely lose their project history.
>
> Commits you push to the connected branch sync back to Lovable and show up in
> the editor, so keep the branch in a working state.
<!-- LOVABLE:END -->

## Architecture rules
- All catalog/config data lives in Lovable Cloud tables; public site reads published rows via RLS, never hardcoded content. Why: admin changes must reflect without code changes.
- Roles live in `user_roles` and are checked with `has_role`/`is_staff` SQL functions; first signup becomes admin. Why: prevent privilege escalation.
- Playback sources live only in staff-only `playback_sources` and are resolved through `get_playback_source` for signed-in active users; the legacy URL RPC excludes embeds. Why: preserve private playback authorization across source types.
- History/watchlist/playback reference content polymorphically via `content_kind` + `content_id`. Why: one structure for movies, series, episodes and channels.
- Catalog writes are audited by the `audit_trigger` into `audit_logs`. Why: traceable admin actions.
- Media uploads go to the private `media` storage bucket (public buckets blocked by workspace). Why: workspace policy.
- Admin CRUD screens are config-driven via `ResourceManager` + `src/lib/admin/configs.tsx`; add new admin entities as configs, not bespoke pages. Why: consistency and less code.
- Admin area lives under `/admin` (own ssr:false gate checking `is_staff`); login at `/admin/login` (`admin_.login.tsx`, un-nested). Why: separate admin entry from public auth.
- Catalog import providers live in `src/lib/import/import.functions.ts` (licensed APIs only, keys via server secrets); imports dedupe on (external_source, external_id). Why: pluggable future integrations.
- Public site reads go through query factories in `src/lib/catalog.ts`; viewer data (history/watchlist) through `src/lib/user-data.ts`; signed-in pages (player, Minha lista, Perfil) live under `_authenticated/`. Why: one source for catalog reads and RLS-scoped user data.
- Permission levels: super_admin > admin > editor > user, enforced by RLS (`is_staff` = create/edit, `is_admin` = delete/settings/logs/users) and `admin_set_role`; UI hiding is cosmetic only. Why: backend is the security boundary.
- Viewer history/watchlist rows carry `viewer_profile_id`; active profile is per-device (`useActiveProfile`). Why: multiple profiles per account.
- Public site cache is invalidated by Realtime events on catalog tables (`CatalogSync` in __root) plus periodic refresh. Why: admin changes reflect without reloads.
- Home uses separate draft/published layout snapshots, revision-checked staff RPC writes and public server-side resolution; the bespoke HomeManager composes reusable editors instead of ResourceManager. Why: ordered page composition needs atomic publication and private drafts, unlike ordinary catalog CRUD.
- Home section renderers and validators live in the Home module; preview reuses the public renderer in a staff-only un-nested route and device-sized iframe. Why: previews match the actual page without exposing drafts or duplicating presentation.
- Embed input is parsed to a single URL with shared schemas, checked against admin-authorized HTTPS domains (exact host or subdomain) server-side and in database triggers, and rendered only by the shared EmbedPlayer as a regenerated cross-origin iframe without sandbox. Why: never execute admin-provided HTML in the main document while letting provider players work.
- Primary playback designation uses a staff-only serialized RPC; sources retain type, active state and ordering for future alternatives. Why: multiple sources share one authorization model.
- Cross-origin embed loading is not proof of playback; generic embeds record history without fabricated playback progress, and failures use rate-limited diagnostic reports. Why: provider APIs are required for accurate time and reliable playback signals.
- TMDB reuses cached metadata, staff-only allowlisted completion and locked import deduplication; year jobs persist bounded discovery/item checkpoints. Episode updates touch existing rows only. Why: preserve manual data, identities and playback.
- Fixed genres map TMDB IDs without creation. Organizational categories use additive joins and insert triggers; public category/Home filters read joins, retaining category_id. Why: defaults preserve prior categories and genres.

- Player/catalog integration rules (MegaEmbed, M3U) live in `src/lib/integrations/AGENTS.md`. Why: directory-scoped detail.
- Movie and series details share a player-first layout in DetailHero; InlinePlayer handles playback unchanged by page positioning. Why: keep presentation ordering independent of source and episode logic.
- Movie/episode native videos share VideoPlayerFrame controls around their existing media elements and HLS attachments; channels and cross-origin embeds retain their own players. Why: modernize presentation without changing source authorization, history, provider behavior or channel playback.
- Non-Home movie/series lists use CardGrid/GridSection with shared responsive tracks; Home and channel carousels retain Row. Why: wrapping without data changes.
- Direct MPEG-TS (.ts) URLs play through mpegts.js via `src/lib/playback/mpegts.ts` (lazy import, destroyed on source change), URL unchanged; HLS/MP4/embeds keep their paths. Why: browsers cannot play raw MPEG-TS in <video>.
