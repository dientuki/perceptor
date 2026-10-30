---
title: Encode verdict persistence — Implementation Plan
spec_version: 0.2.0
last_updated: 2026-10-29
status: Implemented
---

# PLAN: Encode verdict persistence (`plan.md`)

## Approach

One small worker module, `services/worker/src/encode/verdict-store.ts`, becomes the only place a
pre-encode verdict is read or written. It wraps the stack's existing Redis (the same
`REDIS_HOST`/`REDIS_PORT` `connection` object `src/index.ts` already hands to BullMQ and to the
`054` lease) behind a narrow interface, the way `src/lease/worker-lease.ts`'s `LeaseRedis` does, so
every resolver test runs against an in-memory fake rather than a live Redis. `src/index.ts` creates
the client at boot and installs it; a process where nothing was installed (the `mock` driver, a
unit test that did not ask for one) behaves as a permanent miss, which is exactly NFR-3's posture.

Each verdict is stored under `perceptor:encode:<kind>:<digest>`, where `<digest>` is a hash of the
verdict's identity (spec REQ-3). A hash rather than the raw identity because the identity holds file
paths, which carry spaces, colons and non-ASCII titles; the readable `<kind>` segment is what keeps
AC-4's `--scan` useful. Values are JSON, written with a 30-day expiry in the same command (NFR-2).

The four existing resolvers keep their shape and their failure handling; only the cache lookup and
the cache write change:

| Resolver | Today | After |
| :-- | :-- | :-- |
| `grain-mode.ts` (`094`) | `Map` by `mediaSourceId` | store kind `grain`, identity `mediaSourceId` |
| `dub-trim.ts` (`098`) | `Map` by input path | store kind `dubtrim`, identity = file |
| `stream-end-trim.ts` (`099`) | none | store kind `streamtrim`, identity = file + kept audio indices |
| `subtitle-prune.ts` (`102`) | `Map` by input path | store kind `subs`, identity = file + qualifying text stream indices |

"File" is path + size + `mtimeMs` from one `stat`. A `stat` that fails yields no identity, and no
identity means "compute, do not store" — never a key built from a partial identity.

Keying the stream-end and subtitle verdicts on the **stream indices the selection kept**, rather
than on the settings that chose them, was the spec's decision (REQ-3); it is also what makes `110`
fit, since `110`'s verdict changes the kept audio set without touching any setting. The kept set is
already computed inside each resolver (`selectAudioStreams` with the `110` resolution,
`qualifyingGroups`), so the identity costs nothing new.

**The Blu-ray assembly (REQ-6/REQ-7) uses the same store as its proof of completeness.** After
`mkvmerge` succeeds, the worker records the assembled file's own size and `mtimeMs` under kind
`assembly`, identified by the playlist file. On the next start, an existing `.perceptor.mkv` is
reused only if it matches that record exactly; otherwise it is removed and assembled again. The
alternative, assembling under a temporary name and renaming on success, was rejected because it
cannot tell a completed file from a partial one left at the final name by the pre-`111` code (which
wrote there directly): an encode stopped mid-assembly before the upgrade and resumed after it would
reuse a truncated film with no error anywhere. A Redis record cannot be forged by an old partial, and
a missing record (Redis down, snapshot lost, TTL past) only costs a re-assembly.

`encode.job.ts`'s `finally` stops removing the assembled file on a stop, a failure or a cancellation;
it still removes it after a delivered compressed encode (the passthrough branch moves it, as today).
Removal on delete, title removal and discard needs **no change**: `100` NFR-1 placed the file inside
the source's download folder, and `api`'s existing `deleteResidue` (`downloads.service.ts`) already
removes that folder recursively for a torrent or folder source on `047`/`067`, and on `095`'s
discard of the last job when nothing unmatched is left.

`110`'s audio-variant verdict is not wired here (spec Out of Scope). The module documents the
`audio-variant` kind and its identity so `110`'s deferred T009 fills its two seams without designing
anything.

## Order of Work

| Step | Service | Why it must come here |
| :-- | :-- | :-- |
| 1 | `worker` | The whole feature. No contract, no schema, no other service. |
| 2 | `docs` | `services/worker/CLAUDE.md` describes each cache as an in-memory `Map` and the assembled file as removed on every path; both become false at step 1. |
| 3 | `worker` (spec `110`) | `110`'s deferred T009 fills its `// Spec 110, REQ-8` seams with the `audio-variant` kind. Tracked in `110`'s `tasks.md`, not here. |

