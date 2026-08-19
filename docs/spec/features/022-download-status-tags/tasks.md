---
title: Download Status and Torrent Tags — Tasks
last_updated: 2026-08-19
status: Draft            # Draft | In Progress | Done
---

# TASKS: Download Status and Torrent Tags (`tasks.md`)

## Legend

| Marker | Meaning |
| :-- | :-- |
| `[api]` `[web]` `[worker]` `[infra]` | Which subagent owns the task. Exactly one per task — a task that needs two services is two tasks. |
| `[docs]` | Documentation only. Owned by the orchestrator, not a service agent. |
| `[P]` | May run in parallel with the other `[P]` tasks in the same group. |
| `→ Tnnn` | Blocked by that task. |

No `[worker]` and no `[infra]` task exists in this feature, and that is a finding rather than an
omission. `services/worker` sends and receives byte-identical shapes (`spec.md` NFR-2), and
`encode.job.ts:146`'s rethrow already makes cleanup unreachable on a failed encode, which is what
REQ-16 asks for. Nothing in `bin/`, `docker-compose.yaml`, `.env.example` or any Dockerfile changes.
An agent that finds itself needing to edit either territory has hit a contract error — stop and
report (Constitution, Article VIII).

## Tasks

### Group 1 — schema and the client adapter

Strictly serial, and all `[api]`. T001 regenerates the Prisma client that T002 and T003 both compile
against — `client.ts` imports `SourceStatus` from `@prisma/client`, so it is not as independent of
the migration as it looks.

- [ ] **T001** `[api]` Invert the `Movie` ↔ `MediaSource` relation in `prisma/schema.prisma`: add
      `movieId Int?` plus its `movie Movie?` relation to `MediaSource`, mirroring `episodeId` /
      `seasonId`; remove `mediaSourceId` and `mediaSource` from `Movie`. Generate the migration with
      `bin/npm api run prisma:migrate` — never hand-written SQL (Article III). No backfill
      (`spec.md` NFR-8).
      *Done when:* `git status services/api/prisma/` shows **both** a modified `schema.prisma` and a
      new migration directory, and `bin/mysql -e "describe media_sources"` lists a `movie_id`
      column while `bin/mysql -e "describe movies"` no longer lists `media_source_id`.

- [ ] **T002** `[api]` Fix every reader of the relation T001 removed: `movies.service.ts` (the
      `include: { mediaSource: true }` at :58 and :72, and the conflict/write at :291, :295, :360),
      `movies/entities/movies.entity.ts:37`, `movies/dto/create-movie.dto.ts:47`,
      `uploads.service.ts:212` and `:232`, and `media-sources.service.ts:14-23` — where
      `findOneFlat` stops deriving `movieId` from `mediaSource.movie?.id` and reads the column.
      That last one is the field the **worker** selects: same name, same type, same nullability.
      → T001
      *Done when:* `bin/cli api npx --no tsc --noEmit` reports 0 errors, and
      `grep -rn "mediaSourceId" services/api/src` returns no hit that refers to the dropped column.

- [ ] **T003** `[api]` Extend `clients/torrent/types.ts` and `clients/torrent/client.ts` per
      `../spec.md` § The torrent client interface: `add(urls, tags?)` sending qBittorrent's inline
      `tags`, `info(tag?)` filtering server-side and returning `progress` / `dlspeed` /
      `forceStarted` / `tags`, and new `start()` / `forceStart()` beside the existing `stop`/`remove`.
      Bring `mapTorrentState`'s sets to qBittorrent 5.0 (`stoppedDL`, `stoppedUP`, `forcedMetaDL` at
      minimum) and stop the fallthrough laundering an unrecognised state into `ERROR` (NFR-7). Add
      the `response.ok` check to every method, following `add()`'s existing one and its comment
      (NFR-6). `root_path` stays. → T001
      *Done when:* `bin/cli api npx --no tsc --noEmit` reports 0 errors, and a live
      `bin/cli api node -e` call to `info()` returns rows whose `state` reads `PAUSED` for a
      `stoppedDL` torrent and `DOWNLOADING` for a `forcedMetaDL` one — neither as `ERROR`.

### Group 2 — acquisition, the downloads surface and the race

All `[api]`. Ordered by dependency rather than by file; several are small.

- [ ] **T004** `[api]` Build the tag list per acquisition path and pass it into `qbittorrent.add()`:
      the film's title for a movie, `<Show title>` + `Season <n>` + `Episode <n>` for an episode,
      `<Show title>` + `Season <n>` for a season pack — English keywords, unpadded numbers (REQ-1 to
      REQ-3). Apply REQ-5's sanitisation: commas to spaces, whitespace collapsed, trimmed, with a
      non-empty id-derived fallback. Follow the existing deliberate duplication across `movies/`,
      `episodes/` and `seasons/` — do not extract a shared helper. → T003
      *Done when:* adding a release to a film shows exactly one tag in qBittorrent's sidebar, an
      episode shows three and a season pack two; a film whose title contains a comma yields **one**
      tag, not two.

