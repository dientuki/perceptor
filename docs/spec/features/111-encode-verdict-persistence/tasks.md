---
title: Encode verdict persistence — Tasks
last_updated: 2026-10-29
status: Done
---

# TASKS: Encode verdict persistence (`tasks.md`)

## Legend

| Marker | Meaning |
| :-- | :-- |
| `[worker]` | Owned by the `worker` agent. Every code task here is `worker`; nothing touches `src/ffmpeg/`, so the `ffmpeg` agent has no work. |
| `[docs]` | Documentation, the live pass and the acceptance walk. Owned by the orchestrator. |
| `[P]` | May run in parallel with the other `[P]` tasks in the same group. |
| `→ Tnnn` | Blocked by that task. |

There is no `api`, `web` or `infra` task: the spec's GraphQL delta and data model are **None**, and
the worker already reaches Redis.

## Tasks

### Group 1 — the store

- [x] **T001** `[worker]` Per `worker/plan.md` step 1: create `src/encode/verdict-store.ts` (install,
      `fileIdentity`, `readVerdict`, `writeVerdict`, the kind list with `audio-variant` reserved for
      `110`) and `src/encode/verdict-store.spec.ts` with the cases in § Tests (reject, never-answers,
      unparsable, 30-day expiry on every write, nothing installed, `null` identity, key-order
      stability).
      *Done when:* `bin/npm worker test -- verdict-store` passes and
      `bin/cli worker npx --no tsc --noEmit` is clean.
- [x] **T002** `[worker]` Per step 2: in `src/index.ts`, build a dedicated fail-fast ioredis client
      from the existing `connection` (offline queue off, no per-request retries, a command timeout of
      a few seconds, option names checked against the installed `ioredis` ^6), install it before the
      encode `Worker` is constructed, and `quit()` it in the shutdown path. → T001
      *Done when:* typecheck is clean, and with the dev stack up `docker compose logs worker` shows a
      normal boot (lease, `encodeWorkerStarted`, the workers) with no Redis error.

### Group 2 — the resolvers and the disc assembly

Each task replaces one cache with the store and owns its own spec file. They touch different files
and depend only on T001.

- [x] **T003** `[worker] [P]` Per step 3: `src/encode/grain-mode.ts` reads and writes kind `grain`
      by `mediaSourceId`; delete `resetGrainVerdictCache`; update `grain-mode.spec.ts` to a fresh
      in-memory store per test, with hit, cancellation-stores-nothing and failure-stores-nothing
      cases. → T001
      *Done when:* `bin/npm worker test -- grain-mode` passes and no file references
      `resetGrainVerdictCache`.
- [x] **T004** `[worker] [P]` Per step 4: `src/encode/dub-trim.ts` uses kind `dubtrim` keyed by
      `fileIdentity(input)`, logs `(reused)` on a hit; delete `resetDubTrimCache`; spec cases: hit
      skips `freezedetect`, changed size or mtime misses, failure and cancellation store nothing.
      → T001
      *Done when:* `bin/npm worker test -- dub-trim` passes.
- [x] **T005** `[worker] [P]` Per step 5: `src/encode/stream-end-trim.ts` gains a lookup and write of
      kind `streamtrim` keyed by file + video index + sorted kept audio indices, logs `(reused)` on a
      hit, stores the out-of-window keep; spec cases include a miss when a `110` resolution changes
      the kept set. → T001
      *Done when:* `bin/npm worker test -- stream-end-trim` passes.
- [x] **T006** `[worker] [P]` Per step 6: `src/encode/subtitle-prune.ts` uses kind `subs` keyed by
      file + sorted qualifying stream indices, logs `[subs] reused drops=[…]` on a hit; delete
      `resetSubtitlePruneCache`; spec cases include a miss when a qualifying group changes (REQ-4).
      → T001
      *Done when:* `bin/npm worker test -- subtitle-prune` passes.
- [x] **T007** `[worker] [P]` Per step 7: `src/disc/assemble-playlist.ts` reuses an assembled file
      whose size and `mtimeMs` match the `assembly` record for the playlist, logs `[disc] reused`,
      and records the output after a successful `mkvmerge`; spec cases: no record → reassembled,
      different size → reassembled, match → `mkvmerge` not spawned, failed or cancelled `mkvmerge` →
      no record. → T001
      *Done when:* `bin/npm worker test -- assemble-playlist` passes.
- [x] **T008** `[worker]` Per step 8: `src/jobs/encode.job.ts`'s `finally` removes the assembled file
      only after a delivered compressed encode; `encode.job.spec.ts` asserts it survives a stop, a
      cancellation and a failure. → T007
      *Done when:* `bin/npm worker test -- encode.job` passes, then the whole gate:
      `bin/cli worker npx --no tsc --noEmit`, `bin/npm worker test` and `bin/comments worker` all
      green.

### Group 3 — verification and docs

- [x] **T009** `[docs]` Update `services/worker/CLAUDE.md`: the four resolver sections (grain, dub
      trim, stream-end trim, subtitle pruning) describe the Redis store instead of an in-memory
      `Map` (and stream-end no longer "has no cache"); the `100` section says a completed assembly is
      kept and reused; add `src/encode/verdict-store.ts` to the layout; check the Known debt ioredis line against the installed 5.11.1 (T002 found ^5 is right; leave it)
      that still says `ioredis ^5`. Update the root `CLAUDE.md` Transcode row with a "Since `111`"
      sentence (verdicts and a completed Blu-ray assembly survive a worker restart; FFmpeg itself
      still restarts from 0%). → T002, T003, T004, T005, T006, T008
      *Done when:* `grep -n "module-level .Map\|There is no cache" services/worker/CLAUDE.md` finds
      nothing about these four resolvers, and the root row names `111`.
- [ ] **T010** `[docs]` Live pass, per `plan.md` § Verification steps 1–8, with `ENCODE_DRIVER=ffmpeg`
      and the three settings on: AC-3 (Stop/Play), AC-4 (`--scan` and `TTL`), AC-1 (worker restart),
      AC-2 (host reboot), AC-5 (subtitle selection change), AC-6/AC-7 (Blu-ray reuse and partial
      assembly), AC-9 (no `.perceptor.mkv` left after delete, discard, delivery). AC-8 is T001's and
      T003–T006's tests. → T008
      *Done when:* each AC's observed log lines or command output are recorded in this file under
      a "Live pass" note, or the AC is moved to `## Blocked` with what is missing (for example, no
      Blu-ray source at hand).
- [x] **T011** `[docs]` Walk the acceptance criteria in `spec.md`, tick each verified box, set
      `status: Implemented` on `spec.md`, `plan.md` and `worker/plan.md`, set this file to `Done`,
      and in `110-audio-variant-detection/tasks.md` update the T009 row of `## Blocked` to say `111`
      is implemented and its seams can be filled. Then `/pending-acs`. → T009, T010
      *Done when:* `bin/pending-acs --check` exits 0 and `110`'s Blocked row no longer says the store
      does not exist.

## Blocked

| Task | Service | What blocked it | Needs |
| :-- | :-- | :-- | :-- |
| T010 | docs | The live pass needs a real film encode driven through the UI (Stop/Play, a worker restart, a host reboot, a Blu-ray source). It was not run in this session | A person with the dev stack and a real source runs `plan.md` § Verification steps 1–6 and 8, then ticks AC-1…AC-7 and AC-9 |
