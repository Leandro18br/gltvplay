# Auth rules
- `area-client.ts`: client area = generated client, admin/reseller = own storageKey; guards use `getAreaClient(area)` explicitly, in-page code uses the path-based proxy; `src/start.ts` attaches the current area bearer. Why: independent sessions.
- Admin gate uses shared `checkAdminAccess` (`admin-access.ts`): one in-flight check, short per-token cache, distinct unauthenticated/forbidden/error states. Why: no false denials or repeated role queries.
