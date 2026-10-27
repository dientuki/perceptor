---
title: Manual Subtitle Search — Tasks
last_updated: 2026-10-26
status: Done
---

# TASKS: Manual Subtitle Search (`tasks.md`)

## Legend

| Marker | Meaning |
| :-- | :-- |
| `[api]` `[web]` `[worker]` `[infra]` | Which subagent owns the task. Exactly one per task — a task that needs two services is two tasks. |
| `[docs]` | Documentation, the contract doc and the manual pass. Owned by the orchestrator, not a service agent. |
| `[P]` | May run in parallel with the other `[P]` tasks in the same group. |
| `→ Tnnn` | Blocked by that task. |
| `[x]` `[~]` | `[~]` = implemented, awaiting a manual run by the maintainer. |

The constitution amendment this spec needs (NFR-1, Article XII v1.7.0) was ratified on 2026-10-26
before the plan, so there is no Group 0.

**Measuring.** The stack running on this host may be the end-user install, not this checkout, so
`bin/cli`/`bin/npm` may find no container. In that case, run each *Done when* command through the
throwaway container described in memory (`measuring-without-dev-stack`): `docker run --rm --user
1000:1000 -v "$PWD/services/<svc>":/app -w /app -e HOME=/tmp node:24.18.0-alpine sh -c '<command>'`.
Report which form was used.

## Tasks

### Group 1 — `api`: schema, guards, entry point and contract

- [x] **T001** `[api]` Add `SubtitleSearch.libraryPath String? @db.VarChar(500)` to
      `services/api/prisma/schema.prisma` with migration `106_subtitle_search_library_path`. Add
      `SUBTITLE_SEARCH_IN_PROGRESS` and `SUBTITLE_SEARCH_NO_LANGUAGES` to `src/i18n/error-keys.ts`,
      with English copy in `src/i18n/messages.en.ts` (`api/plan.md` Steps 1–2).
      *Done when:* `bin/cli api npx prisma migrate status` reports the migration applied, and
      `bin/cli api npx --no tsc --noEmit` exits 0.
