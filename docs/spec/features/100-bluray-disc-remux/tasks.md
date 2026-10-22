---
title: Blu-ray Disc Remux — Tasks
last_updated: 2026-10-21
status: Done
---

# TASKS: Blu-ray Disc Remux (`tasks.md`)

## Legend

| Marker | Meaning |
| :-- | :-- |
| `[api]` `[web]` `[worker]` `[infra]` | Which subagent owns the task. Exactly one per task — a task that needs two services is two tasks. |
| `[docs]` | Documentation and measurement only. Owned by the orchestrator, not a service agent. |
| `[P]` | May run in parallel with the other `[P]` tasks in the same group. |
| `→ Tnnn` | Blocked by that task. |
| `[x]` `[~]` | `[~]` = implemented, awaiting a manual run by the maintainer (testing). |

No `[api]` task: `api` stores both new keys verbatim through the existing `sourceScanFailed` /
`encodeFailed` and needs no change (`plan.md` § Approach). No `[infra]` task: `mkvmerge` is already
in the `worker` image's `base` stage (NFR-3).

## Tasks

### Group 1 — keys and pure rules, in parallel

The contract is two key strings and their params, frozen in `spec.md` (Article VIII). Nothing here
produces GraphQL, so `web` and `worker` start together. An agent that finds the delta wrong stops
and files a row under **Blocked**.

- [~] **T001** `[web] [P]` Per `web/plan.md`: add `errors.source.disc_playlist_ambiguous` and
      `errors.encode.disc_remux_failed` to `services/web/messages/en.json` and `es.json` with the
      exact strings and the `{playlists}` / `{code}` / `{stderr}` placeholders.
      *Done when:* `bin/cli web node scripts/check-messages.mjs` reports parity and
      `bin/npm web run lint` passes.
- [x] **T002** `[worker] [P]` Per `worker/plan.md` step 1: add `ERROR_SOURCE_DISC_PLAYLIST_AMBIGUOUS`
      and `ERROR_ENCODE_DISC_REMUX_FAILED` to `src/i18n/error-keys.ts` and their English renderings
      to `src/i18n/messages.en.ts`.
      *Done when:* `messages.en.spec.ts` (extended) renders both with their params and
      `bin/npm worker test` is green.
- [x] **T003** `[worker] [P]` Per step 2: `src/disc/mpls.ts` (`parseMpls`) and
      `src/disc/mpls.spec.ts`. The spec builds synthetic buffers with a test-local writer and covers:
      - item order and 45 kHz ticks;
      - a repeated clip;
      - counting entry marks by `mark_type`;
      - a bad magic and a truncated buffer, both of which throw.
      *Done when:* `bin/npm worker test -- src/disc/mpls.spec.ts` passes.
- [x] **T004** `[worker] [P]` Per step 3: `src/disc/select-playlist.ts` and its spec. Cover:
      - the longest playlist wins;
      - an unplayable or not-downloaded playlist is dropped;
      - a loop is dropped even when it is the longest and has marks (AC-15);
      - a tie goes to the playlist with marks (AC-11), then to the one with the most marks;
      - a remaining tie is `ambiguous` with sorted names (AC-13);
      - everything dropped gives `none`;
      - the 1 s window boundary.
      *Done when:* that spec passes.
- [x] **T005** `[worker] [P]` Per step 4: `src/disc/find-disc.ts` and its spec. Cover:
      - a nested root;
      - `BDMV/BACKUP` ignored;
      - two roots reported as two;
      - loose `.m2ts` with no `BDMV` is not a disc (AC-8).
      *Done when:* that spec passes.
- [x] **T006** `[worker] [P]` Per step 7: widen `CaptureOptions.binary` in `src/ffmpeg/capture.ts` to
      accept `'mkvmerge'`.
      *Done when:* `bin/cli worker npx --no tsc --noEmit` is clean and the existing dub-trim and
      stream-end-trim specs still pass.

### Group 2 — scan and assembly

- [x] **T007** `[worker]` Per step 5: `src/disc/scan-disc.ts` and its spec, applying the flag table
      for `match`, `none` and `ambiguous`. A playlist that fails to parse is unplayable; it never
      fails the scan.
      *Done when:* the spec asserts the following and passes:
      - `match` with a sibling `sample.mkv`: only the `.mpls` has `isVideo: true` (AC-12, REQ-4);
      - `none` with an undownloaded clip: the `.m2ts` files have `isVideo: true` and no matches
        (AC-7);
      - `ambiguous` throws the key with `playlists` (AC-13).
      → T002, T003, T004, T005
