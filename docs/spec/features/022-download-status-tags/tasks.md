---
title: Download Status and Torrent Tags — Tasks
last_updated: 2026-08-27
status: Done            # Draft | In Progress | Done
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

- [x] **T001** `[api]` Invert the `Movie` ↔ `MediaSource` relation in `prisma/schema.prisma`: add
      `movieId Int?` plus its `movie Movie?` relation to `MediaSource`, mirroring `episodeId` /
      `seasonId`; remove `mediaSourceId` and `mediaSource` from `Movie`. Generate the migration with
      `bin/npm api run prisma:migrate` — never hand-written SQL (Article III). No backfill
      (`spec.md` NFR-8).
      *Done when:* `git status services/api/prisma/` shows **both** a modified `schema.prisma` and a
      new migration directory, and `bin/mysql -e "describe media_sources"` lists a `movie_id`
      column while `bin/mysql -e "describe movies"` no longer lists `media_source_id`.

- [x] **T002** `[api]` Fix every reader of the relation T001 removed: `movies.service.ts` (the
      `include: { mediaSource: true }` at :58 and :72, and the conflict/write at :291, :295, :360),
      `movies/entities/movies.entity.ts:37`, `movies/dto/create-movie.dto.ts:47`,
      `uploads.service.ts:212` and `:232`, and `media-sources.service.ts:14-23` — where
      `findOneFlat` stops deriving `movieId` from `mediaSource.movie?.id` and reads the column.
      That last one is the field the **worker** selects: same name, same type, same nullability.
      → T001
      *Done when:* `bin/cli api npx --no tsc --noEmit` reports 0 errors, and
      `grep -rn "mediaSourceId" services/api/src` returns no hit that refers to the dropped column.

- [x] **T003** `[api]` Extend `clients/torrent/types.ts` and `clients/torrent/client.ts` per
      `../spec.md` § The torrent client interface: `add(urls, tags?)` sending qBittorrent's inline
      `tags`, `info(tag?)` filtering server-side and returning `progress` / `dlspeed` / `tags`, and
      a new `start()` beside the existing `stop`/`remove`. **No `forceStart` and no `forceStarted`** —
      force start is out of scope (`../spec.md` § Out of Scope) and an interface member with no
      caller is the condition `info()` was in before this feature. Bring `mapTorrentState`'s sets to
      qBittorrent 5.0 (`stoppedDL`, `stoppedUP`, `forcedMetaDL` at minimum — `forcedDL`/`forcedMetaDL`
      must be *recognised* even though nothing here sets the flag, since the user can set it in
      qBittorrent directly) and stop the fallthrough laundering an unrecognised state into `ERROR`
      (NFR-7). Add the `response.ok` check to every method, following `add()`'s existing one and its
      comment (NFR-6). `root_path` stays. → T001
      *Done when:* `bin/cli api npx --no tsc --noEmit` reports 0 errors, and a live
      `bin/cli api node -e` call to `info()` returns rows whose `state` reads `PAUSED` for a
      `stoppedDL` torrent and `DOWNLOADING` for a `forcedMetaDL` one — neither as `ERROR`.

### Group 2 — acquisition, the downloads surface and the race

All `[api]`. Ordered by dependency rather than by file; several are small.

- [x] **T004** `[api]` Build the tag list per acquisition path and pass it into `qbittorrent.add()`:
      the film's title for a movie, `<Show title>` + `Season <n>` + `Episode <n>` for an episode,
      `<Show title>` + `Season <n>` for a season pack — English keywords, unpadded numbers (REQ-1 to
      REQ-3). Apply REQ-5's sanitisation: commas to spaces, whitespace collapsed, trimmed, with a
      non-empty id-derived fallback. Follow the existing deliberate duplication across `movies/`,
      `episodes/` and `seasons/` — do not extract a shared helper. → T003
      *Done when:* adding a release to a film shows exactly one tag in qBittorrent's sidebar, an
      episode shows three and a season pack two; a film whose title contains a comma yields **one**
      tag, not two.

