---
title: TMDB key onboarding on the home page — api slice
service: api
last_updated: 2026-09-25
status: Approved
---

# PLAN: TMDB key onboarding on the home page — `api` (`api/plan.md`)

## Scope

Expose whether a TMDB key is configured on `mediaCapabilities`, and make `popularMedia` report a
key TMDB rejected (HTTP 401) under a distinct i18n key. No Prisma change, no new query, no change
to `searchMedia`/`addMedia` error mapping. The onboarding copy and UI are `web`'s.

## Files

| File | New / Modified | What changes |
| :-- | :-- | :-- |
| `services/api/src/clients/tmdb/client.ts` | Modified | `fetchResults`/`fetchOne` throw a typed error carrying `status` instead of a bare `Error` |
| `services/api/src/clients/tmdb/errors.ts` | New | `TmdbHttpError extends Error { status: number }` (message format unchanged) |
| `services/api/src/media/entities/media-capabilities.entity.ts` | Modified | `@Field() catalogKeyConfigured: boolean` |
| `services/api/src/media/media-capabilities.service.ts` | Modified | `read()` computes it from `movie_db_api_key` (trimmed non-empty) |
| `services/api/src/media/popular-media.service.ts` | Modified | catch maps `TmdbHttpError` with `status === 401` → `MEDIA_CATALOG_UNAUTHORIZED` |
| `services/api/src/i18n/error-keys.ts` | Modified | `MEDIA_CATALOG_UNAUTHORIZED: 'error.media.catalog_unauthorized'` |
| `services/api/src/i18n/messages.en.ts` | Modified | "TMDB rejected the configured API key." |
| `services/api/src/schema.gql` | Regenerated | exactly the one field |

## Existing code to reuse

- `MediaCapabilitiesService.read()` — the one place Settings are read into capabilities; same
  `settingsService.getMap()` call, no second read.
- `i18nError.serviceUnavailable(...)` — same helper `catalog_unavailable` uses.
- The existing `try { rows = await this.tmdb.popular(...) } catch` in `PopularMediaService` — extend
  it, don't add a second wrapper; keep the "only the TMDB call is wrapped" rule.

## Steps

1. Add `TmdbHttpError` and throw it from both `fetchResults` and `fetchOne` (same message text as
   today, so logs don't change).
2. Add the error key + English message.
3. `PopularMediaService`: in the catch, `instanceof TmdbHttpError && status === 401` →
   `MEDIA_CATALOG_UNAUTHORIZED`; otherwise unchanged. No cache write on either error path.
4. Entity field + `read()`: `(map['movie_db_api_key'] ?? '').trim() !== ''`.
5. Regenerate `schema.gql`; confirm its diff is exactly `catalogKeyConfigured: Boolean!`.

## Contract obligations

Expose exactly the `MediaCapabilities.catalogKeyConfigured: Boolean!` in `../spec.md`, readable by
any authenticated user, never derived from anything but emptiness of the key. Emit
`error.media.catalog_unauthorized` from `popularMedia` only, on TMDB 401 only.

## Tests

- `src/media/popular-media.service.spec.ts` — 401 → `catalog_unauthorized`; 500 / network error →
  still `catalog_unavailable` (the silent failure is a 401 downgraded to the generic key, or every
  failure upgraded to "bad key"); no cache write on 401.
- `src/media/media-capabilities.service.spec.ts` (create if absent) — empty, whitespace, absent
  row → `false`; real value → `true`.
- `src/clients/tmdb/client.spec.ts` — a non-ok response throws `TmdbHttpError` with the status.

## Done when

```bash
bin/cli api npx --no tsc --noEmit   # 0 errors
bin/npm api test                    # all green, count up from 726
git status --short services/api/prisma   # empty
```