- [x] **T008** `[worker]` Per step 6: route a film source with exactly one disc root through
      `scan-disc.ts` in `src/jobs/source-ready.job.ts` and add the `[source-ready] … disc` log line.
      Episodes, seasons, multi-disc releases and releases with no disc keep the existing path.
      *Done when:* `source-ready.job.spec.ts` (new or extended) shows:
      - an episode with a `BDMV` tree takes the ordinary path;
      - a film disc reports one `.mpls` match through `sourceScanned`;
      - an ambiguous disc reaches `sourceScanFailed` with `error.source.disc_playlist_ambiguous`;
      - `scan-folder.spec.ts` and `select-matches.spec.ts` pass unchanged (NFR-4).
      → T007
- [x] **T009** `[worker] [P]` Per step 8: `src/disc/assemble-playlist.ts` and its spec, with capture
      mocked.
      *Done when:* the spec covers the following and passes:
      - exit `1` with the file present is success;
      - exit `2` throws `disc_remux_failed` with a non-empty `stderr` taken from stdout, and the
        partial is removed;
      - abort rethrows `EncodeCancelledError` and removes the partial;
      - a leftover is removed before the run;
      - the path is `<disc root>/<playlist>.perceptor.mkv`.
      → T002, T006
- [x] **T010** `[worker]` Per step 9: in `src/jobs/encode.job.ts`, assemble a `.mpls` input after
      `encodeStarted` and before the compression branch, and pass the assembled path to the
      `isInsideRoot` check, `withSourceExtension`, `passthrough` and `encode`. Keep the playlist for
      `buildSourceTag` and `cleanupSource`. Remove the assembled file in a guarded `finally`.
      *Done when:* `encode.job.spec.ts` shows the following and `bin/npm worker test` is fully
      green:
      - both branches receive the assembled path;
      - the source tag still names the playlist;
      - the file is removed after a compression-on success and after a failure, and is not
        touched after a passthrough move;
      - an assembly failure reports `encodeFailed` with `error.encode.disc_remux_failed`;
      - a non-`.mpls` input never calls the assembler.
      → T008, T009
- [x] **T011** `[worker]` Run the slice gate.
      *Done when:* all three of these pass with no change to the `ffmpeg/` case corpus:
      - `bin/cli worker npx --no tsc --noEmit`
      - `bin/npm worker test`
      - `bin/comments worker`
      → T010

### Group 3 — verification and docs

- [x] **T012** `[docs]` Update `docs/spec/graphql-contract.md` § UI internationalization: add
      `error.source.disc_playlist_ambiguous` and `error.encode.disc_remux_failed` to the worker
      rows, with their params and a `100-bluray-disc-remux` reference. → T011
- [x] **T013** `[docs]` Update the docs:
      - `services/worker/CLAUDE.md`: a `src/disc/` entry in Layout and a section on disc
        recognition, playlist selection, the assembled file's lifecycle and the `mkvmerge` exit-code
        rule;
      - the root `CLAUDE.md` pipeline table: the Scan and Transcode rows gain a `Since 100` sentence
        and `100` in their spec refs;
      - a `docs/spec/history.md` entry with the re-measured test counts.
      → T011
- [~] **T014** `[docs]` Manual pass on a real unencrypted BDMV film (`plan.md` § Verification, steps
      1–8). Step 1 adds its `.mpls` files to `services/worker/fixtures/bdmv/` and a selector test
      over them. This reaches AC-1 to AC-10 and AC-14, plus AC-11, AC-12, AC-13 and AC-15 where a
      disc with decoys, a loop or a sample is at hand. Any AC with no disc available stays `[~]`
      and is named in `docs/spec/pending-acs.md` with "needs a disc of that kind" as its blocker.
      → T001, T011
- [x] **T015** `[docs]` Walk every acceptance criterion in `spec.md` and tick the ones T004, T005,
      T007–T011 and T014 proved; AC-16 is ticked by T011. Then set `status: Implemented` on
      `spec.md`, `plan.md`, `worker/plan.md` and `web/plan.md`, and `status: Done` here, and run
      `bin/pending-acs`.
      → T012, T013, T014

## Blocked

| Task | Service | What blocked it | Needs |
| :-- | :-- | :-- | :-- |
