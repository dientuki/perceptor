---
title: Encode verdict persistence — worker slice
service: worker
last_updated: 2026-10-29
status: Implemented
---

# PLAN: Encode verdict persistence — `worker` (`worker/plan.md`)

## Scope

The worker replaces its three in-memory verdict caches with one Redis-backed store, adds the
missing stream-end cache, and keeps a completed Blu-ray assembly across a stop, a failure or a
restart, proving it complete through the same store. Nothing leaves the worker: no GraphQL call, no
`api` change, no change to `docker-compose*.yaml` (the worker already has `REDIS_HOST`/`REDIS_PORT`).
Wiring `110`'s audio-variant verdict into the store is **not** this slice; `110`'s deferred T009 does
it. Writes are confined to `services/worker/` and this directory. `services/worker/CLAUDE.md` is
updated by a separate `[docs]` task, not by this slice.

`src/ffmpeg/` belongs to the `ffmpeg` agent. Nothing in this slice needs to touch it: the kept-stream
selections (`selectAudioStreams`, `selectSubtitleStreams`) are already called from the resolvers in
`src/encode/`, and their results are what the identities are built from. If a step seems to need a
change in `src/ffmpeg/`, stop and report.

## Files

| File | New / Modified | What changes |
| :-- | :-- | :-- |
| `services/worker/src/encode/verdict-store.ts` | New | The store: install/read/write, key building, file identity, the kind list |
| `services/worker/src/encode/verdict-store.spec.ts` | New | Store failure posture, expiry, identity (Article IX header) |
| `services/worker/src/index.ts` | Modified | Create the store's Redis client at boot and install it; close it on shutdown |
| `services/worker/src/encode/grain-mode.ts` | Modified | `Map` → store kind `grain`; `resetGrainVerdictCache` removed |
| `services/worker/src/encode/dub-trim.ts` | Modified | `Map` → store kind `dubtrim`; reused log line; `resetDubTrimCache` removed |
| `services/worker/src/encode/stream-end-trim.ts` | Modified | New lookup/write, kind `streamtrim`, identity includes kept audio indices; reused log line |
| `services/worker/src/encode/subtitle-prune.ts` | Modified | `Map` → store kind `subs`, identity includes qualifying stream indices; reused log line; `resetSubtitlePruneCache` removed |
| `services/worker/src/disc/assemble-playlist.ts` | Modified | Reuse a recorded complete assembly; record it after a successful `mkvmerge` |
| `services/worker/src/jobs/encode.job.ts` | Modified | The `finally` keeps the assembled file unless the encode delivered |
| the four resolver specs, `src/disc/*.spec.ts`, `src/jobs/encode.job.spec.ts` | Modified | Replace `reset*Cache()` with a fresh in-memory store per test; new identity and reuse cases |

## Existing code to reuse

- `src/index.ts`'s `connection` object — the one Redis address every client in the worker uses. The
  store's client is built from it, never from a second read of the env vars.
- `src/lease/worker-lease.ts`'s `LeaseRedis` — the house pattern for a narrow Redis interface a test
  can fake. The store declares its own (`get`, `set` with an expiry) the same way, and its spec uses
  a plain object, not a mocked ioredis.
- `src/encode/cancellation.ts`'s `EncodeCancelledError` — each resolver already rethrows it before its
  failure branch. The store write sits after the analysis returned, so cancellation never reaches it;
  keep it that way.
- `grain-mode.ts`'s `[grain] … stage=cache … (reused)` log line — the model for the three new reused
  lines (REQ-9). Same tag as each resolver's existing line, so `docker compose logs worker | grep`
  keeps finding everything about one analysis under one tag.
- `assemble-playlist.ts`'s `assembledPathFor` — the assembled path stays exactly what it is; only the
  decision to reuse it is new.
- `110`'s `AudioVariantVerdict` type in `src/encode/audio-variant.ts` — referenced by the store's kind
  list as the shape `110` will store, so `110`'s T009 does not invent a second one.

## Steps

1. **`verdict-store.ts`.** Exports:
   - `installVerdictStore(redis)` / an internal "nothing installed" state that reads as a miss and
     drops writes silently.
   - `fileIdentity(path)` → `{ path, size, mtimeMs } | null` from one `stat`; `null` on any error.
   - `readVerdict<T>(kind, identity)` → `T | undefined`. `undefined` on a miss, a Redis error, a
     timeout or a value that is not valid JSON. Logs one line on an error (not on a plain miss).
   - `writeVerdict(kind, identity, value)` → `Promise<void>` that never rejects; logs on error.
   - Key: `perceptor:encode:<kind>:<sha1 of the canonical JSON of the identity>`. Value: JSON. Every
     write sets a 30-day expiry in the same `SET` (`EX 2592000`). This is the only write function.
   - Kinds: `grain`, `dubtrim`, `streamtrim`, `subs`, `assembly`, and `audio-variant` reserved for
     `110` with a `// Spec 110, REQ-8` locator naming its identity.
   - A `null` identity (from `fileIdentity`) means: do not read, do not write.
   Constitution Article XI: only `// Spec 111, <ref>` locators, no prose comments.
