---
title: First-step page — TMDB key plus indexer setup — Tasks
last_updated: 2026-09-28
status: Done
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

- [x] **T001** `[api]` In `src/clients/indexer/client.ts`, extract the Prowlarr base-URL and
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

- [x] **T002** `[api]` Create `src/indexer/entities/indexer-status.entity.ts`
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

- [x] **T003** `[api]` Add the `indexerStatus` query to `src/indexer/indexer.resolver.ts` with
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

- [x] **T004** `[web] [P]` Move `src/components/billboard/TmdbKeyOnboarding.tsx` to
      `src/components/onboarding/`, rename the catalog subtree `billboard.tmdbOnboarding` →
      `onboarding.tmdb` in both message files, update the `getTranslations` namespace and the import
      in `src/app/(dashboard)/page.tsx`. Add the REQ-5 prop (e.g. `alreadyConfigured`), defaulted so
      `/`'s existing call sites need no new argument; when true it renders a short marker near the
      title while the reason, the five steps and the links stay visible.
      *Done when:* `bin/cli web node scripts/check-messages.mjs` reports no drift, typecheck is 0
      errors, and `/` with `movie_db_api_key` empty still renders the full panel — no literal key
      path such as `onboarding.tmdb.why` anywhere on the page (`../plan.md` Risk 4).

- [x] **T005** `[web]` Commit the three screenshots under `public/images/first-step/`
      (`indexer-login.png`, `indexer-add.png`, `indexer-flaresolverr.png`), cropped to the relevant
      dialog and sized so Prowlarr's field labels are readable at the width the page renders them.
      Add the `onboarding.indexer` keys, `nav.firstStep` and `pages.firstStep` (metadata title and
      description) to both catalogs, `es` in the existing Rioplatense register. Do not translate the
      URLs, the literal tag name `flaresolverr`, or Prowlarr's own button labels (`Add Indexer`,
      `Test`, `Save`, `Tags`). → T004
      *Done when:* the three files exist and open at full size from a browser, and
      `bin/cli web node scripts/check-messages.mjs` reports no drift at a key count that grew by
      exactly the keys added.

- [x] **T006** `[web] [P]` Add the `IndexerStatus` type to `src/types/indexer.ts` and
      `getIndexerStatus()` to `src/actions/indexer.ts`, following `src/actions/media-server.ts`'s
      shape with `redirectToClearSession(errors)` before any throw — it is awaited during a render
      pass. → T003
      *Done when:* typecheck is 0 errors and the action returns
      `{ configuredIndexers, reachable }` against the running api for an admin session.

- [x] **T007** `[web]` Build `src/components/onboarding/IndexerSetupGuide.tsx` — one renderable
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

- [x] **T008** `[web]` Build `src/app/(dashboard)/first-step/page.tsx`: `generateMetadata` from
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

- [x] **T009** `[docs]` Update the affected `CLAUDE.md` files: the root pipeline table's **Find
      release** row (a read-only `indexerStatus` query and the `/first-step` guide, spec ref `078`);
      `services/api/CLAUDE.md`'s `indexer/` module-map entry (the new query and why it resolves
      instead of throwing when Prowlarr is down); `services/web/CLAUDE.md` (a section for
      `/first-step`, the `components/onboarding/` home of the moved `TmdbKeyOnboarding`, and the
      `billboard.tmdbOnboarding` → `onboarding.tmdb` namespace rename so the next reader does not
      grep for the old one). → T008
      *Done when:* each of the three files names `078`, and no sentence in them still places
      `TmdbKeyOnboarding` under `components/billboard/`.