- [ ] **T005** `[api]` Retire `force` (REQ-7): remove the `@Args('force', …)` from all five
      resolvers and the argument from the five service signatures; delete the three
      `ConflictException`s, the two `updateMany` demote-to-`ERROR` blocks in `episodes`/`seasons`,
      and **both** `UploadHttpError(409)` copies in `uploads.service.ts`. Every cross-title
      `infoHash` collision check stays exactly as it is. → T002
      *Done when:* `grep -rn "ya tiene una descarga en curso" services/api/src` is empty, `force`
      appears in no acquisition signature, and sending two different releases to one film succeeds
      twice with `bin/mysql -e "select id, status, info_hash, movie_id from media_sources where
      movie_id = <id>"` showing two non-`ERROR` rows.

- [ ] **T006** `[api]` Add the `downloads/` read and control surface: `entities/download.entity.ts`,
      the `movieDownloads` / `showDownloads` queries and the `downloadStart` / `downloadStop` /
      `downloadDelete` mutations, wired in `downloads.module.ts`. Rows come from `media_sources`
      scoped by the caller's ownership clause written locally (see `../api/plan.md` § Existing code
      to reuse — do **not** import `MoviesService`/`ShowsService`), joined to one `info(tag)` call on
      `infoHash`; `progress` is ×100 here, not in the adapter. A source with no `infoHash` is refused
      with `Esa descarga no es un torrent` before any client call. A torrent absent from the client
      yields null live fields and is never dropped from the list. No `@AllowService()`.
      → T002, T003
      *Done when:* the regenerated `src/schema.gql` diff matches `../spec.md` § GraphQL Contract
      Delta exactly; `movieDownloads` for another user's film answers `La película <id> no existe`;
      `downloadStart` on a `LOCAL_FILE` source answers `Esa descarga no es un torrent` with no
      request reaching qBittorrent (`docker compose logs torrent`).

- [ ] **T007** `[api]` Add the race arbiter to `DownloadsService.handleTorrentCompleted`: a new rung
      **before** the existing `ERROR` rung that ignores a completion whose target already has a
      `READY`/`SCANNED` sibling (REQ-13), and, on the success path after the existing transaction,
      stop every other non-terminal sibling in the client and move it to `PAUSED` — leaving the
      winner running so it keeps seeding (REQ-12). Siblings are selected by
      `movieId`/`episodeId`/`seasonId`, never by tag (REQ-14). Keep the module's style: return a
      string, never throw, log with the `[torrentCompleted]` prefix. → T002, T003
      *Done when:* with two racing downloads, completing one leaves the winner seeding in
      qBittorrent, the other stopped, and its row at `status = 'PAUSED'` — **not** `ERROR`; and
      firing `torrentCompleted` with the loser's hash afterwards changes nothing and enqueues no
      second `bull:process`.

- [ ] **T008** `[api]` Extend `ProcessJobsService.downloadRemove` to sweep the losers after the
      winner's `torrentClient.remove`: select siblings by target, remove them from the client **with**
      their files, then `deleteMany` those rows (REQ-15). Its signature, its `!mediaSource.infoHash`
      early return and its `omitido: …` string are unchanged — the worker calls this and is not in
      `services:`. → T002, T003
      *Done when:* after the winner's encode completes, both torrents are gone from qBittorrent, the
      loser's `media_sources` row is gone and its download folder is gone from disk; and with an
      encode forced to fail, the losers stay `PAUSED` with rows and files intact.

- [ ] **T009** `[api]` Write the two Article IX suites named in `spec.md` NFR-5, each opening with a
      comment stating its failure class, each case built by fault injection (verify it fails when the
      rule is removed). New `src/downloads/downloads.service.spec.ts` — a second source of one target
      must never reach `ENCODING`, the winner must not be stopped with its siblings, a paused loser
      must land on `PAUSED` and not `ERROR`. Extend `src/process-jobs/process-jobs.service.spec.ts` —
      the sweep must select by target id and not by tag, and must not swap the winner's
      `deleteFiles: false` for the losers' `true`. → T007, T008
      *Done when:* `bin/npm api test` is green at its previous count plus the new cases, and removing
      either guard makes a named case fail.

### Group 3 — the consumer

All `[web]`, and the whole group is blocked on Group 2. This is not caution: `web` sending `force`
to a mutation that no longer accepts it is a GraphQL validation error on every acquisition, not a
type error, so there is no safe overlap.

