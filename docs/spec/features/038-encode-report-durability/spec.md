---
title: Encode Report Durability
spec_version: 0.1.0
author: Juan "Dientuki" Farias
created_at: 2026-09-01
last_updated: 2026-09-01
status: Approved
services: [api, web, worker]
---

# SPEC: Encode Report Durability (`spec.md`)

## Context & Goal

On 2026-09-01 an encode of Chernobyl S01E05 finished perfectly: FFmpeg ran, mkvmerge muxed, and the
final file landed at its destination in the library with no `.part` left behind. Microseconds later
the worker called the `encodeCompleted` mutation and got `ECONNREFUSED 172.18.0.8:4000`, because the
`api` container happened to be restarting. That rejection propagated out of the `try` block in
`services/worker/src/jobs/encode.job.ts`, so the `catch` — which exists to report a *failed encode* —
treated a completed one as a failure and tried to send `encodeFailed`. That call failed with the same
`ECONNREFUSED`, was swallowed by its own `.catch(console.error)`, and the job died having told the
database nothing at all. `process_jobs.67` is still `ENCODING` at 99% with a null `outputFilePath`,
`episodes.120` is still `ENCODING`, and the file it produced has been sitting playable in the library
ever since. Neither BullMQ queue configures `attempts`, so nothing retried.

That is the first half. The second half is what happened when the user tried to fix it by hand.
Because the wedged source (`media_sources.98`) sits in `SCANNED`, `DownloadsService.resolveRace`
(`services/api/src/downloads/downloads.service.ts:298-310`) reads the episode as already having a
winner. The user re-uploaded the same episode twice; both uploads completed, both created rows
(`102`, `107`) in `READY`, and both hit the `raceResult.startsWith('ignorado')` early return in
`UploadsService.handleUploadFinish` (`services/api/src/uploads/uploads.service.ts:236-240`) — never
setting the episode to `ENCODING`, never enqueuing `bull:process`. The only trace of either is a
`console.log` on the server. From the browser the upload succeeded and then nothing happened, twice,
with no error anywhere. A user with no shell access has no way out of that state.

This feature closes both holes at their source. The worker stops conflating "the encode failed" with
"I could not tell anyone the encode succeeded", and holds the report until `api` acknowledges it —
deliberately blocking the encode queue while `api` is unreachable, since a worker that cannot reach
`api` cannot meaningfully start the next job either. And an upload stops being a polite competitor:
a file a human deliberately handed us always wins its target's race, demoting whatever finished
before it, because an explicit upload is a statement of intent and not a coincidence of timing. No
pipeline stage is added or removed; the Transcode and Download stages in the root `CLAUDE.md` table
keep their shape and change their failure behaviour.

## Requirements

### Functional Requirements

- [ ] **REQ-1 (Success is never reported as failure)**: A failure to *deliver* the completion report
      must never be recorded as an encode failure. Once FFmpeg (or the passthrough move) has
      produced the output file, no subsequent transport problem may result in `encodeFailed` being
      sent for that job, or in the job, its title, or its source reaching `ERROR`.
- [ ] **REQ-2 (Report until acknowledged)**: When the outcome of a finished job cannot be delivered
      because `api` is unreachable, the worker must keep attempting delivery until `api`
      acknowledges it. This applies to both outcomes: a completed encode and a genuinely failed one.
      No human action may be required for the report to eventually land.
- [ ] **REQ-3 (A rejection is not an outage)**: An outcome that `api` receives and *rejects* — an
      unknown `processJobId`, a validation error, any keyed error the schema defines — is terminal
      and must not be retried. Only an undeliverable report is retried; a report `api` answered is
      done, however it answered.
- [ ] **REQ-4 (Blocking is the accepted cost)**: While a report is being retried the encode queue
      must not start another job. This is deliberate: an unreachable `api` cannot supply the next
      job's details either, so proceeding would only produce a second undeliverable outcome.
- [ ] **REQ-5 (Repeated delivery is safe)**: Because a report may be delivered more than once — a
      retry whose predecessor actually succeeded but whose response was lost — `encodeCompleted` and
      `encodeFailed` must both be safe to receive repeatedly for the same job, producing the same
      stored state and no duplicated side effect a user can observe. A second `encodeCompleted` must
      not notify the media server again. The cleanup verdict it returns must remain **safe to
      execute** on a second delivery: a retry means the first verdict may never have reached the
      worker, so the verdict is recomputed and returned rather than suppressed, and every action it
      can instruct must tolerate having already been performed.
- [ ] **REQ-6 (A user upload always wins its race)**: An upload that reaches the end of the tus flow
      must become the winner for its target, whatever the target's other sources have reached.
      A sibling in `READY` or `SCANNED` is demoted rather than treated as a standing winner. The
      upload proceeds exactly as it does today for an uncontested target: the title moves to
      `ENCODING` and a `bull:process` job is enqueued.
