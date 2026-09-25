---
title: TMDB key onboarding on the home page — web slice
service: web
last_updated: 2026-09-25
status: Approved
---

# PLAN: TMDB key onboarding on the home page — `web` (`web/plan.md`)

## Scope

Render, on `/` only, the onboarding panel (privacy reason first, then five steps) instead of the
catalog error when no key is configured or TMDB rejected it. `api` provides
`catalogKeyConfigured` and `error.media.catalog_unauthorized`; `web` never reads the key itself and
never changes `/search`.

## Files

| File | New / Modified | What changes |
| :-- | :-- | :-- |
| `services/web/src/types/media.ts` | Modified | `MediaCapabilities.catalogKeyConfigured: boolean` |
| `services/web/src/actions/media.ts` | Modified | query string gains the field; `getPopularMedia` returns `{ items } \| { error, errorKey }` via `toActionError` instead of throwing (auth errors still go through `redirectToClearSession` first) |
| `services/web/src/app/(dashboard)/page.tsx` | Modified | branch: no key → panel, no `popularMedia` calls; any carousel result with `errorKey === 'error.media.catalog_unauthorized'` → panel with the rejected-key notice (once, not per carousel); else today's rendering |
| `services/web/src/components/billboard/TmdbKeyOnboarding.tsx` | New | server component; props `isAdmin`, `keyRejected` |
| `services/web/messages/en.json`, `es.json` | Modified | `error.media.catalog_unauthorized` + a `billboard.tmdbOnboarding.*` block |

## Existing code to reuse

- `getMediaCapabilities()` (`actions/media.ts`) — already `cache()`-deduped with the layout; add
  the field to `MEDIA_CAPABILITIES_QUERY`, no new call.
- `toActionError` (`lib/graphql-error.ts`) — the repo's way to keep `extensions.i18n.key` across a
  server-action boundary; do not invent another error shape.
- `getCurrentUser()` (`actions/auth.ts`) — `isAdmin`, deduped with the layout's `me` query.
- `unstable_rethrow` on rejections in `page.tsx` stays: the session-redirect path must still bounce
  to `/login`.
- Existing `next-intl` `t.rich` / `getTranslations` for copy with embedded links.

## Steps

1. Types + query field + `getPopularMedia` return shape.
2. `TmdbKeyOnboarding`: (a) optional rejected-key notice; (b) the privacy reason (REQ-5); (c) an
   ordered list of the five steps with these literal URLs, `target="_blank" rel="noopener
   noreferrer"`, kept as constants in the component, not in the message catalogs:
   `https://www.themoviedb.org/signup`, `https://www.themoviedb.org/login`,
   `https://www.themoviedb.org/settings/api`, `https://www.themoviedb.org/api-terms-of-use`;
   step 4 names "API Read Access Token" and warns it is not the short "API Key"; (d) the note that
   only an administrator can finish; step 5 links to `/settings` when `isAdmin`, otherwise says to
   ask an administrator with no link.
3. `page.tsx` branching as in Files.
4. Copy in `en`/`es` (Rioplatense), including `error.media.catalog_unauthorized`.

## Contract obligations

Consumes `mediaCapabilities.catalogKeyConfigured: Boolean!` and, from `popularMedia`:

| errorKey | web does |
| :-- | :-- |
| `error.media.catalog_unauthorized` | onboarding panel + rejected-key notice |
| `error.media.catalog_unavailable` / any other | today's `initialError` in `PopularCarousel` |
| auth error | `redirectToClearSession` (unchanged) |

## Tests

`web` has no test suite (`services/web/CLAUDE.md`). The silent failure — the key lost at the action
boundary so the rejected-key panel never shows — is covered by the manual AC-3 in `../plan.md`.

## Done when

```bash
bin/cli web npx --no tsc --noEmit        # 0 errors
bin/npm web run build                    # exits 0
bin/cli web node scripts/check-messages.mjs   # no en/es drift
```
