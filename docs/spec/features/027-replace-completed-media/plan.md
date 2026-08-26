---
title: Replace a completed media — Implementation Plan
spec_version: 0.1.0
last_updated: 2026-08-26
status: Approved
---

# PLAN: Replace a completed media (`plan.md`)

## Approach

Most of this feature already exists and is not reachable. The `force` flag on
`addTorrentToMovie` / `addMagnetToMovie` / `addTorrentToEpisode` / `addMagnetToEpisode` /
`addMagnetToSeason` already skips the conflict guard, and `EpisodesService.attachTorrentSource` /
`SeasonsService.attachTorrentSource` already demote the superseded `MediaSource` to `ERROR` with
`error.source.replaced`, which is what makes a late `torrentCompleted` inert (`DownloadsService`
explicitly ignores `ERROR` rows). So the plan **extends three existing seams** rather than opening
new ones:

1. **The conflict guard becomes two-valued.** Each `attachTorrentSource` already asks "is there an
   active source?". It now also asks "is the target `COMPLETED`?" and picks between the existing
   `error.*.download_in_progress` key and a new `error.*.already_completed` one. Same throw site,
   same `i18nError.conflict` factory (`services/api/src/i18n/i18n-error.ts`), one extra branch.
2. **The upload path gets the `force` the other five already have**, and — because `onUploadFinish`
   discovering a conflict after a multi-gigabyte upload is the concrete complaint this feature
   answers — the check moves forward to `createUploadTicket`. The decision is minted at ticket time
   and recovered at finish time from Redis, keyed by the tus upload id, written by `onUploadCreate`
   right after `UploadTicketsService.verifyAndSpend` succeeds. Redis is already this service's
   store for the ticket spend record, so no new dependency.
3. **The old library file needs nothing at all**, which is why `worker` is not in this feature.
   `buildOutputPath` is a pure function of the media row and the configured root, so a replacement
   of the same film or episode resolves to the identical path; `ffmpeg/runner.ts` muxes into
   `<final>.part.mkv` beside the destination and ends with `rename(partPath, output)`, a POSIX
   rename between siblings that replaces an existing destination atomically. The overwrite *is* the
   deletion, and it is safer than an explicit one: there is no window in which the library holds
   nothing, which satisfies REQ-8 and REQ-10 for free.

**Three alternatives were live and rejected.**

*Carrying the replace decision in tus metadata* instead of Redis was rejected because the browser
authors that metadata: a client that sends `replace: "true"` would be forging a decision `api`
never made, and the failure is silent — a good library file destroyed, no error anywhere. Stamping
it server-side through `onUploadCreate`'s metadata return value would work, but it makes a
correctness property depend on `@tus/server` overwrite semantics rather than on code this
repository owns and tests. Redis is explicit, absent-means-`false`, and testable next to the
existing spend record.

*Deleting the old file at confirmation time* was rejected by the spec (§ Context): a replacement
that fails would leave the user with nothing.

*An explicit stale-output deletion* — an `EncodeCompletedResult.staleOutputPath` field computed by
`api` and executed by `worker` — was specified in full and then removed. Point 3 above is why it was
almost always a no-op, and § Risks records what it cost. `spec.md` § Out of Scope names the three
narrow cases where an orphan can now survive, and why each is a nuisance rather than data loss. This
is the change that took `worker` out of `services:` altogether.

**What is reused, by path:**

- `services/api/src/i18n/{error-keys.ts,messages.en.ts,i18n-error.ts}` — the keyed-error factory;
  three new constants, no new mechanism.
- `services/api/src/uploads/upload-tickets.service.ts` — `mint`/`verifyAndSpend` and its Redis usage.
- `services/web/src/lib/graphql-error.ts` — `translateGraphQLError` and its `extensions.i18n` shape.
- `services/web/src/types/media.ts`'s `AcquisitionTarget` — already carries the `Movie`/`Episode`
  with its `status`, so `web` knows the target is `COMPLETED` without a round trip and can show the
  warning **before** the first call.

## Order of Work

| Step | Service | Why it must come here |
| :-- | :-- | :-- |
| 1 | `api` | Owns the three new error keys and the `createUploadTicket` argument. Nothing `web` writes is observable until this exists. |
| 2 | `web` | Consumes the new keys and `createUploadTicket(force:)`. |
| 3 | `[orch]` | End-to-end manual pass (§ Verification), which needs both. |

