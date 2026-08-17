---
title: Per-Episode Acquisition (Search, Magnet, File) — Tasks
last_updated: 2026-08-13
status: Done
---

# TASKS: Per-Episode Acquisition (Search, Magnet, File) (`tasks.md`)

## Legend

| Marker | Meaning |
| :-- | :-- |
| `[api]` `[web]` | Which subagent owns the task. Exactly one per task — a task that needs two services is two tasks. |
| `[docs]` | Documentation only. Owned by the orchestrator, not a service agent. |
| `[P]` | May run in parallel with the other `[P]` tasks in the same group. |
| `→ Tnnn` | Blocked by that task. |

No `[worker]` and no `[infra]`/`[orch]` tasks: the worker is out of scope by decision
(`spec.md` § Out of Scope) and this feature changes no `bin/` script, no `docker-compose.yaml`, no
`.env.example` and no Dockerfile. There is no migration — every column already exists.

## Tasks

### Group 1 — `api`: close the hole, then build the episode surface

T001 comes first and is not a formality. `MediaSource.infoHash` is globally unique, and
`MoviesService`'s collision guard only inspects `existingSource.movie`; the moment an episode can
own a source, a hash belonging to an episode falls through that guard and the row is silently
re-pointed at a film. Landing T002-T004 first would mean a window in which the bug is reachable.

- [x] **T001** `[api]` In `src/movies/movies.service.ts`, extend `attachTorrentSource`'s `infoHash`
      collision guard to recognise a `MediaSource` owned by an **episode**, not only by a movie.
      Message stays `Ese magnet ya está asociado a «<title>»`; an episode-owned source renders its
      title as `<Show> S04E01` (zero-padded).
      *Done when:* a magnet whose `infoHash` already belongs to an episode is refused with that
      message instead of stealing the row; every film-to-film case is byte-identical to today;
      `bin/cli api npx --no tsc --noEmit` reports 0 errors and `bin/npm api test` stays green at its
      current count.
- [x] **T002** `[api]` Create `src/episodes/` — `episodes.module.ts` (imports `SettingsModule` for
      `QbittorrentClient`, exports `EpisodesService`) and `episodes.service.ts` with
      `findOneFromDb(episodeId, userId)` scoped through `season.show.users`, mirroring
      `ShowsService.findOneFromDb`. Register `EpisodesModule` in `src/app.module.ts`.
      *Done when:* `bin/cli api npx --no tsc --noEmit` reports 0 errors, the api container boots
      clean (`docker compose logs api`), and `src/schema.gql` is **unchanged** — there is no
      resolver yet, so this task must add nothing to the contract.
- [x] **T003** `[api]` Add `EpisodesService.attachTorrentSource` (private) plus
      `addTorrentToEpisode` and `addMagnetToEpisode`, following `api/plan.md` § Steps 3-4: ownership
      lookup, active-source conflict with `force`, demote-then-replace, symmetric collision check,
      `qbittorrent.add()` **before** any DB write, then `Episode.status = DOWNLOADING`. → T001, T002
      *Done when:* called directly (unit or REPL), an episode acquisition writes one `media_sources`
      row with `episode_id` set and `movie_id` null; a second call without `force` throws
      `Este episodio ya tiene una descarga en curso. Confirmá para reemplazarla.`; with `force` the
      previous row is `ERROR` with a non-null `error_message` **before** the new row exists.
- [x] **T004** `[api]` Add `src/episodes/episodes.resolver.ts` — `@Resolver(() => Episode)`
      importing the existing entity from `src/shows/entities/episode.entity.ts` (do not declare a
      second `@ObjectType()`), exposing both mutations with `@CurrentUser()` and **no**
      `@AllowService()`. → T003
      *Done when:* the regenerated `src/schema.gql` contains
      `addTorrentToEpisode(episodeId: Int!, infoHash: String!, urls: [String!]!, releaseTitle: String, force: Boolean = false): Episode!`
      and `addMagnetToEpisode(episodeId: Int!, magnet: String!, force: Boolean = false): Episode!`
      verbatim, and a `SERVICE_TOKEN` call to either returns `No autenticado`.

### Group 2 — `api`: upload path and pipeline callbacks

T005, T007 and T008 touch disjoint files and depend only on Group 1; they may overlap. T006 chains
off T005.

