---
title: First-step page — TMDB key plus indexer setup — web slice
service: web
last_updated: 2026-09-28
status: Approved
---

# PLAN: First-step page — TMDB key plus indexer setup — `web` (`web/plan.md`)

# Scope

Build one admin-only page, `/first-step`, carrying two blocks: the existing TMDB onboarding block,
reused rather than copied, and a new indexer setup block with three screenshots. Add the sidebar
entry, one server action for the new query, and every string in both catalogs.

This service owns **all** user-facing copy in this feature — `api` returns a number and a boolean and
no message at all. It does not change `/` in any way beyond the one-line import path of the component
that moved (REQ-4), and it does not add a route handler, a client-side fetch or a polling loop.

Writes are confined to `services/web/` and this directory. Anything else is a stop-and-report.

## Files

| File | New / Modified | What changes |
| :-- | :-- | :-- |
| `src/app/(dashboard)/first-step/page.tsx` | New | Admin-only Server Component: `generateMetadata`, admin check, the two blocks. |
| `src/components/onboarding/TmdbKeyOnboarding.tsx` | Moved | From `src/components/billboard/`. Gains one prop for REQ-5's marker. Content otherwise untouched. |
| `src/components/onboarding/IndexerSetupGuide.tsx` | New | The indexer block: the three-branch notice, the five steps, the three screenshots. |
| `src/app/(dashboard)/page.tsx` | Modified | Import path only — both existing call sites keep their current props. |
| `src/actions/indexer.ts` | Modified | Add `getIndexerStatus()` beside the existing search actions. |
| `src/types/indexer.ts` | Modified | Add the `IndexerStatus` type, hand-mirrored. |
| `src/layout/AppSidebar.tsx` | Modified | One entry in the `isAdmin` branch of `navItems`. |
| `messages/en.json`, `messages/es.json` | Modified | `onboarding.*` (the moved `billboard.tmdbOnboarding` subtree plus the new indexer keys), `nav.firstStep`, `pages.firstStep`. |
| `public/images/first-step/indexer-login.png` | New | Screenshot 1: Prowlarr's sign-in screen. |
| `public/images/first-step/indexer-add.png` | New | Screenshot 2: Add Indexer for a plain public indexer. |
| `public/images/first-step/indexer-flaresolverr.png` | New | Screenshot 3: the same dialog with `flaresolverr` in the Tags field. |

`IndexerSetupGuide.tsx` is one renderable component in one file — its notice, its step list and its
screenshot element are markup inside it, not sibling exports (`web/CLAUDE.md` § One renderable
component per file). If it grows a genuinely reusable piece, that piece gets its own file under
`src/components/onboarding/`, not a second export here.

## Existing code to reuse

- `src/components/billboard/TmdbKeyOnboarding.tsx` — **move it, do not copy it.** REQ-3 is that the
  copy and the links exist once. It is already an `async` Server Component reading
  `getTranslations`, already takes `isAdmin`/`keyRejected`, and already branches step 5 between an
  admin link to `/settings` and the ask-an-administrator wording. `/first-step` renders it with
  `keyRejected={false}` and the new marker prop.
- `src/app/(dashboard)/users/page.tsx` and `settings/page.tsx` — the admin-page shape, and the
  comment in both explaining it: `await getCurrentUser()`, `notFound()` on `!isAdmin`, and **only
  then** the admin-only fetches. `Promise.all` is fine *among* those fetches; racing them with the
  admin check turns `AdminGuard`'s refusal into a 500 instead of a 404 (`../plan.md` Risk 3).
- `src/actions/environment.ts`'s `getEnvironmentInfo()` — reuse as-is for REQ-10 step 1. Take the
  `endpoints` entry whose `id === "indexer"`: `url` when non-null (link it), otherwise print `port`
  with no link and no constructed hostname. `null` there is `055-environment-panel`'s specified
  answer, not a missing value to paper over. Do not add a second action.
- `src/actions/media.ts`'s `getMediaCapabilities()` — `cache()`-wrapped, already returns
  `catalogKeyConfigured`. REQ-5's marker reads it; no new query.
- `src/actions/media-server.ts` — the canonical server-action shape `web/CLAUDE.md` tells you to copy
  for `getIndexerStatus()`. Since this is awaited during a Server Component's render pass, its error
  path uses `redirectToClearSession(errors)` before throwing, like `getEnvironmentInfo()` — **not**
  `redirectIfUnauthenticated`, which mutates cookies and throws during render.
