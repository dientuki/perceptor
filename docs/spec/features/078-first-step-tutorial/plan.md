---
title: First-step page — TMDB key plus indexer setup — Implementation Plan
spec_version: 0.1.0
last_updated: 2026-09-28
status: Implemented
---

# PLAN: First-step page — TMDB key plus indexer setup (`plan.md`)

## Approach

Two slices, both small, joined by one new read-only query.

`api` adds `Query.indexerStatus` to the **existing** `indexer/` module — no new module. The count
comes from Prowlarr's own `GET /api/v1/indexer`, reached through the **existing**
`ProwlarrClient` (`services/api/src/clients/indexer/client.ts`), which already resolves
`tracker_host`/`tracker_port`/`tracker_api_key` out of `SettingsService.getMap()` and already owns
the one failure posture for a Prowlarr that does not answer
(`i18nError.serviceUnavailable(ERROR_KEYS.INDEXER_UNAVAILABLE)`). That posture is kept inside the
client — it throws, exactly as `search()` does — and `IndexerService` is the layer that turns the
throw into `{ configuredIndexers: 0, reachable: false }` (NFR-2). Putting the swallow in the service
rather than in the client is deliberate: the client keeps one uniform contract for every caller, and
the "an unreachable dependency is an outcome, not an error" decision sits where
`069-title-refresh` already put the same decision for the media server, not scattered into the
transport.

The client's `search()` today inlines its URL and header construction in a private `getData(query)`.
The new call needs the identical base URL and `X-Api-Key` header, so that construction is extracted
into one private request helper both methods use. This is consolidation, not a new layer
(Article X): after the change there is exactly one place in this codebase that knows how to address
Prowlarr, where today there is one and about to be two.

`web` adds one admin-only Server Component page, `/first-step`, assembled from parts that already
exist:

- `TmdbKeyOnboarding` — the component `/` already renders (`071-tmdb-key-onboarding`). It is
  **moved** from `src/components/billboard/` to `src/components/onboarding/` and gains one prop for
  REQ-5's "already configured" marker. Not copied: REQ-3 is explicit that the copy and the links
  live in one place. `/` keeps rendering the same component with the same two props it passes today
  (REQ-4).
- `getEnvironmentInfo()` (`src/actions/environment.ts`) — already admin-only, already
  `redirectToClearSession`-correct for a render pass, already returns the `indexer` endpoint's
  `url`/`port` with `055-environment-panel`'s no-fabricated-host semantics. REQ-10 step 1 reads that
  entry. Nothing new is added to the environment contract.
- `getMediaCapabilities()` (`src/actions/media.ts`) — `cache()`-wrapped, one round trip per request,
  already carries `catalogKeyConfigured`. REQ-5's marker reads it.
- `users/page.tsx`'s admin shape — `getCurrentUser()` first, `notFound()`, **then** the admin
  queries, sequentially and never raced (see Risks).

The three screenshots are plain static assets under `services/web/public/images/first-step/`,
rendered with `next/image` and a string `src` plus explicit `width`/`height` — the house pattern
(`src/app/(auth)/login/page.tsx`). "Clickable to full size" (REQ-12) is an `<a target="_blank">`
around each image. **No lightbox library, no carousel**: this service already refused a carousel
dependency once (`web/CLAUDE.md` § The billboard) and a modal image viewer is the same call.

## Order of Work

| Step | Service | Why it must come here |
| :-- | :-- | :-- |
| 1 | `api` | Owns `Query.indexerStatus`. `web`'s page cannot render a field the schema does not have, and the decorator is what regenerates `schema.gql` (Article IV). |
| 2 | `web` | Consumes it. Also owns every user-facing string and all three assets. |

Steps that genuinely run **in parallel**, only after `status: Approved` freezes the contract:
`web`'s component move, the message-catalog entries and committing the three screenshots depend on
nothing `api` produces and may start immediately. `web`'s *verification* — actually opening
`/first-step` — waits for step 1 to be running in the container.

Nothing else overlaps. There is no `worker` slice (NFR-5) and no `infra` slice: the screenshots are
repository assets served by `web`'s existing `public/`, not a compose or volume change.

## Contract Freeze

The `## GraphQL Contract Delta` in `../spec.md` is frozen as of `status: Approved`. Three things an
implementer will be tempted to change and must not:

- **`indexerStatus` resolves instead of throwing when Prowlarr is down.** From inside `api` this
  reads wrong — every other Prowlarr-touching path throws `error.indexer.unavailable`, and a
  resolver that catches its own dependency's failure looks like swallowed error handling. It is
  right for this feature: the page whose entire job is explaining how to fix a broken indexer must
  render when the indexer is broken (NFR-2, AC-2). Do not "restore consistency" by rethrowing.
- **`configuredIndexers` is `Int!`, not nullable, and is `0` when `reachable` is false.** A
  nullable count would let `web` write `count ?? 0` and land straight in the conflation Risk 2
  describes. The two fields are read together or not at all.
- **No indexer URL is added to `indexerStatus`.** It is tempting — the page shows a count and a URL
  side by side, and one query would be one round trip. `environmentInfo` already owns that field,
  with the null semantics `055` specified and tested. A second source for the same host is how the
  two drift.