- [ ] **REQ-7 (No silent discard)**: No completed upload may end with the target untouched and the
      only record being a server log line. Every completed upload results in either a queued job or
      an error the caller receives.
- [ ] **REQ-8 (A demoted source cannot move the title)**: An outcome arriving for a `ProcessJob`
      whose `MediaSource` was demoted must not change the title's `status` or `filePath` — neither
      promoting it to `COMPLETED` nor dropping it to `ERROR`. The user's newer upload has taken over
      the target; a late report from the source it replaced records itself on its own row and stops
      there. This binds both outcomes: a demoted source's failure must not fail the title the
      winner is still encoding.
- [ ] **REQ-9 (A demotion closes the jobs it orphans)**: Demoting a source must leave no `ProcessJob`
      of that source in a non-terminal state. A row left `WAITING`/`QUEUED`/`ENCODING` with nothing
      that will ever report on it is the same wedged state this feature exists to prevent.

### Non-Functional & Operational Requirements

- [ ] **NFR-1 (Retry is observable)**: Each delivery attempt for an undeliverable report must be
      logged with the job id and the reason, so an operator watching `docker compose logs -f worker`
      can tell a worker waiting on `api` apart from a worker that has hung.
- [ ] **NFR-2 (Retry survives a long outage)**: The retry must not spin at full speed for the whole
      outage, and must not give up because the outage was long. An `api` down for an hour ends with
      the report delivered.
- [ ] **NFR-3 (The confirmation guard is untouched)**: `027-replace-completed-media`'s behaviour is
      unchanged. A `COMPLETED` target still refuses an upload ticket without `force`, so REQ-6 never
      becomes a way to overwrite a finished title without the user confirming it. REQ-6 governs what
      happens *after* a ticket was legitimately issued.
- [ ] **NFR-4 (No new failure mode for torrents)**: `torrentCompleted`'s use of the shared arbiter
      must keep its current semantics. A torrent completing late against a target that already has a
      winner is still ignored — REQ-6 is a property of a deliberate human upload, not of the arbiter
      in general.

## GraphQL Contract Delta

**None — no type, field, mutation or argument changes.** `encodeCompleted` and `encodeFailed` keep
their exact signatures and return shapes, and this feature adds no new operation.

It does, however, change the **behavioural** contract across the boundary in two ways that no
typechecker on either side can see, which is precisely why they are recorded here (Article VIII):

| Operation | Existing signature | Behavioural obligation added |
| :-- | :-- | :-- |
| `encodeCompleted(processJobId: Int!, outputFilePath: String!, ffmpegCommand: String!): EncodeCompletedResult!` | unchanged | `api` must tolerate receiving this more than once for the same `processJobId` (REQ-5): same stored state, no second media-server notification, no second or contradictory cleanup verdict. `worker` may now send it repeatedly. |
| `encodeFailed(processJobId: Int!, errorKey: String!, errorParams: String, errorMessage: String!): Boolean!` | unchanged | Same repeat-safety obligation. `worker` no longer sends this for a transport failure of `encodeCompleted` (REQ-1). |

One **new error key** is added, on the REST `/uploads` surface, because REQ-7 forbids the silent
discard that stands in its place today:

| Condition | HTTP / error envelope | Message the user sees |
| :-- | :-- | :-- |
| A completed upload lost its target's race to a *newer* upload that demoted it mid-flight | `409`, REST body `{ message, i18n: { key: "error.upload.superseded" } }` | `Otra subida más nueva reemplazó a esta` |

This is reachable only when two uploads for the same target finish within milliseconds of each
other: the later one demotes the earlier one's row (REQ-6) between its `create` and its race
resolution. Rare, and precisely the class of "essentially never" this feature exists because of.
Everything else that used to reach the silent `ignorado` return is now unreachable by construction.

Consumer obligations:

- **`worker`**: owns REQ-1 through REQ-4 and NFR-1/NFR-2. Must distinguish an undeliverable report
  from a rejected one. **The existing seam in `src/api/graphql-client.ts` is not that distinction**
  — it separates keyed from unkeyed errors, and a transport failure, an HTTP 500 and an unkeyed
  `api` rejection are all plain `Error`s today. The client must grow an explicit, distinguishable
  "no response was received" failure; only that one is retried.
- **`api`**: owns REQ-5 through REQ-9 and NFR-3/NFR-4, and throws the new key above.
- **`web`**: adds the new key to `messages/{en,es}.json` under `errors.upload.superseded` so the
  upload modal renders it in the active locale. Its existing REST-error reader already resolves the
  top-level `i18n` shape — no component, action or type changes.

## Data Model Changes

None. No model, field, enum or migration changes. The wedged state this feature prevents is
expressible in the current schema and is left alone by design (see Out of Scope).

## Acceptance Criteria