2. **Client options in `index.ts`.** Create a dedicated ioredis client from `connection` with the
   offline queue disabled, no per-request retries and a command timeout of a few seconds, so a
   down Redis fails each store call fast instead of queueing it (plan Risks, first row). The
   worker's `ioredis` is `^6`; confirm the option names against the installed version rather than
   from memory. Install it before the encode `Worker` is constructed; `quit()` it in the existing
   shutdown path beside the lease client. Never reuse the lease client or a BullMQ connection: a
   blocking BullMQ connection must not carry store traffic, and the lease's must not inherit the
   store's fail-fast options.
3. **`grain-mode.ts`.** Replace the `Map` read with `readVerdict<boolean>('grain', { mediaSourceId })`
   and each `verdictCache.set` with `writeVerdict`. `ON`/`OFF` still short-circuit before any read.
   Gate and short-film `false` verdicts are stored exactly where they are cached today; the failure
   branch stores nothing (unchanged). Delete `resetGrainVerdictCache`.
4. **`dub-trim.ts`.** Identity = `fileIdentity(input)`. On a hit, print
   `[dubtrim] input=… -> keep|cut=… (reused)` and return it. Store only after a completed
   detection. The failure branch stays silent and stores nothing. Delete `resetDubTrimCache`.
5. **`stream-end-trim.ts`.** After `kept` is computed and before `readTrackEnds`, identity =
   `{ ...fileIdentity(input), video: video.index, audio: kept indices sorted }`. On a hit, print the
   `[streamtrim]` line with `(reused)` and return. After a completed decision (including the
   out-of-window keep), store `cut` (`number | null`). The `catch` stores nothing.
6. **`subtitle-prune.ts`.** After `qualifyingGroups` returns non-empty, identity =
   `{ ...fileIdentity(input), streams: the groups' stream indices sorted }`. On a hit, print
   `[subs] reused drops=[…]` and return the set (stored as an array). Store after the verdict lines
   are built; the `catch` stores nothing. Delete `resetSubtitlePruneCache`. This replaces the path-only
   key (spec REQ-4).
7. **`assemble-playlist.ts`.** Identity = `fileIdentity(playlistPath)` (the `.mpls`, which never
   changes between starts). Before assembling: if the assembled file exists and its current size and
   `mtimeMs` equal the stored `assembly` record, log `[disc] reused <path>` and return it without
   running `mkvmerge`. Otherwise keep today's behaviour (remove, assemble, remove on failure). After a
   successful `mkvmerge`, `stat` the output and store `{ size, mtimeMs }`. A `null` playlist identity
   means assemble as today and record nothing.
8. **`encode.job.ts`.** The `finally` removes the assembled file only when the compressed encode
   delivered (the passthrough branch still moves it and sets `assembledMoved`). On a stop, a
   cancellation, a `KeyedError` or an unclassified throw it is kept for the next start. The
   `isInsideRoot` guard stays on the one remaining removal.
9. **Tests**, below.

## Contract obligations

None. The spec's GraphQL delta is **None**; this slice adds no query, mutation or field, and must
not start reporting verdicts to `api` (plan § Contract Freeze). The BullMQ payload in
`src/queue/types.ts` is unchanged.

## Tests

Each new spec file opens with the Article IX header naming the silent failure.

- `src/encode/verdict-store.spec.ts` — defends against a store failure that hangs or fails an encode
  and against a key with no expiry under `noeviction`. Cases: Redis rejects → `undefined`/no throw;
  Redis never answers → resolves within the timeout as a miss (fake that never settles + fake
  timers, or the real client option exercised through the fake); unparsable value → miss; every
  write passes the 30-day expiry; nothing installed → miss and no throw; `null` identity → no call
  at all; same identity in a different key order → same key.
- `src/encode/grain-mode.spec.ts`, `dub-trim.spec.ts`, `stream-end-trim.spec.ts`,
  `subtitle-prune.spec.ts` — defend against a verdict reused for the wrong input or stored when it
  was never reached. Per resolver: a hit skips the analysis and logs `(reused)`; a changed size or
  mtime misses; a cancellation stores nothing; a failure stores nothing. Plus: stream-end misses
  when the kept audio set changes (a `110` resolution passed in); subtitle pruning misses when a
  qualifying group changes (REQ-4); stream-end stores the out-of-window keep.
- `src/disc/assemble-playlist.spec.ts` — defends against a truncated film reused as complete. File
  present with no record → reassembled; record with a different size → reassembled; matching record
  → reused, `mkvmerge` not spawned; a failed or cancelled `mkvmerge` → no record written.
- `src/jobs/encode.job.spec.ts` — the assembled file survives a stop, a cancellation and a failure,
  and is removed after a delivered compressed encode.

`src/index.ts`'s wiring has no unit test: it is boot code the manual pass exercises (AC-1, AC-4),
the same posture as the lease's boot wiring.

## Done when

```bash
bin/cli worker npx --no tsc --noEmit
bin/npm worker test
bin/comments worker
```

All three green, then the manual pass in `../plan.md` § Verification.