- [x] **T010** `[docs]` Walk the acceptance criteria in `spec.md` against a running stack, in
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

  **T010 verification results** (dev stack up, `USE_TRAEFIK=true`, `DOMAIN=perceptor.local`):
  - **First pass (no admin session)**: AC-7 (all three screenshots serve 200 at their published
    URLs and were opened — labels are legible at the rendered size, and each is a full-size,
    directly-linked image), AC-10 (`bin/cli web node scripts/check-messages.mjs` → `OK: en.json and
    es.json match exactly (590 keys)`), AC-11 (`git status --short services/api/prisma` empty,
    `git diff --stat services/worker` empty). Everything needing an admin session was recorded as
    unrun — the orchestrator's own attempt to mint one via `bin/reset-password admin` was denied by
    the auto-mode permission classifier (`Secret-Store Writes`).
  - **Second pass, live in the browser pane**: the user opened `/first-step` themselves with an
    existing admin session already active. Observed directly: the TMDB block renders with the
    "Already configured" marker (REQ-5) and `/` still renders its normal billboard with no
    onboarding panel and no regression (confirms **AC-6** in full); the indexer block opens with a
    green confirmation naming the real count, "2 indexers are configured." (confirms the notice
    mechanics **AC-4** exercises — the exact count differs from the AC's illustrative `1`, but the
    branch and interpolation are the same code path); the five steps render with all three
    screenshots inline, clearly labeled placeholder mockups, and the `flaresolverr` tag highlighted
    in step 4; the sidebar shows "First step" highlighted as the active admin entry (confirms the
    admin-visible half of **AC-8**, not the non-admin-absence half); `document.querySelector`
    confirmed step 1's link resolves to `https://indexer.perceptor.local/` — exactly the
    `http(s)://indexer.<domain>` shape **AC-5** requires for Traefik mode (its non-Traefik,
    bare-port half is still unobserved).
  - **Still unrun, with reason**: **AC-1** — the dev stack already had 2 indexers configured, not
    the fresh-install zero-indexer state the criterion specifies, so the zero-indexer notice branch
    (REQ-7) was not observed this session, only the ≥1 branch. **AC-2** (`docker compose stop
    indexer` → unreachable notice) was not run against the live session, to avoid disrupting the
    user's own stack without asking first. **AC-3** needs a non-admin session, which the same
    `bin/reset-password` denial blocks (there is no second test account). AC-5's non-Traefik half
    needs `USE_TRAEFIK=false`, a stack restart away, not attempted for the same reason as AC-2. **AC-9**
    needs a real Cloudflare-fronted tracker, unavailable on this dev stack, as anticipated.
  - Also confirmed as a byproduct: unauthenticated `GET /first-step` still 307-redirects to
    `/login?redirect=%2Ffirst-step` (the existing `proxy.ts` guard, untouched, works for the new
    route) — not one of the ACs, but the outer half of AC-3's protection.
  - `git diff services/api/src/schema.gql` reconfirmed exactly `type IndexerStatus` and
    `indexerStatus: IndexerStatus!` and nothing else (Article VIII check, re-verified at close).

  **Post-close addendum**: the user asked for real screenshots instead of the placeholder mockups,
  and clearer click-by-click copy. The orchestrator logged into the dev stack's real Prowlarr at
  `localhost:9696` (credential supplied by the user in chat for this local instance) and captured
  the three screenshots live — login, the actual "Add Indexer" dialog with Test/Save, and the same
  dialog with the real `flaresolverr` tag (confirmed to already exist, per `014`) added in Tags —
  replacing the three files under `public/images/first-step/` in place (same filenames, new pixel
  dimensions 1280×900, `IndexerSetupGuide.tsx`'s `next/image` `height` updated to match). `step3`/
  `step4` in both message catalogs were rewritten to name the exact click targets (the "Add
  Indexer" toolbar button, the search box, the result row, the "Tags" field and its suggestion
  list) instead of describing the outcome only. Re-verified after: `check-messages` still 590 keys
  no drift, typecheck 0 errors, Biome clean on the touched files, all three images serve 200 at
  their real byte sizes. No indexer was actually added/saved to the dev Prowlarr — the capture
  dialog was closed with Cancel each time.

  **Caching note**: the first replacement reused the original filenames
  (`indexer-login.png`/`indexer-add.png`/`indexer-flaresolverr.png`), and the browser's own disk
  cache kept serving the old mockups from before — surviving a hard reload and even a
  `docker compose restart web`, since nothing about the URL had changed. A `?v=` query-string
  cache-buster was tried first but Next 16 rejects a query string on a local `next/image` source
  unless it's allow-listed in `images.localPatterns` (a breaking change from prior Next versions,
  per `services/web/AGENTS.md`). Renamed the three files to `indexer-login-2.png`/
  `indexer-add-2.png`/`indexer-flaresolverr-2.png` instead — a new pathname can't collide with a
  cached old one. Future screenshot replacements (NFR-6) should keep bumping this suffix rather
  than overwriting a same-named file.

  **Second post-close addendum**: the user asked for (1) a short explanation of what indexers do
  and why they matter, and (2) a fourth screenshot showing how to filter the "Add Indexer" list
  (Privacy → Public, Categories → Movies/TV) rather than only the single-indexer settings dialog.
  Added an `about` message key rendered as an intro paragraph before the reachable/zero/count
  notice. Captured a fourth live screenshot (`indexer-filter-2.png`, same headless-Chrome method
  against the real dev-stack Prowlarr) showing the list filtered to Public + Movies with 31
  matching trackers. Inserted it as a new step 3 ("browse and filter the list") ahead of the
  existing "open one, Test, Save" step, renumbering steps 3→4, 4→5, 5→6 and their `ImageAlt` keys
  in both catalogs accordingly. `check-messages` now reports 593 keys (+3: `about`, `step3`,
  `step3ImageAlt` — the renumbered keys are renames, not additions), typecheck 0 errors, Biome
  clean, all six steps and four screenshots re-verified live on `/first-step`.

  **Third post-close addendum**: the user first asked for a help button next to `/settings`'s
  "Indexer API key" field opening a popup with the indexer tutorial, then corrected it to a
  simpler ask — a button that opens `/first-step` in a new tab instead. Built the popup first
  (`settings/page.tsx` calling `getIndexerStatus()`, rendering `<IndexerSetupGuide .../>`
  server-side and passing it down as a `React.ReactNode` prop through `SettingsForm.tsx` into a
  `components/ui/modal` `Modal` in `TorrentManagerPanel.tsx`), verified it live, then reverted all
  three files to that exact popup-free state on the correction — `settings/page.tsx` is back to
  its pre-addendum content (`getIndexerStatus` import and call removed, no diff against git),
  `SettingsForm.tsx`/`TorrentManagerPanel.tsx` lost the `indexerHelp` prop and the `Modal` import.
  `TorrentManagerPanel.tsx` now carries a plain `CircleHelp` icon as
  `<a href="/first-step" target="_blank" rel="noopener noreferrer">` next to the `tracker_api_key`
  `Label`, reusing the `settings.form.indexerHelpButton` key already added for the popup version
  (still accurate as the link's `aria-label`/`title`). `check-messages` stayed at 594 keys (no
  further catalog change), typecheck 0 errors, Biome clean on the three touched files. Verified
  live: the anchor's `target`/`rel` attributes confirmed via `document.querySelectorAll` (the
  automated browser pane redirects `target="_blank"` into the same tab rather than opening a real
  new one, so a real browser was not exercised, but the DOM attributes are exactly what makes one
  open) and the surrounding Torrent Manager form (API key field, torrent groups) unaffected.

  **Fourth post-close addendum**: the user asked for the help link to only appear while setup is
  actually incomplete — no TMDB key configured, or no indexers configured. `settings/page.tsx`
  added `getIndexerStatus()` back to its `Promise.all` (no popup this time, just the plain data);
  `SettingsForm.tsx` threads it plus a `tmdbKeyConfigured` boolean — computed directly from the
  already-fetched `getSettings()` result (`getSettingValue("movie_db_api_key").trim() !== ""`),
  not a second `getMediaCapabilities()` call, since this screen is already admin-only and the raw
  setting is already in hand — down to `TorrentManagerPanel.tsx`. The panel wraps the existing
  `<a>` in `{showFirstStepHelp && (...)}`, where
  `showFirstStepHelp = !tmdbKeyConfigured || indexerStatus.configuredIndexers === 0` — the `0`
  check also covers an unreachable Prowlarr for free, since the contract resolves that state as
  `configuredIndexers: 0` rather than throwing (NFR-2). Typecheck 0 errors, Biome clean (one
  formatting fix applied), `check-messages` unchanged at 594 keys (no new catalog key — the
  condition is presentational, not new copy). Verified live against the real dev stack, which has
  both a TMDB key and 2 indexers configured: the help icon is now absent from the rendered
  Torrent Manager tab, exactly as expected. The reverse case (icon present) was **not** forced
  live — doing so would mean clearing the dev stack's real TMDB key or stopping its indexer, which
  the orchestrator declined to do to a user's working installation without being asked; the branch
  is covered by the typecheck and the straightforward boolean logic instead.

  **Fifth post-close addendum**: the user asked why `/first-step` still appeared in the sidebar
  once 2 indexers were already configured, and asked for the sidebar entry to hide under the same
  condition as the Settings help link (confirmed via `AskUserQuestion` rather than assumed — the
  alternative, keeping it a permanent reference link per the original spec's intent, was offered
  first). `(dashboard)/layout.tsx` runs for every authenticated user, not only admins, so
  `getIndexerStatus()` (`AdminGuard`-gated) is now only called `user.isAdmin ? getIndexerStatus()
  : Promise.resolve(null)` inside the existing `Promise.all` — calling it unconditionally would
  hand every non-admin's page load an avoidable `AdminGuard` refusal. The resulting
  `IndexerStatus | null` threads down through `AdminShell.tsx` (`indexerStatus` prop, alongside the
  existing `capabilities`/`user`/`activeDownloadCount`) to `AppSidebar.tsx`, which now computes the
  same `showFirstStep = !capabilities.catalogKeyConfigured || (indexerStatus?.configuredIndexers ??
  0) === 0` used in Settings and wraps the nav entry in `...(showFirstStep ? [...] : [])`. The
  `/first-step` route itself is untouched — still reachable by direct URL or bookmark once
  configured, only the nav entry disappears. Typecheck 0 errors; Biome flagged import-order/format
  issues introduced by the edits (fixed with `--write`) plus the same 3 pre-existing errors on
  unrelated lines (`useButtonType` on the submenu toggle button, two `useExhaustiveDependencies` on
  the submenu-matching effect) already recorded under earlier `AppSidebar.tsx` touches in this
  repo's history — confirmed via `git diff` that none of the three sit inside this change's diff.
  `check-messages` unchanged at 594 keys. Verified live: with the dev stack's real TMDB key and 2
  indexers configured, the sidebar no longer lists "First step" (ends at Users), while navigating
  directly to `/first-step` still renders the full page correctly.

  **Sixth post-close addendum**: the user clarified the fourth addendum's conditional visibility
  should apply only to the sidebar entry (fifth addendum), not to the Settings help link — the
  Torrent Manager tab's `CircleHelp` link should always be reachable, setup complete or not.
  Reverted the fourth addendum's conditional wrapper: `TorrentManagerPanel.tsx` lost the
  `tmdbKeyConfigured`/`indexerStatus` props and the `showFirstStepHelp` check, the `<a>` renders
  unconditionally again; `SettingsForm.tsx` lost the `indexerStatus` prop and the
  `tmdbKeyConfigured` computation it threaded through; `settings/page.tsx` lost its
  `getIndexerStatus()` call and `indexerStatus` destructure — confirmed back to byte-for-byte its
  pre-fourth-addendum content (`git status --short` on the file is empty). The fifth addendum's
  sidebar conditional (`(dashboard)/layout.tsx`, `AdminShell.tsx`, `AppSidebar.tsx`) is untouched
  by this revert. Typecheck 0 errors, Biome clean, `check-messages` unchanged at 594 keys. Verified
  live: with the dev stack's real TMDB key and 2 indexers still configured, the Settings help link
  is present again while the sidebar entry stays hidden — the two now deliberately diverge.

## Blocked

| Task | Service | What blocked it | Needs |
| :-- | :-- | :-- | :-- |

Empty is the normal state. A contract problem always lands here (Article VIII): an agent that finds
the GraphQL delta wrong stops and reports, it never amends the delta from inside its slice.