- [ ] **T010** `[web]` Add `src/types/downloads.ts` (the hand-retyped `Download`, field names copied
      from `../spec.md`, not guessed from `api`'s source) and `src/actions/downloads.ts` with the two
      reads and three mutations, following `src/actions/media-server.ts`. The reads run during a
      render pass and use `redirectToClearSession`; the mutations are called from a client component
      and use `redirectIfUnauthenticated` — re-derive this per call site, do not copy the nearest
      example. → T006
      *Done when:* `bin/cli web npx --no tsc --noEmit` reports no new errors and a `movieDownloads`
      call from a page returns rows.

- [ ] **T011** `[web] [P]` Delete the conflict flow: drop `force` from `importMagnetAction`
      (`actions/imports.ts`), `addTorrentToMovieAction` (`actions/indexer.ts`) and both episode
      actions (`actions/shows.ts`); remove `CONFLICT_MESSAGE`, `needsConfirm` and the "Reemplazar"
      relabel from `components/import/importMagnetModal.tsx` and
      `components/search/SearchTorrent.tsx`. → T005
      *Done when:* `grep -rn "force" services/web/src/actions/` and
      `grep -rn "ya tiene una descarga en curso" services/web/src` are both empty, and a magnet
      import still succeeds end to end.

- [ ] **T012** `[web]` Build `components/downloads/DownloadsPanel.tsx` (rows, percent and speed
      columns, status pill following `SeasonAccordion.tsx:13-24`'s `statusBadgeClass`, a refresh
      control calling `router.refresh()`, force-start / stop / delete buttons) and
      `components/downloads/DeleteDownloadModal.tsx` on the existing `Modal` + `useModal`. No
      polling. `progress` arrives 0..100 — do not multiply again. Null `torrentState` / `progress` /
      `downloadSpeed` render as information, never as a loading or error state. Spanish literals at
      the render site; no `next-intl` (NFR-3). → T010
      *Done when:* the panel renders both racing downloads with percent and speed; delete opens a
      confirmation whose cancel leaves the torrent in place and whose confirm removes torrent and
      files; a torrent still in `metaDL` renders as downloading with an empty `root_path`, not as an
      error row.

- [ ] **T013** `[web]` Wire the panel into `app/(dashboard)/movies/[id]/page.tsx` and
      `app/(dashboard)/shows/[id]/page.tsx`, joining the existing `Promise.all` rather than adding a
      waterfall. The show's list covers the whole series — season packs and single episodes — each
      row naming its target. → T012
      *Done when:* `/movies/<id>` and `/shows/<id>` both render the panel; clicking refresh moves the
      percentage on an active row; with `docker compose stop torrent` the page still renders with the
      percent and speed columns empty rather than returning a 500; `bin/npm web run build` exits 0.

### Group 4 — verification and docs

- [ ] **T014** `[docs] [P]` Add a `### …(022-download-status-tags)` subsection to
      `docs/spec/graphql-contract.md` in the house style: the SDL delta, the notes the SDL cannot
      carry (`downloadDelete` vs `downloadRemove`, `progress` 0..100 at the boundary but 0..1 in the
      adapter, `downloadRemove`'s unchanged signature with grown behaviour, the retired `force`), and
      a `Consumer obligations:` paragraph recording `worker`'s explicit **no obligation**. → T013
      *Done when:* the section exists and its SDL matches `src/schema.gql`.

- [ ] **T015** `[docs] [P]` Update the affected `CLAUDE.md` files: the root pipeline table
      (**Download** stops being fire-and-forget; **Detect completion, enqueue** gains a race
      arbiter), the root **Known debt** entry on `movieId` (narrowed, not resolved — `MediaSource.movieId`
      is now a real column with unchanged name and meaning), `services/api/CLAUDE.md`'s module map
      (`downloads/` grew a user-facing surface; the `attachTorrentSource` triplication no longer
      mentions `force`; `clients/torrent/` gained methods) and `services/web/CLAUDE.md` if the
      component map changed. → T013
      *Done when:* no `CLAUDE.md` still describes `force`, the one-active-source rule or
      `Movie.mediaSourceId` as current behaviour.

- [ ] **T016** `[docs]` Walk all 20 acceptance criteria in `spec.md` — including the six failure
      paths and the AC-18 regression pass (release search, magnet import, episode acquisition and a
      full tus upload, all with `force` gone) — tick each box, and set `status: Implemented` on
      `spec.md`, `plan.md`, `api/plan.md` and `web/plan.md`. Run the closing greps from
      `plan.md` § Verification: `force` in `services/web/src/actions/`, `mediaSourceId` across both
      consumers, and `@prisma/client` in `services/web/src services/worker/src`. → T014, T015
      *Done when:* every AC box is ticked or explicitly annotated with why it was not re-exercised
      live, all four files read `status: Implemented`, and the three greps come back clean.

## Blocked

| Task | Service | What blocked it | Needs |
| :-- | :-- | :-- | :-- |

Contract problems always land here (Constitution, Article VIII): an agent that finds the GraphQL
delta or the torrent-client interface delta wrong stops and reports, it does not amend either from
inside its slice.