Nothing runs in parallel: step 1 is one service.

## Contract Freeze

The spec's GraphQL delta is **None**, frozen as of `status: Approved`. Things an implementer will be
tempted to do and must not:

- **Report verdicts to `api`.** The worker already talks to `api`, and a `recordX` mutation looks
  like the house pattern. It is not this feature: the verdicts are worker-only (NFR-1), and `110`
  was amended precisely to drop its `api` table in favour of this store.
- **Keep the `Map` as a first-level cache in front of Redis.** NFR-6. A two-level cache is two
  places a stale verdict can live, and the Redis read is milliseconds against minutes of analysis.
- **Key the subtitle or stream-end verdict on the settings.** REQ-3 keys them on the kept streams.
  Settings miss `110`'s influence and the title's original language.
- **Make the store throw.** Every failure path returns "miss" or swallows the write (NFR-3); a
  resolver must never need a new `try` because of the store.

## Migrations

None. No Prisma schema change. Redis keys need no migration: a pre-`111` worker never wrote any, so
the first encode after the upgrade computes and stores as a cache miss would.

## Risks

| Risk | How it fails | Mitigation |
| :-- | :-- | :-- |
| ioredis queues commands while Redis is down and retries forever by default | A stopped Redis does not error, it hangs: the encode sits in `ENCODING` at 0% before FFmpeg with no log line, which is the opposite of NFR-3 | The store's client is created with the offline queue off, no per-request retries and a short command timeout; a test drives the store with a fake that never resolves and asserts the resolver still returns within the timeout |
| A verdict reused for a different file | A season-pack episode, or a file replaced under the same name, gets another file's trim or subtitle drops: wrong output, no error | Identity includes size and `mtimeMs`; tests assert a changed size or mtime misses |
| A verdict reused after the kept streams changed | Subtitle drops or a trim computed for other tracks (today's path-only bug, REQ-4) | Identity includes the kept indices; a test changes the selection and asserts a miss |
| A partial `.perceptor.mkv` reused as complete | A truncated film delivered as a success | Reuse requires an exact size + mtime match against the `assembly` record written only after `mkvmerge` succeeded; a test covers file-without-record and record-with-different-size |
| A cancelled or failed analysis stored | The next start trusts a verdict that was never reached | Writes happen only on the success path of each resolver, never in its `catch`; tests assert no write after a cancellation and after a failure |
| The assembled file outlives its source | Disc-sized file left in downloads | Delete/remove/discard already rm the download folder recursively (`api`, unchanged). The one gap, a discard of a source that also has unmatched files, leaves the folder (disc files included) by `095`'s existing rule, so the assembled file is no new residue. Recorded, not fixed |
| A key written with no expiry | Under `noeviction`, Redis eventually refuses every write, including BullMQ's | The store has one write function and it always sets the expiry in the same command; a test asserts it |

## Verification

```bash
bin/cli worker npx --no tsc --noEmit
bin/npm worker test
bin/comments worker
```

Manual pass, with `ENCODE_DRIVER=ffmpeg`, `grain_auto_enabled`, `dub_trim_enabled` and
`stream_end_trim_enabled` on:

1. **AC-3**: start a film encode, wait for FFmpeg progress, Stop, Play. `docker compose logs worker`
   shows `[grain] … (reused)` and a reused line for `[dubtrim]`, `[streamtrim]` and `[subs]`.
2. **AC-4**: `bin/cli redis redis-cli --scan --pattern 'perceptor:encode:*'` lists the keys;
   `bin/cli redis redis-cli TTL <key>` prints at most `2592000`.
3. **AC-1**: during FFmpeg, `docker compose restart worker`. After `054`'s requeue the same reused
   lines appear and no `[grain] … probe starting` line does.
4. **AC-2**: as 3, rebooting the host more than 60 s after FFmpeg started.
5. **AC-5**: Stop, change the allowed subtitle languages so a qualifying group changes, Play. `[subs]`
   is computed, not reused.
6. **AC-6 / AC-7**: a Blu-ray film. Stop after `mkvmerge` finished: Play shows the assembly reused and
   no `mkvmerge` run. Stop during `mkvmerge`: Play assembles from scratch.
7. **AC-8** is the `bin/npm worker test` run above (spec AC-8 says why it is not manual).
8. **AC-9**: a Blu-ray film stopped after assembly, then deleted from `/downloads`: no
   `.perceptor.mkv` under the downloads root. Repeat with a discard, and with a delivered encode.
