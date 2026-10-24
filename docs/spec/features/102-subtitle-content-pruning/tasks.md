---
title: Subtitle Content Pruning — Tasks
last_updated: 2026-10-24
status: In Progress
---

# TASKS: Subtitle Content Pruning (`tasks.md`)

## Legend

| Marker | Meaning |
| :-- | :-- |
| `[worker]` | Owned by a worker-side subagent. Exactly one tag per task. |
| `[docs]` | Documentation and measurement only. Owned by the orchestrator, not a service agent. |
| `[P]` | May run in parallel with the other `[P]` tasks in the same group. |
| `→ Tnnn` | Blocked by that task. |
| `[x]` `[~]` | `[~]` = implemented, awaiting a manual run by the maintainer (testing). |

Every code task is `[worker]` — the feature touches no other service. Inside it, two agents own two
territories (`worker/plan.md` § Scope): tasks marked **(ffmpeg)** touch `src/ffmpeg/`, the case
corpus `services/worker/ffmpeg/` or `.claude/agents/ffmpeg.md` and are dispatched to the `ffmpeg`
agent; tasks marked **(encode)** touch `src/encode/` and go to the `worker` agent. No `[infra]`
task: the extraction runs inside the existing `worker` image's `ffmpeg`.

The spec's GraphQL Contract Delta is **None** and frozen (Article VIII): a task that seems to need an
`api` field stops and files a row under **Blocked**.

## Tasks

### Group 1 — selection, rules and capture (ffmpeg territory)

T001, T004 and T005 touch disjoint files and may run together. T002 and T003 edit `params.ts` after
T001, one at a time.

- [x] **T001** `[worker] [P]` **(ffmpeg)** Per `worker/plan.md` step 1: extract S1–S5 from
      `getSubtitleParams` (`src/ffmpeg/params.ts`) into an exported
      `selectSubtitleStreams(subtitleStreams, allowedFormats, allowedLanguagesIso3,
      allowedLanguageTags)` returning `{ selected, commentary }` (`commentary` always `[]` in this
      task); `getSubtitleParams` calls it and keeps both of its existing `console.log`s. Export
      `isImageSubtitle`. Move-only otherwise.
      *Done when:* `bin/cli worker npx --no tsc --noEmit` and `bin/npm worker test` are green with
      `params.spec.ts`, `buildCommand.spec.ts`, `cases.spec.ts` and `variants.spec.ts` unmodified.
- [x] **T002** `[worker]` **(ffmpeg)** Per step 2: C0 — in `selectSubtitleStreams`' candidate
      filter, a stream with `disposition.comment === 1` or `titleMarks(stream, ['commentary'])`
      goes to `commentary` instead of the candidates, before S3 and whatever the track count
      (`// Spec 102, REQ-2`); `getSubtitleParams` logs `[subs] <index> drop (commentary)` per
      dropped stream. `params.spec.ts` gains the C0 cases from `worker/plan.md` § Tests
      (`comment` disposition; `Commentary with Director …` title; the only English track being a
      commentary → no English subtitle; `commentary` only inside another word → kept). → T001
      *Done when:* typecheck and `bin/npm worker test` green; the new cases pass and every
      pre-existing case is unchanged.
- [x] **T003** `[worker]` **(ffmpeg)** Per step 3: `getSubtitleParams(..., trackTitles,
      contentDrops: ReadonlySet<number>)` drops those indices from `selected` before mapping;
      `buildFfmpegCommand(..., trimAt, subtitleDrops: ReadonlySet<number>)` forwards it; both
      **required**. Every existing caller passes `new Set()` — the test files, the corpus runner, and
      `src/encode/encode.ffmpeg.ts` (a one-argument change so the tree compiles; T009 replaces it).
      Add the `params.spec.ts` case that `contentDrops` removes exactly those indices and renumbers
      `-c:s:N`/`-metadata:s:s:N`. → T002
      *Done when:* typecheck and `bin/npm worker test` green; `git diff --stat` shows
      `encode.ffmpeg.ts` changed by the one argument only.
- [x] **T004** `[worker] [P]` **(ffmpeg)** Per step 4: new `src/ffmpeg/subtitle-content.ts` (the six
      constants, `parseSrt`, `annotationShare`, `normalizeCueText`, `isSameTranslation`,
      `isContainedIn`, `pruneLanguage`, each with its `// Spec 102, REQ-n` locator) and
      `subtitle-content.spec.ts` with its Article IX header and every case listed in
      `worker/plan.md` § Tests. The five films come from `services/worker/fixtures/subtitle-content/`
      (scrambled real samples plus `manifest.json`, read like `fixtures/dub-trim/`), every
      `manifest.json` verdict asserted; boundaries are synthesised strings.
      *Done when:* typecheck and `bin/npm worker test` green; the spec file asserts every
      `manifest.json` track's `expect` through `pruneLanguage` and each "both kept" boundary;
      `grep -rc "Berk" services/worker/fixtures/subtitle-content/*/` prints only `0`s.