**Nothing runs in parallel here** — with `worker` out of the feature there are only two slices, and
the second consumes the first. `web` *can* be written ahead of `api` against the frozen delta, since
it retypes the schema by hand anyway, but it cannot be verified until `api` is running, so there is
no real overlap to schedule.

`services/worker/` must not be touched by this feature (`spec.md` NFR-3, AC-12). A task that opens a
file under it is a signal the stale-output deletion crept back in; stop and report instead.

## Contract Freeze

The `## GraphQL Contract Delta` in `spec.md` is frozen as of `status: Approved`. Four things an
implementer will be tempted to change, and must not:

- **Nothing deletes a library file.** The old encode is destroyed by the replacement's own atomic
  `rename`, and that is the entire mechanism (`spec.md` REQ-9/NFR-3). An earlier draft of this plan
  carried an `EncodeCompletedResult.staleOutputPath` field and a guarded deletion in `worker`; it
  was removed because the path essentially never moves, and because a mis-anchored relative path
  would have deleted a different healthy title with nothing failing anywhere. If an orphan turns up
  in testing, report it — do not add the deletion back inside a slice.
- **`createUploadTicket` performs the conflict check.** From inside `uploads/` it looks like
  duplication — `onUploadFinish` already checks. It is not duplication, it is the only check that
  runs before the user spends twenty minutes uploading (REQ-6). `onUploadFinish` keeps its own
  check for the mid-upload race and must not be weakened.
- **The replace decision is not read from tus metadata.** `onUploadFinish` must read it from the
  Redis marker written by `onUploadCreate`, never from `upload.metadata`. A metadata key the
  browser can set is a forged authorisation (REQ-7).
- **The five `add*` mutations keep their existing signatures.** All of them already have
  `force: Boolean = false`. Do not add a second argument, do not rename `force` to `replace`, and
  do not split the mutation in two — only the *error* they answer with changes.

If the delta turns out to be wrong: stop, amend `spec.md`, re-approve, re-brief both services.
Never patch it from inside one slice (Article VIII).

## Migrations

None. This feature adds no Prisma model, field, enum value or migration (NFR-1), and writes no new
column value — `movies.file_path` / `episodes.file_path` keep being written by `encodeCompleted`
exactly as they are today.

Reversibility: reverting the two services restores today's behaviour exactly. No row written by
this feature has a shape an older build cannot read.

## Risks

| Risk | How it fails | Mitigation |
| :-- | :-- | :-- |
| An explicit stale-output deletion creeps back in | A relative path anchored to the wrong root, joined onto a valid `outputRoot`, passes `isInsideRoot` and deletes a **different, healthy** title. No error anywhere; the user loses a film they never touched. This was the worst failure mode in the earlier three-service design, and removing the mechanism removed it entirely. | The feature adds no deletion at all (`spec.md` NFR-3). `services/worker/` is out of `services:` and must stay untouched; AC-12 greps the diff for `rm`/`unlink`/`rename` against a library path. |
| An orphan survives when the output path genuinely moved | The library shows two files for one episode and the media server lists a duplicate. Visible to the user, and only reachable through the three narrow cases in `spec.md` § Out of Scope. | Accepted, deliberately. It is a nuisance, not data loss, and it is the price of not carrying a deletion that could take the wrong file. Whoever hits it in practice has the use case in hand to spec the cleanup properly (Article X). |
| A forged `replace` decision from the browser | A client sets a metadata key, `onUploadFinish` believes it, and a `COMPLETED` film's source is replaced without the user ever seeing the warning. Succeeds silently — it looks exactly like a legitimate replacement. | The decision lives only in the Redis marker `onUploadCreate` writes after `verifyAndSpend`. `upload-tickets.service.spec.ts` covers that a `force: false` ticket cannot produce a `true` decision whatever the metadata says. |
| The Redis marker expires under a long paused upload | `onUploadFinish` falls back to "no replace" and answers `409` after the upload completed. Loud, not silent — the user is told, and can retry. | Deliberate fail-**closed**. Do not invert it: failing open would delete a library file on a decision nobody can prove was made. TTL is a named constant, not a literal. |
| `web` shows the wrong warning because it read a stale `status` | The user is told "this will replace the current file" for a title that is merely downloading, or worse, is shown the mild in-progress copy for a `COMPLETED` one and destroys a good file without a clear warning. | `web`'s client-side `status` read is an *affordance*; `api`'s key is authoritative and re-renders the correct copy on the refusal. REQ-11 makes that branch key-based, so the two can never disagree because of a locale. |
| Substring matching survives somewhere | Today's `message.includes(t("conflictMarker"))` already fails in `es` — the api sends English, the marker is Spanish, so the "Reemplazar" button never appears. Left in place for one flow, it fails identically for that flow, in one locale, with nothing thrown. | Every `conflictMarker` occurrence is deleted from `SearchTorrent.tsx`, `importMagnetModal.tsx` and both catalogs. `scripts/check-messages.mjs` enforces catalog parity for the keys that replace it. |
| An implementer "fixes" the film path's missing demotion | `MoviesService.attachTorrentSource` does not demote the superseded source to `ERROR`, unlike its episode/season twins, and it looks like an oversight. | It is not in scope and needs no fix: a `COMPLETED` film's old source is `SCANNED`, which `DownloadsService.handleTorrentCompleted` already short-circuits as "ya procesado", and its torrent was already removed by the first encode's `removeTorrent`. Adding the demotion here would be unrequested behaviour change in a feature that ships none. Leave it. |