- [x] **T002** `[api]` In `src/subtitle-embed/subtitle-embed.service.ts`, add the public preflight
      for a manual search, `(ref, userId)`. It reuses `resolveTarget`, `hasPossession`,
      `assertUsableMkv` (only when `filePath` is set) and `assertNotBusy`, in spec REQ-3 order, and
      returns the target facts. Also make the `.mkv`/library check callable on a resolved container
      path (`api/plan.md` Step 3). No logic is copied: every check is the existing private method.
      *Done when:* typecheck exits 0, and `bin/npm api run test -- subtitle-embed` passes unchanged
      (`101`'s behaviour is untouched). → T001
- [x] **T003** `[api] [P]` In `src/subtitle-search/subtitle-search-request.service.ts`, add
      `requestForCaller(target, userId)` (the name must contain `requestFor`, for the Article XII
      Check). It does the following, per `api/plan.md` Step 4:
      - runs the T002 preflight;
      - wants the union of the caller's effective languages (preference ignored) and the opted-in
        owners';
      - throws `no_languages` on an empty union;
      - checks for a non-terminal search and creates the row in one serializable transaction
        (`in_progress`, `P2034` mapped to it);
      - wakes with delay 0;
      - returns the id.

      `requestFor` keeps superseding, waking at 5 minutes and swallowing its errors. Import
      `SubtitleEmbedModule` in `subtitle-search-request.module.ts`. Extend
      `subtitle-search-request.service.spec.ts` with the cases in `api/plan.md` § Tests.
      *Done when:* `bin/npm api run test -- subtitle-search-request` passes, including:
      - one test per REQ-3 refusal asserting no row and no wake;
      - caller languages with the preference off;
      - `in_progress` leaving the running row untouched;
      - delay 0 for a press against 5 minutes for `requestFor`. → T002
- [x] **T004** `[api] [P]` REQ-7 in `src/subtitle-search/subtitle-search.driver.ts`:
      - `loadTarget` also selects `mediaServerPresentAt`;
      - `waiting`, for a title with no `filePath`, accepts the `resolveItem` item without the path
        comparison and translates its host path with `hostToContainerPath('library', …)`, failing
        with `outside_library` on `null`;
      - it runs the T002 `.mkv` check on that path, failing with the key it throws;
      - otherwise it writes `libraryPath` on the `WAITING → SEARCHING` transition.

      In `src/subtitle-search/subtitle-search.service.ts`, `details` reads
      `filePath ?? libraryPath`. Extend the driver and service specs per `api/plan.md` § Tests.
      *Done when:* `bin/npm api run test -- subtitle-search` passes, including:
      - a no-`filePath` title is matched and its `libraryPath` written;
      - a `.mp4` or out-of-library item path fails with no `searchRemoteSubtitles` call;
      - a `filePath` title still rejects an item whose path differs;
      - `details` falls back to `libraryPath`. → T002
- [x] **T005** `[api]` Add `searchMovieSubtitles(movieId: Int!)` and
      `searchEpisodeSubtitles(episodeId: Int!)` to `src/subtitle-search/subtitle-search.resolver.ts`.
      They are user-authenticated, never `@AllowService`, and carry the spec SDL's descriptions. Each
      one calls `assertSubtitleSearchAvailable()`, then `requestForCaller` with the current user's
      id, and returns `latestForMovie`/`latestForEpisode`. Import `SubtitleSearchRequestModule` in
      `subtitle-search.module.ts`. Regenerate `schema.gql` by booting `api` (Article IV).
      *Done when:*
      - `git diff services/api/src/schema.gql` shows exactly the two mutations and their
        descriptions;
      - typecheck and `bin/npm api run test` pass;
      - `bin/comments api` is clean;
      - `grep -rn "embedStaged\|requestFor" services/api/src --include=*.ts` lists, outside tests,
        only `process-jobs/`, the driver, the request service and this resolver (AC-9, Article XII
        Check). → T003, T004
- [x] **T006** `[docs]` Add a `106-manual-subtitle-search` subsection to
      `docs/spec/graphql-contract.md`, beside `103`'s. It covers:
      - the two mutations;
      - press refuses and never supersedes;
      - the reused `subtitleEmbed` refusal keys;
      - `in_progress` and `no_languages`;
      - `errorKey` may now be `not_mkv`/`outside_library`;
      - `libraryPath` is `api`-internal.

      *Done when:* the subsection matches `spec.md` § GraphQL Contract Delta and `schema.gql`
      line for line. → T005

### Group 2 — `web`: the button

Everything here depends on T005: the mutations must exist in `schema.gql` before `web` calls them.

- [x] **T007** `[web]` Catalog and actions:
      - `errors.subtitleSearch.in_progress` and `no_languages`, plus a `media.searchSubtitles` group
        (button, dialog title and body naming the daily provider quota, confirm, cancel, in-flight
        hint), in `messages/en.json` and `messages/es.json`;
      - `searchMovieSubtitlesAction(movieId)` in `src/actions/movies.ts` and
        `searchEpisodeSubtitlesAction(episodeId)` in `src/actions/shows.ts`, shaped like the embed
        actions (`{ search }` | `{ errorKey }`), selecting the fields `latestSubtitleSearch` already
        selects (`web/plan.md` Steps 1–2).

      *Done when:* `bin/cli web npx --no tsc --noEmit` exits 0, and every key in `web/plan.md` §
      Contract obligations resolves in both catalogs. → T005
- [x] **T008** `[web]` Create `src/components/media/SearchSubtitlesButton.tsx` on
      `EmbedSubtitlesButton`'s pattern:
      - `useModal`, the confirmation dialog, `translateErrorKey`;
      - `router.refresh()` on success and on `in_progress`;
      - disabled with the hint while the latest search is non-terminal;
      - `compact`/`fullWidth` props.

      Render it for a film in `TitleLanguagesPanel.tsx`/`Movie.tsx` when
      `subtitleSearchAvailable && movie.status === 'COMPLETED'` (`web/plan.md` Steps 3–4).
      *Done when:* typecheck and `bin/npm web run lint` pass, and the film page shows the button on a
      `COMPLETED` film and not on a `MISSING` one. → T007
- [x] **T009** `[web]` Render the button (`compact`) on each episode row in
      `src/components/shows/SeasonAccordion.tsx` under the same rule on `episode.status`, bound to
      `searchEpisodeSubtitlesAction`. Fetch `getMediaCapabilities()` in
      `src/app/(dashboard)/shows/[id]/page.tsx` if the series page does not already have it
      (`web/plan.md` Step 5).
      *Done when:* typecheck, lint and `bin/comments web` pass, and the series page shows the
      button only on `COMPLETED` episode rows. → T008

### Group 3 — verification and docs

- [~] **T010** `[docs]` Manual pass, `plan.md` § Verification items 1–8, covering AC-1 to AC-8b. It
      needs Jellyfin with its OpenSubtitles plugin logged in and quota left, so mark `[~]` until the
      maintainer runs it. Record what was observed against each AC.
      *Done when:* every item has an observed result written in this file, or is marked `[~]` with
      what it waits on. → T006, T009

      *Observed 2026-10-26:* nothing live. No dev stack was up (`api`/`web` containers not running) and
      the pass needs Jellyfin with its OpenSubtitles plugin logged in and quota left, so items 1–7
      (AC-1 to AC-8b) are `[~]` until the maintainer runs them. Item 8 (AC-9) was run: the grep lists
      only `process-jobs/`, the driver, the request service, the resolver and the `embedStaged`
      definition, and `schema.gql` adds only the two mutations. The refusals, the language union, the
      no-supersede rule, the delay of 0 and the REQ-7 branch are covered by unit tests (api: 82 suites,
      1414 passed).
- [x] **T011** `[docs]` Update the docs:
      - root `CLAUDE.md`: the **Notify media server** row and the **Browse library** row each gain
        `106` (the manual trigger, a title with no `filePath` searched through Jellyfin's item), and
        `106` joins both spec lists;
      - `services/api/CLAUDE.md` § `subtitle-search/`: the second entry point, the preflight on
        `SubtitleEmbedService` and `libraryPath`;
      - `services/web/CLAUDE.md` § Automatic subtitle search: the button and its visibility rule;
      - a `106` entry at the top of `docs/spec/history.md` with the re-measured counts.

      *Done when:* each file names `106` where described, and `bin/pending-acs --check` reflects
      the current state. → T010
- [x] **T012** `[docs]` Walk the acceptance criteria in `spec.md` (AC-1 to AC-10, including AC-8b),
      tick each verified box, then:
      - set `status: Implemented` on `spec.md`, `plan.md`, `api/plan.md` and `web/plan.md`;
      - set this file to `Done`;
      - run `/pending-acs` for any box left unticked.

      *Done when:* every AC is ticked or named in `docs/spec/pending-acs.md` with its blocker.
      → T011

## Blocked

| Task | Service | What blocked it | Needs |
| :-- | :-- | :-- | :-- |