- [x] **T005** `[api]` Narrow the seven conflict guards so only a **`COMPLETED`** target refuses
      (REQ-7): `movies.service.ts:304`, `episodes.service.ts:92`, `seasons.service.ts:75`,
      `uploads.resolver.ts:60` and `:78`, `uploads.service.ts:209` and `:247`. Each is already a
      ternary on the target's status — change the *condition* and drop the
      `…_DOWNLOAD_IN_PROGRESS` half, then delete those three keys from `src/i18n/error-keys.ts` and
      both `messages.{en,es}.ts`. The film's guard becomes `movie.status === 'COMPLETED' &&
      !input.force`, which also sheds its dependence on the column T001 dropped.
      **`force`, the `@Args('force', …)`, the three `…_ALREADY_COMPLETED` keys, the `updateMany`
      demote-to-`ERROR` blocks and everything in `upload-tickets.service.ts` stay untouched** — that
      is `027-replace-completed-media` and removing it silently re-enables overwriting a finished
      film. Every cross-title `infoHash` collision check stays as it is. Update the two suites that
      assert the removed message (`episodes.service.spec.ts:152`, `seasons.service.spec.ts:143`) to
      assert the guard no longer fires for a downloading target, rather than deleting the cases.
      → T002
      *Done when:* `grep -rn "DOWNLOAD_IN_PROGRESS\|download_in_progress" services/api/src` is empty
      while `grep -rn "ALREADY_COMPLETED" services/api/src` is unchanged; sending two different
      releases to one film succeeds twice with `bin/mysql -e "select id, status, info_hash, movie_id
      from media_sources where movie_id = <id>"` showing two non-`ERROR` rows; and starting an upload
      against a `COMPLETED` film **still** answers `MOVIE_ALREADY_COMPLETED` without `force`.

- [x] **T006** `[api]` Add the `downloads/` read and control surface: `entities/download.entity.ts`,
      the `movieDownloads` / `showDownloads` queries and the `downloadStart` / `downloadStop` /
      `downloadDelete` mutations, wired in `downloads.module.ts`. Rows come from `media_sources`
      scoped by the caller's ownership clause written locally (see `../api/plan.md` § Existing code
      to reuse — do **not** import `MoviesService`/`ShowsService`), joined to one `info(tag)` call on
      `infoHash`; `progress` is ×100 here, not in the adapter. The list includes sources with **no**
      `infoHash` — a `LOCAL_FILE` upload racing alongside the torrents (REQ-18) — which carry a null
      `infoHash`, their `kind`, and null live fields; the three mutations still refuse them with
      `DOWNLOAD_NOT_A_TORRENT` before any client call. A torrent absent from the client
      yields null live fields and is never dropped from the list. No `@AllowService()`.
      → T002, T003
      *Done when:* the regenerated `src/schema.gql` diff matches `../spec.md` § GraphQL Contract
      Delta exactly, including `infoHash: String` nullable and `kind: String!`; `movieDownloads` for
      another user's film answers `La película <id> no existe`; `downloadStart` on a `LOCAL_FILE`
      source answers `DOWNLOAD_NOT_A_TORRENT` with no request reaching qBittorrent
      (`docker compose logs torrent`), while that same source **is** returned by `movieDownloads`.

- [x] **T007** `[api]` Add the race arbiter as **one shared method** on `DownloadsService` — not
      inline in `handleTorrentCompleted`, because `UploadsService` calls the same logic in T008 and
      two copies would drift silently (`../plan.md` § Approach). Given a winning `mediaSourceId`: if
      any *other* source of the same target is already `READY`/`SCANNED`, report "ignored" and change
      nothing (REQ-13); otherwise stop every other non-terminal sibling in the client and move it to
      `PAUSED`, leaving the winner running so it keeps seeding (REQ-12). Siblings are selected by
      `movieId`/`episodeId`/`seasonId`, never by tag (REQ-14). Call it from `handleTorrentCompleted`
      after the self-idempotency rung and before the `ERROR` rung, keeping that method's style:
      return a string, never throw, log with the `[torrentCompleted]` prefix. → T002, T003
      *Done when:* with two racing downloads, completing one leaves the winner seeding in
      qBittorrent, the other stopped, and its row at `status = 'PAUSED'` — **not** `ERROR`; and
      firing `torrentCompleted` with the loser's hash afterwards changes nothing and enqueues no
      second `bull:process`.