## Verification

```bash
bin/cli api npx --no tsc --noEmit
bin/npm api test
bin/cli web npx --no tsc --noEmit
bin/npm web run build
bin/cli web node scripts/check-messages.mjs
```

`bin/npm web run lint` is not a gate for this service (`services/web/CLAUDE.md` § Current state) —
run Biome on the touched files only.

Then the manual pass, which is where the acceptance criteria are actually reached:

1. Pick a film in `COMPLETED`. `bin/mysql -e 'select id, status, file_path from movies where status="COMPLETED" limit 5'` — note the id and path, and confirm the file exists with `bin/cli worker ls -l '<path>'`.
2. Open `/movies/<id>`, click **Magnet**, paste a magnet. The warning appears naming the file to be
   replaced, and the submit button reads *Reemplazar* — **AC-1**. Confirm, then re-run the query:
   `status` is `DOWNLOADING`, `file_path` is unchanged, and the file is still on disk — **AC-2**.
3. Cancel that torrent in qBittorrent (or hand it a magnet that resolves to no video). The film
   lands in `ERROR`, `file_path` unchanged, file still on disk and still playable — **AC-3**.
4. Repeat with a magnet that completes. Note the file's size and mtime before starting
   (`bin/cli worker ls -l '<path>'`). When the encode finishes, the title's library folder holds
   **exactly one** file, at the same path, with a different size or mtime — the atomic `rename`
   overwrote it in place — **AC-4**.
5. For **AC-5**, take the library root's state before the replacement
   (`bin/cli worker find '<library root>' -type f | sort > /tmp/before`) and after, and diff. The
   only difference must be that one file's timestamp; nothing else created, moved or removed.
6. Click **File** on the same `COMPLETED` film. The warning appears *before* the file picker does
   anything, and the network tab shows the `createUploadTicket` refusal carrying
   `error.movie.already_completed` with no upload started — **AC-6**. Confirm, pick a file, and the
   upload runs to completion — **AC-7**.
7. Switch the UI language to Spanish (`/settings` → profile) and repeat step 2. Every string is
   Spanish and the confirm control still appears — **AC-9**, the case that is broken today.
8. For **AC-8**, mint a ticket for a film that is *not* busy, start the upload, and — while it runs —
   attach a magnet to that same film from another tab. The upload must be refused at
   `onUploadFinish` with a `409` and the staged file must not be adopted; the Redis marker for that
   upload id says no replacement was authorised:
   `bin/cli redis redis-cli get "upload:replace:<uploadId>"` returns nil.
9. For **AC-10**, call `addMagnetToSeason` from the GraphQL playground against a season with
   `COMPLETED` episodes, first without `force` (expect `error.season.already_completed`), then with.
10. For **AC-12**: `git diff --stat` shows no file under `services/worker/`, and
    `git diff -U0 | grep -nE '\b(rm|unlink|rename)\('` returns nothing.
