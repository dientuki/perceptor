---
title: First-step page — TMDB key plus indexer setup — Tasks
last_updated: 2026-09-28
status: Draft
---

# TASKS: First-step page — TMDB key plus indexer setup (`tasks.md`)

## Legend

| Marker | Meaning |
| :-- | :-- |
| `[api]` `[web]` | Which subagent owns the task. Exactly one per task. |
| `[docs]` | Documentation only. Owned by the orchestrator, not a service agent. |
| `[P]` | May run in parallel with the other `[P]` tasks in the same group. |
| `→ Tnnn` | Blocked by that task. |

No `[worker]` task: NFR-5 makes an untouched `services/worker` part of the contract, and
`git diff --stat services/worker` being empty is an acceptance criterion (AC-11). No `[infra]` task:
the three screenshots are repository assets served by `web`'s existing `public/`, not a compose,
volume or `bin/` change.

## Tasks

### Group 1 — contract and schema (`api`)

Serial. Each step is verifiable on its own, and T003 is what regenerates `schema.gql`.

- [ ] **T001** `[api]` In `src/clients/indexer/client.ts`, extract the Prowlarr base-URL and
      `X-Api-Key` construction out of the private `getData(query)` into one private request helper
      used by both methods, keeping the existing fetch-rejection and `!res.ok` →
      `INDEXER_UNAVAILABLE` branches untouched. Add `ProwlarrClient.countIndexers()` against
      `GET /api/v1/indexer`, validating the body with `Array.isArray` and throwing
      `INDEXER_UNAVAILABLE` when it is not an array. Add `countIndexers` to the `IndexerClient` type
      in `types.ts`. Extend `client.spec.ts` with the four `countIndexers` cases (non-2xx throws,
      fetch rejection throws, non-array 200 throws, JSON array returns its length).
      *Done when:* `bin/npm api test -- clients/indexer` passes with the existing `getData` cases
      unchanged — they are the proof the extraction was behaviour-neutral — plus the four new ones,
      and `bin/cli api npx --no tsc --noEmit` reports 0 errors.

- [ ] **T002** `[api]` Create `src/indexer/entities/indexer-status.entity.ts`
      (`configuredIndexers: Int!`, `reachable: Boolean!`, both non-null, each with the contract's
      wording as its `description`) and add `IndexerService.status()`: `countIndexers()` in a `try`
      returning `{ count, reachable: true }`; on `catch`, **log the caught error** and return
      `{ configuredIndexers: 0, reachable: false }`. No caching, no Redis. Extend
      `indexer.service.spec.ts` with the three outcomes asserted separately, and an Article IX header
      paragraph naming the failure: too wide a catch reports a healthy indexer as unreachable, too
      narrow a catch makes the page that explains a broken indexer unopenable, and neither surfaces
      an error anyone would connect to the cause. → T001
      *Done when:* `bin/npm api test -- indexer.service` passes all three cases, and a thrown
      `INDEXER_UNAVAILABLE` is observably logged rather than silently absorbed.

- [ ] **T003** `[api]` Add the `indexerStatus` query to `src/indexer/indexer.resolver.ts` with
      `@UseGuards(AdminGuard)` **on the method**, no arguments, delegating to `IndexerService.status()`.
      Verify `AdminGuard`'s `PrismaService` resolves inside `IndexerModule`; if not, import the
      providing module rather than re-providing it locally. → T002
      *Done when:* the container boots and `git diff services/api/src/schema.gql` shows exactly
      `type IndexerStatus` and `indexerStatus: IndexerStatus!` on `Query` and nothing else
      (Article VIII check); a raw `indexerStatus` call as an admin returns the two fields, and as a
      non-admin returns `error.auth.admin_required`.

### Group 2 — consumer (`web`)

T004 and T005 may start as soon as Group 1 is dispatched — neither reads anything `api` produces, and
the contract is frozen. **They are not `[P]` with each other**: both edit `messages/en.json` and
`messages/es.json`, so two agents running at once would collide in the same two files.

- [ ] **T004** `[web] [P]` Move `src/components/billboard/TmdbKeyOnboarding.tsx` to
      `src/components/onboarding/`, rename the catalog subtree `billboard.tmdbOnboarding` →
      `onboarding.tmdb` in both message files, update the `getTranslations` namespace and the import
      in `src/app/(dashboard)/page.tsx`. Add the REQ-5 prop (e.g. `alreadyConfigured`), defaulted so
      `/`'s existing call sites need no new argument; when true it renders a short marker near the
      title while the reason, the five steps and the links stay visible.
      *Done when:* `bin/cli web node scripts/check-messages.mjs` reports no drift, typecheck is 0
      errors, and `/` with `movie_db_api_key` empty still renders the full panel — no literal key
      path such as `onboarding.tmdb.why` anywhere on the page (`../plan.md` Risk 4).

