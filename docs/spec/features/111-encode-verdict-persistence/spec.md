---
title: Encode verdict persistence
spec_version: 0.2.0
author: Juan "Dientuki" Farias
created_at: 2026-10-29
last_updated: 2026-10-29
status: Implemented
services: [worker]
---

# SPEC: Encode verdict persistence (`spec.md`)

## Context & Goal

Before FFmpeg starts encoding, the worker's encode driver (`services/worker/src/encode/encode.ffmpeg.ts`)
runs up to four analyses of the input, and for a Blu-ray input one assembly step before them:
the film-grain gate and encode probe (`092`/`094`, `encode/grain-mode.ts`), the dubbing-credit tail
detection (`098`, `encode/dub-trim.ts`), the stream-end packet read (`099`,
`encode/stream-end-trim.ts`) and the subtitle content read (`102`, `encode/subtitle-prune.ts`), plus
the `mkvmerge` playlist assembly (`100`, `disc/assemble-playlist.ts`). The grain probe and the
assembly are the expensive ones, minutes on a long film; the others read hundreds of seconds of the
file. Three of the four verdicts are cached today, but only in an in-memory map of the worker
process, and the stream-end verdict is not cached at all.

That cache is enough for a Stop followed by Play (`097`), because the same process picks the job up
again. It is lost whenever the worker container dies: a host reboot halfway through an encode makes
`054`'s recovery requeue the job into a fresh process, which repeats every analysis before it can
start FFmpeg again. A Blu-ray is worse: `100` REQ-10 deletes the assembled `.perceptor.mkv` on any
stop or crash, so even a Stop/Play re-runs `mkvmerge` over the whole disc. The in-memory subtitle
cache also has a latent bug: it is keyed by the input path alone, while the set of tracks it drops
depends on the installation's allowed subtitle languages and formats, so changing those settings
between a Stop and a Play reuses a verdict computed for different settings.

`110-audio-variant-detection` adds a fifth pre-encode analysis, the most expensive of all (a
transcription of samples of two audio tracks), and keeps its verdict in the store this feature
defines rather than a cache of its own (`110` REQ-8, NFR-6). `110` is already implemented with
the store read and write left as seams, so this feature ships before `110` is closed, and the
store must take `110`'s verdict kind beside the four below. Since `110`, the stream-end trim
also depends on the audio-variant verdict, because it decides which audio tracks are kept.

Once this ships, a verdict the worker has finished computing survives a worker restart and a host
reboot, and a completed Blu-ray assembly is reused instead of rebuilt. The FFmpeg encode itself still
restarts from 0%. The Transcode stage of the root `CLAUDE.md` pipeline keeps its status; only the
work it repeats on a restart changes. This amends `100` REQ-10 for the case where the assembly had
already finished.

## Requirements

### Functional Requirements

- [ ] **REQ-1 (Verdicts survive a restart)**: A grain, dub-trim, stream-end or subtitle-pruning
      verdict the worker finished computing must be reused by a later encode of the same input, with
      the same settings, after the worker container restarted or the host rebooted, not only after a
      Stop/Play in the same process.
- [ ] **REQ-2 (Stream-end verdict is reused too)**: The stream-end trim verdict (`099`) must be
      reused under the same rules as the other three. Today it has no cache at all.