- [x] **T005** `[worker] [P]` **(ffmpeg)** Per step 5: `runFfmpegCapture` (`src/ffmpeg/capture.ts`)
      gains `CaptureOptions.extraOutputs?: number` — fds 3…3+n−1 opened as pipes, each drained
      concurrently under `CAPTURE_STDOUT_CAP_BYTES`, kill and reject past the cap on any of them —
      and `RunResult.outputs?: string[]`. No option → behaviour unchanged.
      *Done when:* typecheck and `bin/npm worker test` green with `grain-probe.spec.ts`,
      `dub-trim.spec.ts`, `stream-end-trim.spec.ts` and the `src/disc/` suites unmodified.
- [x] **T006** `[worker]` **(ffmpeg)** Add The Running Man (2025) source `ffprobe` (`ffprobe_logs`
      row 94 on the maintainer's install) as a corpus case under `services/worker/ffmpeg/`, **with
      the user**, per `.claude/agents/ffmpeg.md` § Adding a case: show the command and the reading
      (C0 drops `BTM Commentary`, S4 drops `BTM SDH`, one English and the requested Spanish track
      mapped), let the user correct, then write the JSON. → T003
      *Done when:* `bin/npm worker test` green with the new case counted by `cases.spec.ts`, and no
      other case modified.
- [x] **T007** `[worker]` **(ffmpeg)** Per step 8: `.claude/agents/ffmpeg.md` § Subtitles records C0
      beside S1–S3 and C1–C3 after S5 — thresholds, order, and the keep-on-doubt asymmetry — and
      narrows S6 to "whatever survives S1–S5 and C1–C3". → T002, T004
      *Done when:* the section names C0–C3 with the numbers in `spec.md` REQ-6/7/9, and
      `bin/comments worker` is green.

### Group 2 — the resolver (encode territory)

- [x] **T008** `[worker]` **(encode)** Per step 6: new `src/encode/subtitle-prune.ts`
      (`buildSubtitleSampleArgs`, `resolveSubtitlePruning`, the module-level verdict cache) and
      `subtitle-prune.spec.ts` with its Article IX header and the cases in `worker/plan.md` § Tests
      (`../ffmpeg/capture` mocked): no qualifying language → no spawn, no log; `-t 900` after each
      `-map`, never before `-i`; failure → empty set plus one failure line; cancellation propagates;
      success logs one line per group and is cached; failure not cached; candidate indices equal
      those `getSubtitleParams` maps for a multi-language, multi-variant input. → T001, T004, T005
      *Done when:* typecheck and `bin/npm worker test` green with every listed case present.
- [x] **T009** `[worker]` **(encode)** Per step 7: `src/encode/encode.ffmpeg.ts` awaits
      `resolveSubtitlePruning(details, input, metadata, signal)` after `resolveStreamEndTrim`
      (`// Spec 102, REQ-1`) and passes the set to `buildFfmpegCommand` in place of T003's
      `new Set()`. → T003, T008
      *Done when:* typecheck, `bin/npm worker test` and `bin/comments worker` green; the diff to
      `encode.ffmpeg.ts` is the import, the call and the argument.

### Group 3 — verification and docs

- [x] **T010** `[docs]` Measure: `bin/cli worker npx --no tsc --noEmit`, `bin/npm worker test`,
      `bin/comments worker` (or the throwaway `node:24.18.0-alpine` container as uid 1000, per
      `plan.md` § Verification, when this checkout's stack is not running); record suite and test
      counts. → T006, T007, T009
      *Done when:* all three green and the counts are written into T012's history entry. Covers
      AC-12.
- [ ] **T011** `[docs]` Manual pass per `plan.md` § Verification steps 1–5 on a stack running the
      new worker image: build the Dragon, Wake Up Dead Man and Atomic Blonde-shaped sources with
      `mkvmerge`, import them, read the outputs with `ffprobe` and the `[subs]` lines; the forced
      failure, the delete mid-read, and compression off. Maintainer-run; mark `[~]` until done.
      → T010
      *Done when:* AC-1, AC-2 (live, beside T006's offline case), AC-3, AC-9, AC-10 and AC-11 are
      observed as written; AC-4–AC-8 are additionally covered by T004/T008's unit cases.
- [x] **T012** `[docs]` Update the docs: the root `CLAUDE.md` pipeline table's **Transcode** row
      gains a `Since 102` sentence (C0 commentary drop; C1–C3 read a 900 s text sample of a language
      with more than one text track — SDH by content, same translation, contained track — always on
      with compression, failure keeps everything) and `102` in its spec list;
      `services/worker/CLAUDE.md` gains a section for the resolver beside `098`/`099` and lists
      `src/ffmpeg/subtitle-content.ts` / `src/encode/subtitle-prune.ts` in its layout; a new entry
      at the top of `docs/spec/history.md` with T010's measurements. → T010
      *Done when:* the three files name `102` and match the shipped behaviour; `bin/comments` green.
- [ ] **T013** `[docs]` Walk the acceptance criteria in `spec.md`, tick each box that was observed,
      leave AC-1/2/3/9/10/11 unticked with their blocker if T011 has not run; set
      `status: Implemented` on `spec.md`, `plan.md` and `worker/plan.md` once every box is ticked;
      run `/pending-acs`. → T011, T012
      *Done when:* `bin/pending-acs --check` exits 0.

## Blocked

| Task | Service | What blocked it | Needs |
| :-- | :-- | :-- | :-- |