- [ ] **T005** `[web]` Commit the three screenshots under `public/images/first-step/`
      (`indexer-login.png`, `indexer-add.png`, `indexer-flaresolverr.png`), cropped to the relevant
      dialog and sized so Prowlarr's field labels are readable at the width the page renders them.
      Add the `onboarding.indexer` keys, `nav.firstStep` and `pages.firstStep` (metadata title and
      description) to both catalogs, `es` in the existing Rioplatense register. Do not translate the
      URLs, the literal tag name `flaresolverr`, or Prowlarr's own button labels (`Add Indexer`,
      `Test`, `Save`, `Tags`). → T004
      *Done when:* the three files exist and open at full size from a browser, and
      `bin/cli web node scripts/check-messages.mjs` reports no drift at a key count that grew by
      exactly the keys added.

- [ ] **T006** `[web] [P]` Add the `IndexerStatus` type to `src/types/indexer.ts` and
      `getIndexerStatus()` to `src/actions/indexer.ts`, following `src/actions/media-server.ts`'s
      shape with `redirectToClearSession(errors)` before any throw — it is awaited during a render
      pass. → T003
      *Done when:* typecheck is 0 errors and the action returns
      `{ configuredIndexers, reachable }` against the running api for an admin session.

- [ ] **T007** `[web]` Build `src/components/onboarding/IndexerSetupGuide.tsx` — one renderable
      component in the file. It takes the `IndexerStatus` and the resolved indexer endpoint as props
      and fetches nothing. Derive the notice in three explicit branches testing `reachable` **first**:
      unreachable (REQ-8), reachable with `0` (REQ-7), reachable with `≥1` naming the count (REQ-9).
      Then REQ-10's five steps, with REQ-11's "the API key needs no copying" stated where an admin
      would otherwise go looking for it, and screenshots 1–3 attached to steps 2, 3 and 4 — house
      `next/image` pattern (string `src`, explicit `width`/`height`), alt text from the catalog, each
      wrapped in an `<a target="_blank" rel="noopener noreferrer">`. No lightbox or image-viewer
      dependency. → T005
      *Done when:* typecheck is 0 errors and all three branches render correctly when the component
      is fed each of the three `(reachable, configuredIndexers)` combinations.

- [ ] **T008** `[web]` Build `src/app/(dashboard)/first-step/page.tsx`: `generateMetadata` from
      `pages.firstStep`; `await getCurrentUser()`; `notFound()` when not admin; **then**
      `Promise.all([getIndexerStatus(), getEnvironmentInfo(), getMediaCapabilities()])`; then
      `PageBreadcrumb` plus the two blocks, TMDB first. Read the `endpoints` entry whose
      `id === "indexer"` — link `url` when non-null, otherwise print `port` with no link and no
      constructed hostname. Nothing polls or revalidates. Add the sidebar entry inside the existing
      `isAdmin` branch of `AppSidebar.tsx`'s `navItems`, with a `lucide-react` icon and no badge. Do
      not touch `proxy.ts`. → T004, T006, T007
      *Done when:* `/first-step` renders both blocks for an admin, returns 404 for a non-admin, the
      sidebar entry appears only for the admin, and typecheck plus `bin/npm web run lint` are clean
      on the touched files.

### Group 3 — verification and docs

- [ ] **T009** `[docs]` Update the affected `CLAUDE.md` files: the root pipeline table's **Find
      release** row (a read-only `indexerStatus` query and the `/first-step` guide, spec ref `078`);
      `services/api/CLAUDE.md`'s `indexer/` module-map entry (the new query and why it resolves
      instead of throwing when Prowlarr is down); `services/web/CLAUDE.md` (a section for
      `/first-step`, the `components/onboarding/` home of the moved `TmdbKeyOnboarding`, and the
      `billboard.tmdbOnboarding` → `onboarding.tmdb` namespace rename so the next reader does not
      grep for the old one). → T008
      *Done when:* each of the three files names `078`, and no sentence in them still places
      `TmdbKeyOnboarding` under `components/billboard/`.

- [ ] **T010** `[docs]` Walk the acceptance criteria in `spec.md` against a running stack, in
      `../plan.md` § Verification's order: AC-1 (fresh install, both blocks), **AC-2**
      (`docker compose stop indexer` → page renders whole, says unreachable, not zero — then
      `docker compose start indexer`), **AC-3** (non-admin → 404 and no `indexerStatus`/
      `environmentInfo` in the api log), AC-4 (one indexer → confirmation naming `1`), AC-5 (step 1's
      URL in both routing modes), AC-6 (key configured → marker on `/first-step`, billboard on `/`),
      AC-7 (screenshots legible and full-size-linked), AC-8 (sidebar), AC-9 (a `flaresolverr`-tagged
      Cloudflare-fronted indexer returns rows), AC-10 (`check-messages`), AC-11
      (`git status --short services/api/prisma` and `git diff --stat services/worker` both empty).
      Tick only what was actually observed and record the rest as unrun with the reason — AC-9 needs a
      real Cloudflare-fronted tracker and may not be reachable on a dev stack. Then set
      `status: Implemented` on `spec.md`, `plan.md`, `api/plan.md` and `web/plan.md`. → T009
      *Done when:* every AC box is either ticked against an observed result or explicitly listed as
      unrun with its reason, and the four files read `status: Implemented`.

## Blocked

| Task | Service | What blocked it | Needs |
| :-- | :-- | :-- | :-- |

Empty is the normal state. A contract problem always lands here (Article VIII): an agent that finds
the GraphQL delta wrong stops and reports, it never amends the delta from inside its slice.