- [ ] **REQ-3 (Identity of a verdict)**: A verdict must only be reused for the input it was computed
      for, under the inputs that decide it:
      - grain: the media source, as `094` defines it today (one verdict per source);
      - dub-trim: the input file;
      - stream-end trim: the input file and the set of audio streams the selection keeps (after
        `110`'s variant verdict), since that set is what the trim measures;
      - subtitle pruning: the input file and the set of text subtitle streams the selection keeps
        before pruning, since that set is what the content read compares;
      - audio variant (`110`): the identity `110` REQ-8 defines (input file, detector `iso3`, the
        two candidate stream indices).
      A file is identified by its path, size and modification time, so a file replaced under the same
      name is never matched to the old verdict. Keying on the kept streams rather than on the
      settings that chose them means any change that alters the selection (settings, a title's
      original language, a `110` verdict) makes the verdict miss, and a change that does not alter it
      keeps the hit.
- [ ] **REQ-4 (Selection change)**: Changing the allowed subtitle languages, tags or formats
      between a Stop and a Play, in a way that changes which text subtitle streams are selected, must
      make the next encode compute the subtitle-pruning verdict again. This fixes the existing
      path-only cache. The same holds for the stream-end verdict when the kept audio streams change.
- [ ] **REQ-4b (Room for `110`)**: The store must accept `110`'s audio-variant verdict as one more
      kind under every rule here (identity, TTL, namespace, failure posture, finished verdicts
      only). Writing that kind into the encode is `110`'s own remaining work, not this feature's.
- [ ] **REQ-5 (Only finished verdicts)**: An analysis cancelled mid-run (`047`/`097`) and a detection
      that failed must not be stored, so the next encode tries again, as each analysis does today.
      Grain mode `ON`/`OFF` stores nothing; only the `INHERIT` path computes a verdict.
- [ ] **REQ-6 (Assembled disc is reused)**: For a Blu-ray input (`100`), a completed assembly must be
      kept when the encode stops (`097`), fails, or its worker dies, and must be reused by the next
      encode of the same playlist instead of running `mkvmerge` again. Because the reused file keeps
      its size and modification time, the REQ-3 verdicts computed on it are reused too.
- [ ] **REQ-7 (Partial assembly is never reused)**: An assembly interrupted before it finished (stop,
      delete, worker death mid-`mkvmerge`) must never be taken for a completed one. It is discarded
      and the next encode assembles from scratch, as `100` REQ-10 says today.
- [ ] **REQ-8 (The assembled file still goes away)**: The kept assembled file must still be removed
      when the encode delivers, when the source is deleted (`047`) or the title removed (`067`), and
      when the job is discarded (`095`), so that keeping it never leaves a disc-sized file behind once
      the work it was kept for is gone.
- [ ] **REQ-9 (Reuse is visible in the log)**: Each analysis must log whether its verdict was computed
      or reused, the way the grain resolver already logs `stage=cache ... (reused)`, and the encode
      must log whether the assembly was reused.

### Non-Functional & Operational Requirements

- [ ] **NFR-1 (Redis, worker only)**: Verdicts are stored in the stack's existing Redis, which the
      worker already connects to. No Prisma change, no GraphQL change, no change in `api` or `web`.
- [ ] **NFR-2 (Every key expires)**: Redis runs with `maxmemory-policy noeviction`, so every stored
      verdict must carry a TTL of 30 days. A job left stopped longer than that recomputes on resume.
- [ ] **NFR-3 (Redis failure degrades, never fails)**: A Redis read or write that fails, times out,
      or returns a value that cannot be parsed must count as "no verdict": the analysis is computed
      as it is today and the encode proceeds. It must never fail, stall or change the encode's
      outcome.
- [ ] **NFR-4 (Persistence window)**: Redis snapshots to the `redis_data` volume at most every 60 s
      (`--save 60 1`). A verdict written less than that before a host crash may be lost and is then
      recomputed; this is accepted, not compensated.
- [ ] **NFR-5 (Key namespace)**: Every key lives under `perceptor:encode:`, so an operator can list
      and clear them, and `bin/dbreset`'s `FLUSHALL` keeps clearing them.
- [ ] **NFR-6 (No second cache)**: The in-memory maps are replaced, not kept beside Redis
      (Article X).
- [ ] **NFR-7 (Tests)**: A test must cover REQ-3/REQ-4 (a verdict is not reused across a changed file
      or changed settings) and NFR-3 (Redis failure falls back to computing). Both bugs would be
      silent: a wrong verdict keeps or drops tracks with no error anywhere (Article IX).

## GraphQL Contract Delta

**None — this feature does not cross the service boundary.** The verdicts are read and written by
the worker alone, in Redis, and nothing about them reaches `api` or `web`.

## Data Model Changes

None.

## Acceptance Criteria

- [ ] **AC-1**: With `grain_auto_enabled` on and a title on `INHERIT`, start an encode, wait until
      FFmpeg is encoding, run `docker compose restart worker`. After the requeue, the worker log
      shows the grain, dub-trim, stream-end and subtitle verdicts as reused, and no grain probe runs.
- [ ] **AC-2**: Same as AC-1 but rebooting the host more than 60 s after FFmpeg started. Same result.
- [ ] **AC-3**: Stop an encode while FFmpeg is running and press Play. The log shows all four
      verdicts reused, including the stream-end one.
- [ ] **AC-4**: `bin/cli redis redis-cli --scan --pattern 'perceptor:encode:*'` lists the keys of an
      encode in progress, and `redis-cli TTL <key>` prints a value no greater than 2592000.
- [ ] **AC-5**: Stop an encode, change the allowed subtitle languages in Settings, press Play. The
      log shows the subtitle verdict computed, not reused.
- [ ] **AC-6**: Blu-ray film: stop the encode after assembly finished and FFmpeg started, press Play.
      `mkvmerge` does not run again, the log says the assembly was reused, and the verdicts are
      reused.
- [ ] **AC-7 (failure)**: Blu-ray film: stop the encode while `mkvmerge` is still running, press
      Play. The partial `.perceptor.mkv` is not reused: assembly runs from the start.
- [x] **AC-8 (failure)**: `bin/npm worker test` passes the store cases where Redis rejects every
      command, never answers, or returns a value that does not parse: each resolver computes its
      verdict, returns it, and the encode path never throws because of the store. This is not a
      manual pass because stopping the stack's Redis also stops BullMQ, which carries the encode
      job itself, so it cannot isolate the store's failure.
- [ ] **AC-9**: Blu-ray film: stop the encode after assembly, then delete the source from
      `/downloads`. No `.perceptor.mkv` is left under the downloads root. Same after discarding the
      job and after a delivered encode.

## Out of Scope

- **Resuming FFmpeg mid-file.** The encode still restarts from 0%; resuming an AV1 encode partway
  is a different problem (segmenting, concatenation, keyframe alignment).
- **Persisting the resolved FFmpeg command.** The command is rebuilt from the reused verdicts, which
  is cheap; storing it beside the `ProcessJob` would need a schema and contract change for no
  further saving.
- **Invalidating the grain verdict when a title's year, `isShort` or `contentKind` changes.** `094`
  caches one verdict per source and ignores those changes today; this feature keeps that rule
  rather than widen it.
- **Caching `ffprobe`.** It reads headers only and takes well under a second.
- **Wiring `110`'s verdict into the store.** `110`'s resolver has two `// Spec 110, REQ-8` seams
  waiting for this store; filling them, with their test cases, is `110`'s deferred T009 work once
  this feature is implemented.
- **Proactive deletion of keys when a job finishes.** The 30-day TTL bounds them; their values are a
  few bytes each.