- [x] **T008** `[api]` Wire the tus upload path into the same arbiter (REQ-19). In
      `uploads.service.ts`'s `onUploadFinish`, call T007's method before moving the target to
      `ENCODING` and enqueuing `bull:process`; if it reports "ignored", finish the upload without
      touching the target's status and without enqueuing. Check `uploads.module.ts` for the import
      rather than assuming it is there. Do not reimplement the guard or the pause locally.
      → T006, T007
      *Done when:* uploading a file to a film with two torrents in flight succeeds with no 409, and
      once its encode completes both torrents are stopped and then removed; uploading to a film whose
      torrent already reached `READY` leaves the film's status untouched and enqueues no
      `bull:process` job.

- [x] **T009** `[api]` Extend `ProcessJobsService.downloadRemove` to sweep the losers: select
      siblings by target, remove them from the client **with** their files, then `deleteMany` those
      rows (REQ-15). Its signature, its `omitido: …` string and its return type are unchanged — the
      worker calls this and is not in `services:` — but its `!mediaSource.infoHash` early return
      **must no longer short-circuit the sweep**: under REQ-19 the winner can be an upload, and a
      sweep placed after `torrentClient.remove` would leave every losing torrent running forever
      with nothing in any log (`../spec.md` NFR-5 (c)). Only the winner's own `remove` is skipped.
      → T002, T003
      *Done when:* after the winner's encode completes, both torrents are gone from qBittorrent, the
      loser's `media_sources` row is gone and its download folder is gone from disk — and the same
      holds when the winner is a `LOCAL_FILE` upload; with an encode forced to fail, the losers stay
      `PAUSED` with rows and files intact.

- [x] **T010** `[api]` Write the three Article IX suites named in `spec.md` NFR-5, each opening with
      a comment stating its failure class, each case built by fault injection (verify it fails when
      the rule is removed). New `src/downloads/downloads.service.spec.ts` — a second source of one
      target must never reach `ENCODING`, the winner must not be stopped with its siblings, a paused
      loser must land on `PAUSED` and not `ERROR`; cover the arbiter once and drive the upload entry
      point through it rather than writing a second near-identical suite. Extend
      `src/process-jobs/process-jobs.service.spec.ts` — the sweep must select by target id and not by
      tag, must not swap the winner's `deleteFiles: false` for the losers' `true`, and must still run
      when the winner is a `LOCAL_FILE` source (restore the early return in front of it and that case
      must fail). → T007, T008, T009
      *Done when:* `bin/npm api test` is green at its previous count plus the new cases, and removing
      any of the three guards makes a named case fail.

### Group 3 — the consumer

All `[web]`, and the whole group is blocked on Group 2. This is not caution: `web` sending `force`
to a mutation that no longer accepts it is a GraphQL validation error on every acquisition, not a
type error, so there is no safe overlap.