- [ ] **AC-1**: Given an encode in progress, when `api` is stopped (`docker compose stop api`)
      before the encode finishes and restarted two minutes after it finishes, then the job reaches
      `COMPLETED` with its real `outputFilePath` and the episode reaches `COMPLETED` — with no human
      action beyond restarting `api`. Verify with
      `bin/mysql -e 'select id, status, progress, outputFilePath from process_jobs order by id desc limit 1'`.
- [ ] **AC-2** *(failure path)*: In the same scenario as AC-1, `bin/mysql -e 'select status,
      errorKey, errorMessage from process_jobs order by id desc limit 1'` never shows `ERROR` at any
      point during the outage, and `docker compose logs worker` contains no `encodeFailed` call for
      that job.
- [ ] **AC-3** *(failure path)*: Given an encode that genuinely fails (a corrupt input), when it
      fails while `api` is reachable, then the job reaches `ERROR` with its `errorKey` intact,
      exactly as today — proving REQ-1 did not disable real failure reporting.
- [ ] **AC-4** *(failure path)*: Given a `ProcessJob` id that does not exist, when the worker reports
      an outcome for it, then the worker stops after the `api` rejection rather than retrying, and
      the rejection is logged once.
- [ ] **AC-5**: Given a target whose `MediaSource` sits in `SCANNED` or `READY`, when a user uploads
      a file for that target, then the upload's row becomes the winner, the previous source is
      demoted, the episode or film moves to `ENCODING`, and a `bull:process` job is enqueued.
      Verify the enqueue with `docker compose logs -f worker` showing the scan job start.
- [ ] **AC-6**: In AC-5's scenario, `docker compose logs api` contains no `ignorado` line for that
      upload, and the caller's upload request completes without an error — REQ-7's two permitted
      outcomes, with the silent third one gone.
- [ ] **AC-7**: Given the demoted source from AC-5 whose own encode was still running, when that
      encode reports completion, then the episode's status and `filePath` still reflect the user's
      upload, not the demoted source.
- [ ] **AC-8**: Given a completed encode, when `encodeCompleted` is delivered twice for the same job,
      then the stored row is identical after the second delivery and the media server is notified
      once.
- [ ] **AC-9** *(failure path)*: Given a source demoted by a newer upload, when
      `bin/mysql -e 'select status from process_jobs where …'` is read immediately after the
      demotion, then none of that source's jobs is `WAITING`, `QUEUED` or `ENCODING`.
- [ ] **AC-10** *(failure path)*: Given two uploads for the same target completing at the same
      moment, the loser's upload request answers `409` with `i18n.key = "error.upload.superseded"`
      and the browser renders the Spanish copy — never a success followed by nothing.
- [ ] **AC-11**: `bin/npm worker test` and `bin/npm api test` are green,
      `bin/cli worker npx --no tsc --noEmit` / `bin/cli api npx --no tsc --noEmit` report 0 errors,
      and `bin/npm web run build` exits 0.

## Out of Scope

- **Repairing the rows already wedged.** `process_jobs.67`, `media_sources.98/102/107` and
  `episodes.120` stay exactly as they are. This feature is prevention only, by explicit decision:
  building a general reconciler to clean up one historical incident is more machinery than the
  incident is worth, and the retry in REQ-2 means the class of state cannot form again. Those
  specific rows will be unwedged by hand, outside this spec.
- **A reaper for `ProcessJob`s stuck in a non-terminal state.** With REQ-2 holding the report until
  it lands, a job cannot be abandoned mid-flight by an `api` outage any more, so a periodic sweep
  detecting stuck jobs would be defending against a path this feature removes (Article X). If some
  *other* cause of a stuck job appears later, that is the spec that should introduce it —
  `035-scheduled-tasks` is where such a sweep would naturally hang.
- **Cancelling or deleting a `LOCAL_FILE` source from the UI.** `requireTorrent`
  (`downloads.service.ts:172-175`) still refuses `downloadStop`/`downloadDelete` for any source with
  no `infoHash`, so an upload still cannot be removed from the downloads panel. This is deliberately
  deferred to its own spec covering the panel's management surface as a whole; REQ-6 removes the
  reason a user needed that escape hatch in this incident, but it does not provide the hatch.
- **Making BullMQ retry the job itself.** Neither queue configures `attempts`, and this feature does
  not change that. Re-running a finished encode is not the goal — delivering its already-known
  outcome is.
- **Any change to `web` beyond two catalog lines.** No component, action, type or route changes: an
  upload that always wins needs no interface. `web` is in `services:` only to translate
  `error.upload.superseded`, which its existing REST-error reader already knows how to resolve.
- **Cancelling an encode that is already running.** When a newer upload demotes a source whose
  FFmpeg is still going, that FFmpeg keeps running to completion; there is no channel from `api` to
  a running worker job. REQ-8 and REQ-9 make the *database* consistent immediately, but both encodes
  write to the same deterministic output path, so the file on disk is whichever finishes last. Left
  alone deliberately: the fix is a cancellation channel, which belongs to the queue-management spec
  named above.