- [x] **T005** `[api] [P]` Make the upload ticket episode-capable:
      `src/uploads/upload-tickets.service.ts` (payload gains `episodeId`; `mint` takes a target;
      `verifyAndSpend` compares against the ticket's own target, still **before** the Redis spend),
      `src/uploads/uploads.resolver.ts` (`createUploadTicket(movieId: Int, episodeId: Int)`,
      exactly-one-of, branching to the matching ownership check), and `src/uploads/uploads.module.ts`
      (import `EpisodesModule`). → T002
      *Done when:* `createUploadTicket(episodeId:)` mints a ticket for an owned episode; with both
      ids or with neither it fails with `Indicá exactamente uno de movieId o episodeId` and no
      `upload:ticket:<jti>` key appears in Redis; `createUploadTicket(movieId:)` still works
      unchanged for a film.
- [x] **T006** `[api]` Make the tus finish hook episode-capable in `src/uploads/uploads.service.ts`:
      `onUploadCreate` reads whichever id the metadata carries; a metadata target disagreeing with
      the ticket's is `UploadHttpError(403, 'El permiso de subida no corresponde a este episodio')`;
      `handleUploadFinish` creates the `LOCAL_FILE`/`READY` `MediaSource` with `episodeId`, applies
      the same active-source conflict rule as T003, moves the episode to `ENCODING` and enqueues
      `addSourceReady` in the same request. Keep the `movieId` metadata key's name and meaning. → T005
      *Done when:* a completed episode upload produces a `media_sources` row with
      `kind = LOCAL_FILE`, `status = READY`, `episode_id` set, the episode reads `ENCODING`
      (never `DOWNLOADING`), and one `bull:process` job is enqueued.
- [x] **T007** `[api] [P]` In `src/downloads/downloads.service.ts`, add `episode` to
      `handleTorrentCompleted`'s `include` and move an episode-owned source's episode to `ENCODING`
      inside the existing transaction. Add the guard that a source already in `ERROR` (a demoted
      one, from T003) moves nothing. Signature unchanged; unknown hashes stay silently ignored. → T003
      *Done when:* firing the hook with a live episode source's hash leaves the episode `ENCODING`
      with one `bull:process` job enqueued and the show's other episodes untouched; firing it with a
      **superseded** hash changes nothing.
- [x] **T008** `[api] [P]` In `src/media-sources/media-sources.service.ts`, stamp `episodeId` on the
      `SourceFile` upsert (both `create` and `update`) beside the existing `movieId`, and extend the
      `matchedFilePath === null` branch to mark the `Episode` `ERROR` the way it already marks a
      `Movie`. Signature unchanged — the worker sends exactly what it sends today. → T003
      *Done when:* a scan with a matched file leaves `source_files.episode_id` set; a scan reporting
      no video leaves both the `media_sources` row **and** the episode `ERROR`, not `ENCODING`.

### Group 3 — `api`: tests and the contract proof

- [x] **T009** `[api] [P]` Write `src/episodes/episodes.service.spec.ts` following the structure of
      `src/clients/torrent/magnet.spec.ts` — header comment naming the bug class, `describe` per
      unit, indicative `it(...)` strings in **English** (Article VI). Cases listed in
      `api/plan.md` § Tests. Do not imitate the `expect(service).toBeDefined()` scaffolding under
      `src/users/`. → T003
      *Done when:* `bin/npm api test` is green with the new suite, and the `episodeId`-never-`movieId`
      case is verified to **fail** when the field is swapped — a test that passes either way defends
      nothing.
- [x] **T010** `[api] [P]` Extend `src/uploads/upload-tickets.service.spec.ts` with a cross-target
      case: a ticket minted for a movie and presented for an episode is refused **and not spent**.
      Extend the existing file; do not start a new one. → T005
      *Done when:* the new case passes, and it fails if the target check is moved after the Redis
      spend — the not-spent half is the part that fails silently.
- [x] **T011** `[api]` Diff the regenerated `src/schema.gql` against `spec.md` § GraphQL Contract
      Delta. → T004, T005
      *Done when:* the diff shows exactly the two new mutations and `createUploadTicket`'s two
      arguments becoming nullable — and nothing else. Any extra field or argument is a contract
      breach (Article VIII) and goes to § Blocked rather than being kept.

### Group 4 — `web`: consumers

Everything here depends on Group 1: `web` cannot call a mutation the schema does not have, and
starting earlier means writing against a signature that does not exist yet. Read
`services/web/AGENTS.md` before writing any Next.js code — this is Next 16.

- [x] **T012** `[web]` In `src/types/media.ts`, delete the placeholder `Episode` type (its own
      comment marks it a stand-in until the API exposed episodes — it does now) and add the
      `AcquisitionTarget` discriminated union from `web/plan.md` § Steps 2. Re-point every consumer
      at `Episode` from `@/actions/shows`. → T004
      *Done when:* `grep -rn "from \"@/types/media\"" services/web/src` shows no remaining `Episode`
      import from that module, and `bin/cli web npx --no tsc --noEmit` reports no **new** errors.
- [x] **T013** `[web]` Add `addTorrentToEpisodeAction` and `addMagnetToEpisodeAction` to
      `src/actions/shows.ts`, copying the shape of `src/actions/media-server.ts` (`'use server'`
      first line, SCREAMING_SNAKE document const, `fetchGraphQL<T>`, `errors[0].message` with a
      Spanish fallback). Handle every error row in `web/plan.md` § Contract obligations, not just
      the happy path. → T004, T012
      *Done when:* both actions round-trip against the running api — a successful call returns the
      episode's new `status`, and a conflict surfaces the exact Spanish string rather than a
      generic message.
- [x] **T014** `[web]` Change `createUploadTicketAction` in `src/actions/uploads.ts` to take a
      target and send exactly one of the two now-nullable arguments, **by name**. → T005, T012
      *Done when:* a film upload still mints a ticket (unchanged behaviour) and an episode upload
      mints one too; neither ever sends `undefined` for the id it is not using.
- [x] **T015** `[web]` Retype `src/components/search/SearchTorrentModal.tsx` against the union and
      remove its `@prisma/client` import. → T012
      *Done when:* `grep -rn "@prisma/client" services/web/src` returns **nothing** — this file is
      the service's last violation of Constitution Article II.
- [x] **T016** `[web]` Rework `src/components/search/SearchTorrent.tsx`: remove the
      `mediaType !== MEDIA_TYPE.MOVIE` early return and branch on the target's `kind`; replace
      `window.confirm` with the `needsConfirm` two-step from `importMagnetModal.tsx` (matching the
      shared substring `ya tiene una descarga en curso`, not the full sentence, so it catches both
      the film and episode wordings); and make `<tbody>` the scroll container under a fixed
      `<thead>` — the wrapper `<div>` gets `flex-1 min-h-0`, the scroll does **not** go on the
      wrapper or the header scrolls away with the rows. Leave the existing `S04E01` query builder
      alone. → T013, T015
      *Done when:* clicking a result on an episode row starts a download against that episode; the
      column header stays in the viewport while the result list scrolls to the bottom, with columns
      still aligned at desktop and narrow widths; no `window.confirm` remains in the file.
- [x] **T017** `[web]` Make `src/components/import/importMagnetModal.tsx` and `importFileModal.tsx`
      dispatch on `target.kind`. The file modal sends `episodeId` in the tus metadata for an
      episode and keeps `movieId` for a film. Delete the now-false comment at
      `importFileModal.tsx:96-97`. → T013, T014
      *Done when:* an episode magnet and an episode file upload both land on the episode; the film
      paths are unchanged; an invalid magnet renders `No parece un magnet link` inline in the modal,
      never through `alert()`.
- [x] **T018** `[web]` Wire `src/components/shows/SeasonAccordion.tsx`: hold `activeEpisode` and the
      three `useModal()` triples in the accordion and pass the open handlers into `EpisodeRow` as
      props (the handlers must set `activeEpisode` **before** opening, or every modal early-returns
      `null`); accept `showTitle`. Pass `show.title` down from
      `src/app/(dashboard)/shows/[id]/page.tsx`. → T015, T016, T017
      *Done when:* all three buttons on an episode row open their modal with that episode's data;
      `bin/cli web npx --no tsc --noEmit` reports **exactly 11 errors across 4 files**
      (`ResultsForm.tsx` 5, `SearchForm.tsx` 2, `ImportMagnetSeasonModal.tsx` 2,
      `importFolderModal.tsx` 2) — down from today's 12, none in a file this slice touched.

### Group 5 — verification and docs

- [x] **T019** `[docs]` Annotate `docs/spec/features/009-show-detail/spec.md` to record that its
      **REQ-5** (buttons inert, wiring commented out) and **AC-4** (a click opens no modal and fires
      no request) are superseded by `010-episode-acquisition`, and update the root `CLAUDE.md`
      pipeline table: the **Find release (indexer)** and **Download** rows now cover single
      episodes, and the **Browse library** row must stop describing the episode buttons as "visible
      but inert". → T018
      *Done when:* no document in the repo still asserts the episode buttons do nothing.
- [x] **T020** `[docs]` Update `services/api/CLAUDE.md` (module map gains `episodes/`; the
      `uploads/` paragraph's `createUploadTicket` description; the test/typecheck counts) and
      `services/web/CLAUDE.md` (the 12-errors-across-5-files table becomes 11 across 4; the
      `009-show-detail` paragraph saying the episode buttons are deliberately unwired; the
      `Episode`-type and `AcquisitionTarget` convention). → T018
      *Done when:* both files' "Current state" sections match freshly re-run `tsc` and test output,
      not the numbers written here.
- [x] **T021** `[docs]` Walk every acceptance criterion in `spec.md` against the running stack
      (`plan.md` § Verification has the manual pass), tick each box, and set `status: Implemented`
      on `spec.md`, `plan.md`, `api/plan.md`, `web/plan.md` and this file. → T019, T020
      *Done when:* all 18 ACs are ticked with the observed result, or any that cannot be reached is
      recorded in § Blocked instead of being ticked.

## Blocked

Anything an agent stopped on rather than working around. Empty is the normal state; a non-empty
entry is a decision waiting for a human.

| Task | Service | What blocked it | Needs |
| :-- | :-- | :-- | :-- |

Contract problems always land here (Constitution, Article VIII): an agent that finds the GraphQL
delta wrong stops and reports, it does not amend the delta from inside its slice.
