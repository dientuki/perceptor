---
title: Encode Report Durability — Implementation Plan
spec_version: 0.1.0
last_updated: 2026-09-01
status: Approved
---

# PLAN: Encode Report Durability (`plan.md`)

## Approach

The worker fix is a **structural move, not a new mechanism**. `handleEncode`'s `try` block today
wraps both the encode *and* the `encodeCompleted` call, which is the entire bug: a transport failure
of the report lands in a `catch` whose only job is to send `encodeFailed`. Lifting the
`encodeCompleted` call out of that `try` makes REQ-1 true by construction — once FFmpeg has
produced a file, the code path that could report a failure is no longer in scope. Nothing is
flagged, branched or guarded; a block boundary moves. This is the Article X reading of the spec, and
it is why no state machine, no "encode succeeded" boolean and no reconciler appears anywhere in this
plan.

Around that, one genuinely new unit: `services/worker/src/api/deliver-report.ts`, a
retry-until-acknowledged wrapper used by exactly the two report call sites (REQ-2 covers both
outcomes). It cannot be a generic retry inside `fetchGraphQL` — `encodeProgress` and `recordFfprobe`
deliberately swallow their failures and must keep doing so, and the initial `processJob` query must
keep failing fast. The wrapper needs to tell "no answer" from "an answer I did not like" (REQ-3),
and **the seam the spec's first draft assumed does not exist**: `graphql-client.ts` throws a
`KeyedError` for a keyed `api` error and a plain `Error` for a transport failure, an HTTP 500, a
malformed body and an unkeyed GraphQL error alike. So `graphql-client.ts` grows one exported error
class, `ApiUnreachableError`, thrown only where `fetch` itself rejects — the one case where we know
no application ever saw the request. Everything else stays exactly as it is and is terminal. This
deliberately treats an HTTP 500 as terminal: the api answered, and retrying a request that reached a
running server forever is how a poison job blocks the queue permanently.

On the `api` side, REQ-6 is a **deletion**: `demoteSupersededSources` currently opens with
`if (!(await this.uploadTickets.isReplaceAuthorised(uploadId))) return;`, and that line is the whole
reason a user's upload could lose to a wedged source. Removing it makes every completed upload
demote its target's finished sources, which in turn makes `resolveRace` find no standing winner and
take the ordinary winning path. `resolveRace` itself is **not touched** — NFR-4 requires a late
torrent to keep losing, and the arbiter is shared with `torrentCompleted`. The behaviour change
belongs to the upload path, which is where the user's intent lives.

Reuse, explicitly: `demoteSupersededSources` (already writes the `SOURCE_REPLACED` demotion), the
shared `DownloadsService.resolveRace` (unchanged), `UploadHttpError` (already the REST error
envelope), `MESSAGES_EN`/`ERROR_KEYS` (the key vocabulary), and `web`'s existing REST-error reader in
the upload modal. Nothing new is introduced on the `api` or `web` side beyond one error key.

## Order of Work

`api` first, and this ordering is load-bearing rather than conventional: the worker's retry (REQ-2)
is only safe once `encodeCompleted`/`encodeFailed` are repeat-safe (REQ-5). Shipping the worker
first would mean a retry that double-notifies the media server on every lost response.

| Step | Service | Why it must come here |
| :-- | :-- | :-- |
| 1 | `api` | Owns REQ-5's repeat-safety, which the worker's retry depends on; owns REQ-6/7/8/9 and the new error key. Nothing it does requires the worker to change first. |
| 2 | `worker` | Its retry is only correct against a repeat-safe `api`. Consumes step 1's guarantee; changes no schema and no contract. |
| 3 | `web` | Two catalog lines for the key `api` starts throwing in step 1. |

**Steps 2 and 3 can run in parallel** with each other once step 1 is merged — they share no file and
no contract surface. Step 3 could technically start immediately (the key string is frozen in
`spec.md`), but there is nothing to gain: it is a two-line change.

## Contract Freeze

`spec.md`'s `## GraphQL Contract Delta` is frozen as of `status: Approved`. It adds **no SDL** —
`encodeCompleted` and `encodeFailed` keep their exact signatures — and exactly one error key.

Things an implementer will want to change and must not:

- **`encodeCompleted`'s return shape.** It is tempting, while making it repeat-safe, to add a
  `wasAlreadyCompleted` boolean so the worker can skip cleanup on a retry. Do not. The worker must
  execute the verdict it receives, because a retry means the *first* verdict may never have arrived
  and its cleanup may never have run. Suppressing cleanup on the second delivery leaks a torrent and
  its files with no error anywhere.
