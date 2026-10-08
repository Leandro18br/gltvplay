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
- [ ] Verify movie Play and episode-specific series playback on mobile and desktop without changing catalog or sources.
