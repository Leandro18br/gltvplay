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
- Playback URLs live only in `playback_sources` (staff-only) and are resolved through `get_playback_url` RPC for signed-in active users. Why: keep stream URLs private.
- History/watchlist/playback reference content polymorphically via `content_kind` + `content_id`. Why: one structure for movies, series, episodes and channels.
- Catalog writes are audited by the `audit_trigger` into `audit_logs`. Why: traceable admin actions.
- Media uploads go to the private `media` storage bucket (public buckets blocked by workspace). Why: workspace policy.
- Admin CRUD screens are config-driven via `ResourceManager` + `src/lib/admin/configs.tsx`; add new admin entities as configs, not bespoke pages. Why: consistency and less code.
- Admin area lives under `/admin` (own ssr:false gate checking `is_staff`); login at `/admin/login` (`admin_.login.tsx`, un-nested). Why: separate admin entry from public auth.
- Catalog import providers live in `src/lib/import/import.functions.ts` (licensed APIs only, keys via server secrets); imports dedupe on (external_source, external_id). Why: pluggable future integrations.
- Public site reads go through query factories in `src/lib/catalog.ts`; viewer data (history/watchlist) through `src/lib/user-data.ts`; signed-in pages (player, Minha lista, Perfil) live under `_authenticated/`. Why: one source for catalog reads and RLS-scoped user data.