- **`ApiUnreachableError`'s narrowness.** An implementer will want to also retry HTTP 502/503, or
  every 5xx. Do not, in this feature: `INTERNAL_GRAPHQL_URL` points straight at `api:4000` with no
  proxy in between, so a 5xx is `api` answering. Widening the retryable set is a contract decision,
  not a local one.
- **`resolveRace`.** Its `alreadyWon` guard looks like the bug and is not. It is shared with
  `torrentCompleted`, where NFR-4 requires the existing behaviour exactly. Fix the upload path.
- **The `COMPLETED` + `force` guard at ticket-mint time** (`027-replace-completed-media`) stays
  untouched (NFR-3). REQ-6 governs what happens after a ticket was legitimately issued, never
  whether one is issued.

## Migrations

**None.** No model, field, enum or migration changes. REQ-8 and REQ-9 are expressed entirely with
columns that already exist (`MediaSource.status`, `ProcessJob.status`), and the wedged rows from the
incident are explicitly left alone (`spec.md` § Out of Scope).

Reversibility: the whole feature is revertible by reverting the commits. No data is rewritten, so a
rollback loses the fix and nothing else.

## Risks

| Risk | How it fails | Mitigation |
| :-- | :-- | :-- |
| Retry loop swallows a *terminal* rejection and spins forever | The encode queue blocks permanently on a poison job. No error surfaces — the worker looks busy, and every later encode silently never starts | Only `ApiUnreachableError` is retried, thrown at exactly one place (`fetch` rejecting). `graphql-client.spec.ts` pins that an HTTP 500, an unkeyed GraphQL error and a `KeyedError` are all **not** that class |
| `encodeCompleted` re-delivered, media server notified twice | Duplicate library scans; harmless once, noisy at scale, and invisible | `api` skips `notifyCreated` when the job is already `COMPLETED` with the same `outputFilePath`; `process-jobs.service.spec.ts` asserts the second call does not notify |
| Demoted source's late report clobbers the winner | The user's new upload finishes `COMPLETED`, then the old source's encode reports and drags the episode to `ERROR` (or overwrites `filePath` with the old file). Nothing errors; the title is simply wrong | REQ-8's guard reads `MediaSource.status === 'ERROR'` before touching the title, in **both** `encodeCompleted` and `encodeFailed` |
| Demotion orphans a running `ProcessJob` | Exactly the wedged state this feature exists to prevent, re-created by its own fix: a row in `ENCODING` that nobody will ever report on | REQ-9 — the demotion closes the source's non-terminal jobs in the same transaction |
| Two encodes race onto the same output path | Both write the same deterministic path; the file is whichever finishes last. Silent — the DB is consistent and the file is simply the wrong one | **Accepted, not mitigated.** Named in `spec.md` § Out of Scope; needs a cancellation channel that does not exist |
| `api` unreachable at the *start* of a job | `handleEncode`'s opening `processJob` query throws before any `try`; BullMQ fails the job with no `attempts`, and the row sits `QUEUED` forever with no error outside the worker log | **Out of scope and unaddressed.** REQ-1/REQ-2 govern a *finished* job's outcome. Recorded here because it is the same silent class and will need its own spec |
| Worker retries while the api restarts *mid-transaction* | A report is applied, the response is lost, the retry applies it again | This is precisely what REQ-5 exists for; it is the designed path, not a risk, provided step 1 lands before step 2 |

## Verification

```bash
bin/cli api npx --no tsc --noEmit
bin/npm api test
bin/cli worker npx --no tsc --noEmit
bin/npm worker test
bin/npm web run build
```

Then the manual pass, which is where AC-1/AC-2 actually live — no unit test can prove them:

1. Start an encode (upload a file to an episode, or attach a magnet and let it complete).
2. While FFmpeg is running, `docker compose stop api`.
3. Watch `docker compose logs -f worker`: the encode finishes, then the delivery retry logs one line
   per attempt with the job id and a widening delay (NFR-1, NFR-2). No `encodeFailed` appears (AC-2).
4. Wait past the point the encode finished — two minutes is enough — then `docker compose start api`.
5. The next retry succeeds; cleanup runs; the job reports `COMPLETED`.
6. `bin/mysql -e 'select id, status, progress, outputFilePath from process_jobs order by id desc limit 1'`
   shows `COMPLETED`, `100`, and the real path (AC-1).
7. For AC-5/AC-6: pick an episode whose `MediaSource` is `SCANNED`, upload a file to it, and confirm
   the episode moves to `ENCODING`, a scan job starts in the worker log, and `docker compose logs api`
   contains no `ignorado` line for that upload.
