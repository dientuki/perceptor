---
title: Title Removal — Tasks
last_updated: 2026-09-20
status: Draft
---

# TASKS: Title Removal (`tasks.md`)

## Legend

| Marker | Meaning |
| :-- | :-- |
| `[api]` `[web]` `[worker]` `[infra]` | Which subagent owns the task. Exactly one per task — a task that needs two services is two tasks. |
| `[docs]` | Documentation only. Owned by the orchestrator, not a service agent. |
| `[P]` | May run in parallel with the other `[P]` tasks in the same group. |
| `→ Tnnn` | Blocked by that task. |

Every service task reads `spec.md`, `plan.md` and its own `<svc>/plan.md` first. The GraphQL
Contract Delta in `spec.md` is frozen — a task that finds it wrong stops and lands in **Blocked**.

There is **no `[worker]` task and no `[infra]` task** in this feature. `worker` untouched is NFR-4,
and it is the mechanism, not an omission: an encode is stopped through the `encode:cancel` publish
the worker already honours from `047`. A diff under `services/worker` is a scope violation, not
progress.

## Tasks

### Group 1 — `api`: the unwind seam, the two removals, the contract

- [ ] **T001** `[api]` Add `src/media/entities/title-removal.entity.ts` — the `TitleRemoval`
      `@ObjectType` with `deleted: Boolean!` and `remainingOwners: Int!`, exactly as `spec.md`
      § GraphQL Contract Delta declares it (`api/plan.md` § Steps 1).
      *Done when:* `bin/cli api npx --no tsc --noEmit` reports 0 errors.
- [ ] **T002** `[api]` Extract the per-source steps of `downloadDelete` in
      `src/downloads/downloads.service.ts` into a private `unwindSource(source, { removeTorrent })`
      — torrent client, then `publishCancel` + `removeEncode` per job, then `removeSourceReady`,
      then `deleteResidue`, then the row, in that order. `downloadDelete` keeps its
      `findOwnedSource` and `recomputeStatus` bookends and its behaviour is unchanged
      (`api/plan.md` § Steps 2). Pure refactor — no new behaviour in this task.
      *Done when:* `bin/npm api run test -- downloads.service` passes with the existing
      `downloadDelete` suite (`downloads.service.spec.ts:742`) **unmodified** — it is the regression
      net for this extraction, so a task that had to edit it is a task that changed behaviour.
- [ ] **T003** `[api]` Add the public `unwindSourcesForTitle(scope: { movieId } | { showId })` to
      `src/downloads/downloads.service.ts`: collect every `MediaSource` of the title (for a series,
      across `season.showId` **and** `episode.season.showId`), make **one**
      `callTorrentClient(() => qbittorrent.remove(hashes, true))` for every non-null `infoHash`,
      then `unwindSource(..., { removeTorrent: false })` per source. No `recomputeStatus` — the
      target is about to be deleted (`api/plan.md` § Steps 3). → T002
      *Done when:* `bin/npm api run test -- downloads.service` passes with a new suite carrying the
      Article IX header and covering: a fixture holding a `movieId`, a `seasonId` and an
      `episodeId` source at once, asserting every hash reaches **one** `remove()` call (the missed
      source that keeps seeding forever); the full per-source call set including `publishCancel`
      (the dropped cancel that leaves the worker encoding into nothing); a `callTorrentClient`
      rejection leaving `mediaSource.delete` and `rm` uncalled (NFR-2/AC-6); and a throwing
      `deleteResidue` not stopping the remaining sources (NFR-3).