If the contract turns out wrong: stop, amend `../spec.md`, re-approve, re-brief both services.
Never patch it from inside one slice (Article VIII).

## Migrations

**None.** No Prisma model, column or enum changes (NFR-4). Everything `indexerStatus` reads is
already in the `Setting` table (`tracker_host`, `tracker_port`, `tracker_api_key`), seeded since
`014-dev-stack-flaresolverr`. `git status --short services/api/prisma` must be empty when this
feature closes (AC-11).

Reversibility: reverting the feature removes a query and a page. Nothing persists, nothing to undo.

## Risks

| Risk | How it fails | Mitigation |
| :-- | :-- | :-- |
| **The catch in `IndexerService.status()` is too wide** | A genuine defect — a typo in the URL, a parsing bug, a `TypeError` — is absorbed into `reachable: false`. The page then tells an admin their indexer is unreachable when it is answering fine, forever, with nothing in any log. The admin goes looking at Docker. | The catch wraps only the client call; the client itself validates and throws a *named* failure. `IndexerService.status()` logs the caught error before mapping it. `indexer.service.spec.ts` asserts each of the three outcomes separately. |
| **`web` conflates zero with unreachable** | `configuredIndexers === 0 ? zeroNotice : ok` renders "no indexer is configured" for a Prowlarr that is down — wrong diagnosis, confident tone, no error anywhere, and the admin adds indexers to a container that is not running. | REQ-7/REQ-8 are two branches, `reachable` tested **first**; AC-2 is the live check with `docker compose stop indexer`. |
| **The admin check is raced with the admin queries** | `Promise.all([getCurrentUser(), getIndexerStatus()])` turns `AdminGuard`'s refusal into an uncaught 500 for a non-admin instead of the 404 REQ-1 asks for — and a 500 on a page that exists is indistinguishable from the page being broken. | `getCurrentUser()` → `notFound()` → *then* the fetches, exactly as `users/page.tsx` and `settings/page.tsx` already do. AC-3 checks the api log shows no call at all. |
| **A message key is dropped in the namespace move** | `next-intl` renders the missing key's path as literal text (`onboarding.tmdb.why`) rather than throwing. `/` would show it too, since it renders the same component — a regression in a shipped feature, introduced by a page nobody was looking at. | The move is a whole-subtree rename in both catalogs, verified by `bin/cli web node scripts/check-messages.mjs` (AC-10) **and** by loading `/` with no TMDB key, not only `/first-step` (AC-6). |
| **A screenshot is committed at a resolution where Prowlarr's field labels are unreadable** | Nothing fails. The page renders, the image loads, and the step it is supposed to explain is unusable — which is the entire value of the block. | REQ-12 and AC-7 make legibility at the *rendered* size the criterion, not file size. Each image is also linked to its full-size original. |
| **The screenshots rot** | Prowlarr redesigns; the guide confidently shows a UI that no longer exists. | NFR-6: the prose steps name the buttons and stand on their own; replacing an image is a single-file change with no code to touch. |

## Verification

```bash
bin/cli api npx --no tsc --noEmit
bin/npm api test
bin/cli web npx --no tsc --noEmit
bin/cli web node scripts/check-messages.mjs
git status --short services/api/prisma        # must be empty (AC-11)
git diff --stat services/worker               # must be empty (AC-11)
```

`bin/npm web run build` is **not** in this list while a dev stack is running — it overwrites
`.next` and un-hydrates every page. Run it only against a stopped stack, or leave it to the release
image build.

The generated `services/api/src/schema.gql` diff must be exactly `IndexerStatus` and
`Query.indexerStatus` (Article VIII check). Anything else in that diff is an unreported contract
change.

Manual pass, in this order:

1. As an admin on a stack with no indexers, open `/first-step` — TMDB block with the five steps and
   step 5 linking to `/settings`, then the indexer block opening with the zero notice (AC-1).
2. `docker compose stop indexer`, reload — page still renders whole, indexer block says
   unreachable, **not** zero (AC-2). `docker compose start indexer` after.
3. Sign in as a non-admin, open `/first-step` — 404; `bin/cli api …` logs show no `indexerStatus`
   and no `environmentInfo` for that request (AC-3).
4. Add one indexer in Prowlarr, reload — confirmation naming `1`, steps still visible (AC-4).
5. Check step 1's URL in both routing modes (AC-5): with `USE_TRAEFIK=true` it links
   `http(s)://indexer.<domain>` and that link opens Prowlarr; with `USE_TRAEFIK=false` it prints
   `INDEXER_PORT` and invents no hostname.
6. With a TMDB key configured, confirm `/first-step` still shows the whole TMDB block marked as
   configured **and** `/` still shows the billboard (AC-6).
7. Click each of the three screenshots — opens full size; read the field labels at the rendered
   size (AC-7).
8. Confirm the sidebar entry appears for the admin and not for the non-admin (AC-8).
9. Tag a Cloudflare-fronted indexer `flaresolverr` per step 4, then search a title that tracker
   carries from its detail page — rows come back (AC-9). This is the one criterion that proves the
   third screenshot documents a step that works, and it needs a real tracker.