- `src/app/(auth)/login/page.tsx` — the house `next/image` pattern: string `src` under `/images/…`,
  explicit `width`/`height` measured off the committed file, `className="h-auto w-full"`. Follow it.
  **No lightbox or image-viewer dependency** — REQ-12's "full size" is an `<a href target="_blank"
  rel="noopener noreferrer">` around the image, the same link shape `TmdbKeyOnboarding` already uses.
- `src/layout/AppSidebar.tsx` — the `isAdmin ? [...baseNavItems, …] : baseNavItems` branch, with its
  existing comment recording that the entry is cosmetic and `api`'s guard is the real control. Add
  one `lucide-react` icon import; `Rocket` or `BookOpen` fit the existing set. No `badge` on this
  entry (`../spec.md` § Out of Scope forbids announcing the state outside the page).

## Steps

1. Move `TmdbKeyOnboarding.tsx` to `src/components/onboarding/`, update the import in
   `(dashboard)/page.tsx`, and rename the catalog subtree `billboard.tmdbOnboarding` →
   `onboarding.tmdb` in **both** message files, updating the `getTranslations` namespace. Nothing
   else about `/` changes. Verify `/` still renders the panel with no TMDB key before moving on —
   a dropped key renders as its own literal path, with no error (`../plan.md` Risk 4).
2. Add the REQ-5 prop (e.g. `alreadyConfigured`) to `TmdbKeyOnboarding`, defaulting so that `/`'s two
   existing call sites need no new argument. When true it renders a short marker near the title;
   the reason, the five steps and the links stay visible regardless.
3. Add `IndexerStatus` to `src/types/indexer.ts` and `getIndexerStatus()` to
   `src/actions/indexer.ts`.
4. Add the `onboarding.indexer` keys, `nav.firstStep` and `pages.firstStep` (metadata title and
   description) to both catalogs. `es` in the existing Rioplatense register. Not translated: every
   URL, the literal tag name `flaresolverr`, and Prowlarr's own button labels quoted inside the
   steps (`Add Indexer`, `Test`, `Save`, `Tags`) — an admin is reading those labels off an English
   Prowlarr UI, so translating them makes the instruction unfollowable.
5. Commit the three screenshots under `public/images/first-step/`, cropped to the relevant dialog and
   sized so Prowlarr's field labels are readable at the width the page renders them (AC-7). Commit
   them in this task, not later: the page references them by path, and a missing file renders as a
   broken image with nothing failing anywhere.
6. Build `IndexerSetupGuide.tsx`. It takes the `IndexerStatus` and the resolved indexer endpoint as
   props — it fetches nothing itself. Derive the notice in three explicit branches, **testing
   `reachable` first**: unreachable (REQ-8), reachable with `0` (REQ-7), reachable with `≥1` (REQ-9,
   naming the count). Then the five steps of REQ-10, with REQ-11's "the API key needs no copying"
   stated where an admin would otherwise go looking for it, and screenshots 1, 2 and 3 attached to
   steps 2, 3 and 4. Each image has alt text from the catalog and is wrapped in the full-size link.
7. Build `first-step/page.tsx`: `generateMetadata` from `pages.firstStep`; `await getCurrentUser()`;
   `notFound()` when not admin; then `Promise.all([getIndexerStatus(), getEnvironmentInfo(),
   getMediaCapabilities()])`; then `PageBreadcrumb` plus the two blocks, TMDB first. Nothing on this
   page polls, refreshes or revalidates — one load, one set of reads (NFR-3).
8. Add the sidebar entry inside the existing `isAdmin` branch.
9. `/first-step` needs no `proxy.ts` change: anything not in `AUTH_ROUTES`/`PUBLIC_ROUTES` is already
   treated as protected. Do not add it to either list.

## Contract obligations

Consumed from `../spec.md` § GraphQL Contract Delta — read-only. There is no codegen; this type is a
hand copy and nothing checks it:

```graphql
indexerStatus: IndexerStatus!   # { configuredIndexers: Int!, reachable: Boolean! }
```

Every condition this consumer must handle:

- **`reachable: false`, `configuredIndexers: 0`** — Prowlarr did not answer. Render REQ-8's wording.
  This arrives as a **successful** response, not an error: there is no `error.indexer.unavailable` to
  catch here, and a `try`/`catch` around `getIndexerStatus()` will never see this case.
- **`reachable: true`, `configuredIndexers: 0`** — REQ-7's notice.
- **`reachable: true`, `configuredIndexers ≥ 1`** — REQ-9's confirmation, naming the count.
- **`error.auth.admin_required`** — reachable only if the admin check is skipped or raced. The page
  must never issue the call for a non-admin (AC-3); if it somehow arrives, it surfaces through
  `translateGraphQLError` like any other, but the correct fix is the ordering in step 7, not a
  catch.
- **A session error** — handled by `redirectToClearSession(errors)` inside the action, before any
  throw, because this is awaited during a render pass.
- **`environmentInfo`'s `indexer` endpoint with `url: null`** — print `port`, no link, no invented
  host (REQ-10, AC-5). An `endpoints` array that does not contain an `indexer` entry at all is not a
  contract state `api` produces (it always returns four, in order), but reading it defensively costs
  one `?.` and avoids a crash on a version mismatch.

Never branch on a translated message substring; never invent an `error.*` key (`api` and `worker`
own the vocabulary).

## Tests

**None — this service has no test file, no runner and no `test` script** (`web/CLAUDE.md` § Tests:
there are none). Do not add Vitest or Playwright as a side effect of this feature; that is its own
decision and its own spec.

The quality gate here is the typecheck, `scripts/check-messages.mjs` for catalog parity, Biome on the
files touched, and actually opening the page — including `/` with no TMDB key, which step 1 can break
without any error appearing.

## Done when

```bash
bin/cli web npx --no tsc --noEmit
bin/cli web node scripts/check-messages.mjs
bin/npm web run lint
```

Typecheck 0 errors; `check-messages` reports no `en`/`es` drift and a key count that grew by exactly
the keys this slice added; Biome clean on the touched files (a pre-existing formatting failure
elsewhere in this service is not this slice's to fix).

Do **not** run `bin/npm web run build` while a dev stack is up — it overwrites `.next` and
un-hydrates every page. If a production build is needed, stop the stack first.

Report: the typecheck result, the key count before and after, and which of AC-1 through AC-9 were
actually confirmed in a browser versus left unrun.