- [x] **T011** `[web]` Add `src/types/downloads.ts` (the hand-retyped `Download`, field names copied
      from `../spec.md`, not guessed from `api`'s source — note `infoHash` is **nullable**) and
      `src/actions/downloads.ts` with the two reads and three mutations, following
      `src/actions/media-server.ts`. The reads run during a render pass and use
      `redirectToClearSession`; the mutations are called from a client component and use
      `redirectIfUnauthenticated` — re-derive this per call site, do not copy the nearest example.
      → T006
      *Done when:* `bin/cli web npx --no tsc --noEmit` reports no new errors and a `movieDownloads`
      call from a page returns rows.

- [x] **T012** `[web] [P]` Retire the three `…_DOWNLOAD_IN_PROGRESS` keys: drop them from the key
      arrays in `components/import/importMagnetModal.tsx` (lines 30-32) and
      `components/search/SearchTorrent.tsx` (lines 31-33), and from `messages/en.json` and
      `messages/es.json`. **Leave `…_ALREADY_COMPLETED`, `needsConfirm`, the "Reemplazar" relabel
      and every `force` argument in `actions/` alone** — that is `027`'s completed-title flow.
      `components/import/importFileModal.tsx` needs no change: its missing confirm button for a
      downloading target stops mattering once `api` stops raising the message. → T005
      *Done when:* `grep -rn "download_in_progress" services/web/src services/web/messages` is empty
      while `grep -rn "already_completed" services/web/src services/web/messages` is unchanged; a
      magnet import still succeeds end to end; uploading a file to a film with a torrent in flight
      shows **no** message and starts uploading; and replacing a `COMPLETED` film still asks first.

- [x] **T013** `[web]` Build `components/downloads/DownloadsPanel.tsx` (rows, percent and speed
      columns, status pill following `SeasonAccordion.tsx:13-24`'s `statusBadgeClass`, a refresh
      control calling `router.refresh()`, **start / stop / delete** buttons — no force-start, it is
      out of scope) and `components/downloads/DeleteDownloadModal.tsx` on the existing `Modal` +
      `useModal`. Gate the three buttons on **`infoHash != null`**: not on `kind`, since `SourceKind`
      has two torrent values and nothing checks a hand-retyped literal, and not on `progress`, since
      a torrent that vanished from qBittorrent has a null `progress` and still needs its delete
      button. No polling. `progress` arrives 0..100 — do not multiply again. Null `torrentState` /
      `progress` / `downloadSpeed` render as information, never as a loading or error state. Every
      string is a catalog key in `messages/{en,es}.json` read through `useTranslations` — `018` is
      implemented, so no hardcoded literal at a render site (NFR-3). → T011
      *Done when:* the panel renders both racing downloads with percent and speed; an uploaded
      `LOCAL_FILE` row appears with its status and **no** action buttons; delete opens a confirmation
      whose cancel leaves the torrent in place and whose confirm removes torrent and files; a torrent
      still in `metaDL` renders as downloading with an empty `root_path`, not as an error row.

- [x] **T014** `[web]` Wire the panel into `app/(dashboard)/movies/[id]/page.tsx` and
      `app/(dashboard)/shows/[id]/page.tsx`, joining the existing `Promise.all` rather than adding a
      waterfall. The show's list covers the whole series — season packs and single episodes — each
      row naming its target. → T013
      *Done when:* `/movies/<id>` and `/shows/<id>` both render the panel; clicking refresh moves the
      percentage on an active row; with `docker compose stop torrent` the page still renders with the
      percent and speed columns empty rather than returning a 500; `bin/npm web run build` exits 0.

### Group 4 — verification and docs

- [x] **T015** `[docs] [P]` Add a `### …(022-download-status-tags)` subsection to
      `docs/spec/graphql-contract.md` in the house style: the SDL delta, the notes the SDL cannot
      carry (`downloadDelete` vs `downloadRemove`, `progress` 0..100 at the boundary but 0..1 in the
      adapter, `downloadRemove`'s unchanged signature with grown behaviour, nullable `infoHash` as
      the controllability test, the retired `force`), and a `Consumer obligations:` paragraph
      recording `worker`'s explicit **no obligation**. → T014
      *Done when:* the section exists and its SDL matches `src/schema.gql`.

- [x] **T016** `[docs] [P]` Update the affected `CLAUDE.md` files: the root pipeline table
      (**Download** stops being fire-and-forget; **Detect completion, enqueue** gains a race
      arbiter that the tus upload route also enters), the root **Known debt** entry on `movieId`
      (narrowed, not resolved — `MediaSource.movieId` is now a real column with unchanged name and
      meaning), `services/api/CLAUDE.md`'s module map (`downloads/` grew a user-facing surface and a
      shared arbiter `uploads/` calls; the `attachTorrentSource` triplication no longer mentions
      `force`; `clients/torrent/` gained methods) and `services/web/CLAUDE.md` if the component map
      changed. → T014
      *Done when:* no `CLAUDE.md` still describes `force`, the one-active-source rule or
      `Movie.mediaSourceId` as current behaviour.

- [x] **T017** `[docs]` Walk all 23 acceptance criteria in `spec.md` — including the seven failure
      paths, the AC-18 regression pass (release search, magnet import, episode acquisition and a full
      tus upload) and **AC-23**, `027`'s completed-title replacement, which must still refuse without
      confirmation and still succeed with it — tick each box, and set `status: Implemented` on
      `spec.md`, `plan.md`, `api/plan.md` and `web/plan.md`. Run the closing greps from
      `plan.md` § Verification: `download_in_progress` (must be empty), `already_completed` (must be
      unchanged), `mediaSourceId` across both consumers, and `@prisma/client` in
      `services/web/src services/worker/src`. → T015, T016
      *Done when:* every AC box is ticked or explicitly annotated with why it was not re-exercised
      live, all four files read `status: Implemented`, and each grep gives the stated result.

## Blocked

| Task | Service | What blocked it | Needs |
| :-- | :-- | :-- | :-- |

Contract problems always land here (Constitution, Article VIII): an agent that finds the GraphQL
delta or the torrent-client interface delta wrong stops and reports, it does not amend either from
inside its slice.