- [ ] **T004** `[api]` Add `remove(id, userId)` and `otherOwnersFor(userId, movieId)` to
      `src/movies/movies.service.ts`: `findOneFromDb` → null throws
      `i18nError.notFound(ERROR_KEYS.MOVIE_NOT_FOUND, { id })`; count other owners; > 0 deletes the
      one `userMovie` row and returns `{ deleted: false, remainingOwners: n }`; 0 calls
      `unwindSourcesForTitle({ movieId })` then `prisma.movie.delete` and returns
      `{ deleted: true, remainingOwners: 0 }` (`api/plan.md` § Steps 4–5). → T001, T003
      *Done when:* `bin/npm api run test -- movies.service` passes with cases for: other owners > 0
      → only the join row deleted and `unwindSourcesForTitle` never called (AC-2); 0 → unwind then
      delete (AC-1); an id the caller does not own → the keyed refusal with nothing deleted (AC-7);
      an id already removed → the same refusal, no Prisma throw (AC-8, NFR-5).
- [ ] **T005** `[api]` Expose the film surface: `removeMovie(id: Int!): TitleRemoval!` in
      `src/movies/movies.resolver.ts` with `assertEnabled(MEDIA_TYPE.MOVIE)` **before** the
      ownership read (`setMovieContentKind`'s template), the `otherOwners` `@ResolveField`, and the
      `otherOwners: Int!` declaration in `src/movies/entities/movies.entity.ts`
      (`api/plan.md` § Steps 6). → T004
      *Done when:* typecheck 0 errors; `bin/npm api run test -- movies.resolver` passes including a
      case where `movies_enabled` false yields `error.media.type_disabled` without revealing whether
      the id exists (AC-13's film twin); `src/schema.gql` shows `removeMovie` and `Movie.otherOwners`.
- [ ] **T006** `[api]` Add `DownloadsModule` to `src/shows/shows.module.ts` imports, then
      `remove(id, userId)` and `otherOwnersFor(userId, showId)` in `src/shows/shows.service.ts` —
      the twin of T004 against `userShow`/`show`, refusing with `ERROR_KEYS.SHOW_NOT_AVAILABLE` (no
      params) and unwinding through `unwindSourcesForTitle({ showId })` (`api/plan.md` § Steps 7,
      9). → T003
      *Done when:* the api container boots with no Nest dependency-resolution error, and
      `bin/npm api run test -- shows.service` passes with the same four cases as T004 plus one
      asserting a series' season-pack **and** per-episode sources are both collected (AC-3).
- [ ] **T007** `[api]` Expose the series surface: `removeShow(id: Int!): TitleRemoval!` in
      `src/shows/shows.resolver.ts` following `setShowContentKind`'s ordering (`assertEnabled` →
      `findOneFromDb` → refuse), the `otherOwners` `@ResolveField`, and the declaration in
      `src/shows/entities/show.entity.ts` (`api/plan.md` § Steps 8). Keep the deliberate asymmetry:
      the ownership gate lives in the resolver here and in the service for movies — do not
      harmonise them. → T006
      *Done when:* typecheck 0 errors; `bin/npm api run test -- shows.resolver` passes including
      `shows_enabled` false → `error.media.type_disabled` with the series row unchanged (AC-13);
      `src/schema.gql` shows `removeShow` and `Show.otherOwners`.
- [ ] **T008** `[api]` Regenerate and check the whole slice (`api/plan.md` § Done when). → T005, T007
      *Done when:* `bin/cli api npx --no tsc --noEmit` 0 errors; `bin/npm api run test` all green;
      `git status --short services/api/prisma` **empty** (NFR-1 — a migration here means someone
      solved a problem the schema had already solved); `git diff services/api/src/schema.gql` is
      exactly `TitleRemoval`, `removeMovie`, `removeShow`, `Movie.otherOwners`, `Show.otherOwners`
      and nothing else (Article VIII's Check).

### Group 2 — `web`: the button, the dialog, the copy

Everything here depends on T008: `web` retypes the schema by hand with no codegen, so a field
selected before it exists in `schema.gql` fails only at runtime.

- [ ] **T009** `[web]` Add `otherOwners` to the two **detail** queries and their types in
      `src/actions/movies.ts` and `src/actions/shows.ts`, and add `removeMovieAction(id)` /
      `removeShowAction(id)` following `deleteDownloadAction`'s shape
      (`fetchGraphQL` → `redirectIfUnauthenticated` → `toActionError` → success), returning
      `{ success: true; deleted; remainingOwners }` and calling `revalidatePath` for the listing
      (`/movies` and `/shorts`, or `/shows`) before returning (`web/plan.md` § Steps 1–2). → T008
      *Done when:* `bin/cli web npx --no tsc --noEmit` reports 0 errors, and `otherOwners` appears
      in neither `getMovies`/`getShows` nor the billboard or calendar queries — it is a per-row
      count and belongs nowhere near a listing (`plan.md` § Contract Freeze).
- [ ] **T010** `[web]` Add `src/components/media/RemoveTitleModal.tsx` on
      `DeleteDownloadModal.tsx`'s template (Modal + `useModal`, error inside the dialog, cleared on
      every open, `isPending`, `variant="danger"`, `Trash2`), with copy branching on
      `otherOwners > 0` ("se quita de tu biblioteca") versus `0` ("se elimina de Perceptor"), plus
      the conditional line saying the library file itself stays when the title has one. Wire the
      button into the existing button row in `src/components/movies/Movie.tsx` and its equivalent in
      `src/components/shows/Show.tsx`; on success close and `router.push` to the right listing, on
      error keep the dialog open with the confirm button still enabled (`web/plan.md` § Steps 3–5).
      → T009
      *Done when:* `bin/npm web run build` exits 0, and on a running stack the two dialogs render
      different copy for a shared title and a solely-owned one (AC-15), with the file-stays line
      present on a `COMPLETED` title.
- [ ] **T011** `[web]` Complete both message catalogs: every key T010 introduced, **plus** the two
      REQ-13 keys that exist in neither file today — `errors.movie.not_found` (takes `{id}`) and
      `errors.show.not_available` — in `messages/en.json` and `messages/es.json`, Rioplatense
      register for `es` (`web/plan.md` § Steps 6). → T010
      *Done when:* `bin/cli web node scripts/check-messages.mjs` reports no `en`/`es` drift, and a
      `removeMovie` refusal in a session with `uiLocale = es` renders in Spanish rather than
      `Movie {id} does not exist` (AC-16). A key added to only one catalog passes the eye test and
      fails this one; a key added to neither looks exactly like not fixing REQ-13 at all.

### Group 3 — verification and docs

- [ ] **T012** `[docs]` Update the root `CLAUDE.md`: the **Browse library** row of the pipeline
      table gains title removal (`removeMovie`/`removeShow`, the two outcomes, the reuse of `047`'s
      unwind, `FfprobeLog` surviving, Article XII leaving the library file), and the **Current
      state** section gains this feature's measured counts. Check whether
      `services/api/CLAUDE.md`'s module map needs the new `DownloadsModule` edge from `shows`.
      → T008, T011
      *Done when:* the pipeline table's Browse library row cites `067`, and the numbers recorded in
      Current state are ones this task actually re-ran rather than copied.
- [ ] **T013** `[docs]` Walk every acceptance criterion in `spec.md` against a running stack,
      following `plan.md` § Verification's nine-step manual pass with two users — including the
      three that only a live run reaches: the untouched library file and its mtime after removing a
      `COMPLETED` title (AC-9), re-registering that same title clean (AC-10), and the unchanged
      `ffprobe_logs` count after a series removal (AC-11). Tick each box, record honestly which ACs
      were verified live and which rest on unit tests, then set `status: Implemented` on `spec.md`,
      `plan.md`, `api/plan.md` and `web/plan.md`. → T012
      *Done when:* every AC-n box in `spec.md` is ticked or explicitly recorded as not run, and all
      four files read `status: Implemented`.

## Blocked

Anything an agent stopped on rather than working around. Empty is the normal state; a non-empty
entry is a decision waiting for a human.

| Task | Service | What blocked it | Needs |
| :-- | :-- | :-- | :-- |

Contract problems always land here (Constitution, Article VIII): an agent that finds the GraphQL
delta wrong stops and reports, it does not amend the delta from inside its slice.
