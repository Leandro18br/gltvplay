# Public TV remote navigation
- [ ] Implement reusable directional focus, contextual return and stable restoration without changing catalog or sources.
- [ ] Integrate carousels, detail/episode controls and native players; preserve text fields and Radix widgets.
- [ ] Run rule/regression tests and real signed-in keyboard flows; report device/provider limitations.

# Player advertising and unauthorized buttons
- [x] Identified the app-owned retry/report/fullscreen row; no app-owned ad integration. Existing BugouMods episode sources use provider Embed Free URLs, whose external page contains advertising code and provider-owned actions; no BugouMods movie sources exist.
- [x] Removed the auxiliary EmbedPlayer row and wrapper while preserving iframe permissions, URL, loading and safety checks; native controls, source selection and existing page actions remain unchanged.
- [x] Seven regression tests pass and build OK. Authenticated published/local Jesse James and #blackAF episode 1 resolve sources; local embed auxiliary row is absent, published retains old row. No API/token/catalog/auth changes.
- [ ] Confirm actual movie/episode playback and working media controls: both tested sources remain at time 0 with media error 4, including after provider Play. Provider must supply a documented ad-free VIP playback option; its current Embed Free response enables advertising and owns Voltar/Embed/Recarregar actions. Confirm cleanup on published site after user-authorized publication; no deployment requested.

# Client and reseller profiles
- [x] Remove client profile password and avatar editing; reseller has no self-service profile or upload/password settings. ADM profile, administrative recovery and account names unchanged.
- [x] Verified actual client profile at 320/390/1280 with no overflow, password/file inputs or runtime errors; viewer profiles intact. Actual reseller dashboard and access-list tab verified at those widths; no profile password/file inputs. ADM password field remains. Routing test passes; build OK. No account values or passwords changed.

# Series detail visual parity
- [x] Reuse movie details and 260px faded banner; mount the existing player only for an explicitly selected episode and scroll after mounting.
- [x] Nine tests pass; authenticated The Rookie flow verified: initial/reload without player, episode 2 then 1 request distinct sources once, post-mount scroll reaches y=0; season change makes no extra source request or top scroll. Widths 320/360/390/412/768/1024/1280 fit with a 260px banner. Actual video playback remains unconfirmed: sampled existing source reports media error 4; no source/data changes.

# 2026 catalog and default categories
- [x] Inspect existing categories and import paths; preserve existing associations and playback.
- [x] Add reusable default categories and additive movie/series associations for existing and new imports.
- [x] Discover all TMDB 2026 release pages: 38,899 unique candidates; implement bounded resumable metadata-only import/completion.
- [x] Verify partial real execution: 1,032 created without sources; 15 existing movies completed (215 fields); 411 existing outcomes skipped; 3,064 movies and 18 series have defaults; no legacy category link missing; all 2,598 playback rows unchanged by hash; public categories and Home and admin readback checked; 23 tests pass and build OK.
- [ ] Finish remaining 37,497 queued items using Continue update in ADM → APIs e Integrações; execution requires more active processing time than the completed sessions. No worker runs after this turn. Review 349 uncertain matches and 14 existing TMDB-ID conflicts without merging/deleting records.

# Individual TMDB metadata completion
- [x] Reuse TMDB lookup/cache to resolve an existing movie or series and fill only missing metadata through an atomic staff-only allowlisted RPC, preserving playback, existing values and M3U provenance.
- [x] Add individual admin update controls, ambiguous-match selection, result counts, live editor refresh and separate existing-season/episode completion.
- [x] 31 tests passed and build OK. Authenticated Dragon Tiger Gate M3U update filled 14 fields and linked 2 existing genres; 009-1 M3U series filled 16 fields and linked 7 genres after explicit match selection. Episode completion filled 75 fields for 12 existing episodes; unmatched episode preserved, all 13 IDs and 13 sources unchanged. O Mentalista re-run preserved 151 episodes and 151 sources. Database rejected manual/internal overwrites; editor remained open, controls fit 320/390/768/1280.

# Public catalog grids
- [x] Use responsive multi-row movie/series grids outside Home; preserve Home and channel carousels and all data behavior.
- [x] Verify Home, movies, series, category Ação (60 cards), search and related titles (16 cards); 320/390/649/768/1024/1280 widths show no horizontal overflow. Columns adapt from 2 to 6. Movie links, genre/sort filters, live search and progressive loading (48 to 72 cards) work; routing test passed and build OK. Existing header-brand hydration warnings observed; shared header/data loading untouched by this presentation-only request.

# Home management
- [x] Persist draft and published Home configurations with staff permissions, validation and audit.
- [x] Build section/banner editor, drag ordering, filters, manual selection and device previews.
- [x] Render only published configuration, synchronize updates and improve mobile carousel/navigation.
- [x] Test configuration rules and verify authenticated editing, preview and publication.

# Authorized embeds
- [ ] Add validated playback types, principal sources, domain policy and diagnostic storage.
- [ ] Integrate movie/episode source editing and admin embed preview/settings.
- [ ] Render sandboxed embeds with loading/retry and episode selection; preserve existing video playback.
- [ ] Run security tests and verify the authenticated admin-to-player flow.
# M3U large lists
- [x] Diagnose the "Internal server error" (worker CPU limit during single-request sync).
- [x] Resumable chunked indexing into an M3U catalog; chunked finalize.
- [x] Explore with server-side search/filters/pagination; single, selected and per-lot import without duplicates.
- [x] Verified with the real list (391k entries) and a no-duplicate import test.

# M3U responsive interface
- [x] Fit M3U list cards, forms, explorer, progress and actions within the available width without changing import logic.
- [x] Verify authenticated M3U interface at 320, 360, 375, 390, 412, 768, 1024 and desktop widths; real list search/selection, internal scrolling and create/edit dialogs checked. All nine existing M3U tests passed; no import or indexing rerun to avoid modifying catalog data.

# Public player positioning
- [x] Place the existing movie/series player before poster and details, just below navigation, with a proportional wide thumbnail.
- [x] Verify authenticated movie/series layout at 320, 390, 768 and 1280 widths: player at y=80, own thumbnail, no overflow or external player before Play. Mobile and desktop Play resolve existing sources; selecting episode 2 requests a different episode ID. Sixteen existing tests pass.
- [ ] Confirm successful media playback: blocked by the tested existing movie and episode sources returning browser media error 4 (no supported source); URLs, player logic and catalog remain unchanged.

# Professional movie and episode controls
- [x] Add shared native-video controls to inline and full movie/episode playback; retain existing HLS engines, embed controls, authorization and server selection.
- [x] Verify controls with isolated WebM media: play/pause, clamped ±10s, accessible progress/volume sliders, mute, speed, fullscreen, keyboard, auto-hide, server selection and volume persistence. All 21 existing playback/routing tests pass. Screenshots and bounds verified at 320, 360, 375, 390, 412, 768, 1024 and 1280; no horizontal overflow or central/progress overlap.
- [ ] Confirm real MP4/HLS and episode reproduction: existing catalog samples returned media error 4; isolated H.264 MP4 also failed in this automated Chromium, so provider failure cannot be inferred from that code alone. HLS quality selection remains based only on actual manifest levels; end-to-end HLS playback and compatible-device transmission remain unverified. Transmission is hidden when no compatible device is available. Catalog URLs, sources and data were not modified.
