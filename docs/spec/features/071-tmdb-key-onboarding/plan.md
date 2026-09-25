---
title: TMDB key onboarding on the home page — Implementation Plan
spec_version: 0.1.0
last_updated: 2026-09-25
status: Approved
---

# PLAN: TMDB key onboarding on the home page (`plan.md`)

## Approach

Two small, independent signals, both added to things that already exist:

- **"No key"** is a pure Settings read. `MediaCapabilitiesService.read()`
  (`services/api/src/media/media-capabilities.service.ts`) already reads the Settings map for every
  user and backs `mediaCapabilities`; it gains `catalogKeyConfigured`. `web` already fetches
  `mediaCapabilities` on `/` (`getMediaCapabilities`, `cache()`-deduped), so no new query exists and
  no TMDB call is made (NFR-2). Alternative rejected: a separate `catalogStatus` query — a second
  round trip for one boolean, and a second place Settings get interpreted.
- **"Rejected key"** is only knowable by asking TMDB, and `/` already asks via `popularMedia`
  (`services/api/src/media/popular-media.service.ts`). Today `TmdbClient`
  (`services/api/src/clients/tmdb/client.ts`) throws a plain `Error` with the status only in its
  message, and `PopularMediaService` maps every throw to `catalog_unavailable`. The client gains a
  typed error carrying the HTTP status; `PopularMediaService` maps 401 to the new
  `error.media.catalog_unauthorized` key and everything else as before. Only `popularMedia` maps it
  (NFR-3); `searchMedia`/`addMedia` keep their behaviour even though they see the same typed error.

On `web`, the onboarding panel is one new server-rendered component under
`components/billboard/`, rendered by `app/(dashboard)/page.tsx` in place of the carousels. The
page already knows the user (`getCurrentUser()` → `isAdmin`) through the dashboard layout's
deduped `me` query. Because `getPopularMedia` currently `throw new Error(message)`s — which loses
`extensions.i18n.key` at the boundary, exactly as `lib/graphql-error.ts`'s `toActionError` comment
describes — it must start surfacing the key. It moves to the repo's existing
`{ error, errorKey }` shape (`toActionError`), its only caller being `page.tsx`.

## Order of Work

| Step | Service | Why it must come here |
| :-- | :-- | :-- |
| 1 | `api` | Owns `catalogKeyConfigured` and the new error key; `schema.gql` must carry the field before `web` queries it (an unknown field fails the whole `mediaCapabilities` query, which would 500 every dashboard page, not just `/`). |
| 2 | `web` | Consumes both. |

The contract is small and frozen by this plan, so `web` may be *written* in parallel with `api`,
but must not be *merged or run* against an `api` that lacks the field.

## Contract Freeze

The `## GraphQL Contract Delta` in `spec.md` is frozen as of `status: Approved`.

- **`catalogKeyConfigured` is a boolean, not the key or a masked key.** An implementer may want to
  expose "last 4 chars" to help diagnose; NFR-1 forbids it — `mediaCapabilities` is readable by
  every user.
- **Whitespace-only key counts as not configured.** A trimmed-empty value reads `false`.
- **Only `popularMedia` emits `catalog_unauthorized`.** Tempting to map it in `searchMedia` too
  "for consistency"; out of scope (NFR-3) and `web`'s search does not handle the key.
- **The error stays a `ServiceUnavailableException`** (same helper as `catalog_unavailable`), so
  the HTTP/GraphQL status class does not change for any existing consumer.

## Migrations

None. `movie_db_api_key` already exists as a Settings row.

## Risks

| Risk | How it fails | Mitigation |
| :-- | :-- | :-- |
| `mediaCapabilities` is fetched by the dashboard layout on every page | A typo'd field in `web`'s query string fails the whole query → every page errors, not just `/` | `web` adds the field only after `api` step lands; manual pass loads `/movies` too |
| `web` still `throw`s from `getPopularMedia` | The key is lost, the 401 case silently shows the generic error forever — no error anywhere | `web` plan mandates `toActionError`; AC-3 checks it live |
| TMDB answers something other than 401 for a bad bearer | Onboarding never shows for a bad key | Verified live by AC-3 with `garbage`; if TMDB returns another status, amend the spec, don't widen locally |
| Redis cache in `PopularMediaService` | A cached popular list keeps rendering after the key is removed | Accepted: with a cache hit the catalog genuinely works; `catalogKeyConfigured=false` still wins on `/` because `web` skips `popularMedia` entirely when it is false |
| Links rot | Tutorial points at dead TMDB pages | Links are copy in `messages/*.json`-adjacent constants in one place; AC-6 checks by hand |
| Invalid key cached on the error path | none — errors are not cached (only successful rows are written) | Test asserts no cache write on the 401 path |

## Verification

```bash
bin/cli api npx --no tsc --noEmit
bin/npm api test
bin/cli web npx --no tsc --noEmit
bin/npm web run build
bin/cli web node scripts/check-messages.mjs
```

Manual pass (dev stack, one admin + one non-admin):

1. Settings → clear the TMDB key, save. As admin open `/` → AC-1 (watch `bin/cli api` logs / Redis
   for no TMDB call). Open `/movies` → still renders (Risks row 1).
2. Same as non-admin → AC-2.
3. Set key `garbage` → `/` shows the notice + panel (AC-3).
4. Set a valid key, block egress from `api` (e.g. `docker network disconnect` of an external
   network, or point `movie_db_host` at an unreachable host) → generic error, no panel (AC-4).
   Restore.
5. Valid key → carousels (AC-5). Click every panel link (AC-6).
6. GraphQL as non-admin: `{ mediaCapabilities { catalogKeyConfigured } }` → boolean only (AC-7).
