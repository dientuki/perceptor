---
title: SD MPEG-2 encode and Opus audio copy — Tasks
last_updated: 2026-10-31
status: Done
---

# TASKS: SD MPEG-2 encode and Opus audio copy (`tasks.md`)

## Legend

| Marker | Meaning |
| :-- | :-- |
| `[worker]` | Owned by a worker-side subagent. Every `[worker]` task here touches `src/ffmpeg/`, `ffmpeg/` or `.claude/agents/ffmpeg.md`, so `/implement` dispatches it to the **`ffmpeg`** agent (`.claude/agents/ffmpeg.md`), not the general `worker` agent. |
| `[docs]` | Documentation and the manual pass. Owned by the orchestrator, not a service agent. |
| `[P]` | May run in parallel with the other `[P]` tasks in the same group. None here: every code task edits `src/ffmpeg/params.ts`. |
| `→ Tnnn` | Blocked by that task. |
| `[x]` `[~]` | `[~]` = implemented, awaiting a manual run by the maintainer. |

**Measuring.** The stack running on this host is the end-user install, not this checkout, so
`bin/cli`/`bin/npm` may find no container. When they do not, run each *Done when* command through
the throwaway container described in memory (`measuring-without-dev-stack`):

```bash
docker run --rm --user 1000:1000 -v "$PWD/services/worker":/app -w /app -e HOME=/tmp node:24.18.0-alpine sh -c '<command>'
```

Report which form was used.

**Governance.** The `ffmpeg` agent never does a refactor and a rule change in one step, and never
edits an older corpus case to turn the suite green. A changed older case is a rule conflict: stop
and put it under **Blocked**.

## Tasks

### Group 1 — the case, red

- [x] **T001** `[worker]` Add `services/worker/ffmpeg/6.json` from
      `docs/spec/features/115-sd-mpeg2-encode/A1_t00.ffprobe.json`, with the `ffprobe` verbatim.
      Use the input proposed in `worker/plan.md` step 1 (`fre` audio, subtitles and original
      language, `LIVE_ACTION`, `1080p`, `allowedSubtitleFormats` including `vobsub`) and the
      expected argv from that same step. **Show the user the command and your reading of it, and
      freeze nothing until the user confirms the input and the argv.**
      *Done when:* the user has confirmed, and `npx vitest run src/ffmpeg/cases.spec.ts` shows
      `6.json` failing because its video is `-c:v copy` / `Video (Direct Copy)`, with cases 1–5
      still passing.

### Group 2 — video rules

Each task in this group extends `getVideoParams` through the existing `buildAv1EncodeArgs` seam
(`worker/plan.md` § Existing code to reuse) and adds its synthetic cases to `params.spec.ts`.

- [x] **T002** `[worker]` Recognize MPEG-2 (REQ-1):
      - add `mpeg2video` to `RECOGNIZED_VIDEO_CODECS`;
      - add `'MPEG-2'` to `codecLabel`;
      - rewrite the existing "copies an unrecognized codec…" test with `mpeg4` (AC-5).
      → T001
      *Done when:* `params.spec.ts` passes, `mpeg4` is still copied with its warning, and an
      `mpeg2video` stream gets `libsvtav1` with title `AV1 (Converted from MPEG-2)`.
- [x] **T003** `[worker]` Deinterlace (REQ-2, REQ-3, REQ-4):
      - map `field_order` to a parity: `tt`/`bt` → `tff`, `bb`/`tb` → `bff`, anything else → none;
      - emit `bwdif=mode=send_frame:parity=<p>:deint=interlaced` as the first step of the filter
        chain, before the scale step;
      - add one test per `field_order` value, tests for `progressive`/`unknown`/absent producing
        no `-vf`, and the interlaced 576 under `480p` case.
      → T002
      *Done when:* the new `params.spec.ts` cases for AC-3, AC-4 and AC-6 pass, and cases 1–5
      are unchanged.
- [x] **T004** `[worker]` SD BT.601 colour set (REQ-5): a named predicate classifies the stream as
      PAL, NTSC or neither, with the tag sets and precedence in `worker/plan.md` step 4. HDR forms
      and every tagged-`bt709` or taller-than-576 source keep their current tags. Add the colour
      cases listed in `worker/plan.md` § Tests.
      → T003
      *Done when:* those cases pass and cases 1–5 are unchanged.
- [x] **T005** `[worker]` Anamorphic aspect (REQ-6): add `-aspect <display_aspect_ratio>` to the
      encode block only when `sample_aspect_ratio` is present and is not square (|SAR − 1| ≥ 1 %; `1:1`, `0:1` and roundings like `1385:1384` count as square). Add
      tests for SAR 64:45 (present) and SAR 1:1, 1385:1384 / no SAR (absent). Then re-run the corpus.
      → T004
      *Done when:* `npx vitest run src/ffmpeg/` is fully green, **`6.json` included** (AC-1), and
      no file under `services/worker/ffmpeg/` other than `6.json` appears in `git status` (AC-2).
      If an older case went red, stop: that is a rule conflict, and it goes under Blocked.

### Group 3 — audio rule

- [x] **T006** `[worker]` Refactor only. In `getAudioParams`'s per-track loop, separate the title
      and language arguments from the `libopus` encode arguments, with no behaviour change.
      → T005
      *Done when:* `npx vitest run src/ffmpeg/` is green with no test or case file edited by this
      task.
- [x] **T007** `[worker]` Opus copy (REQ-11, REQ-12): a selected `opus` stream gets
      `-c:a:<n> copy`, the generated title and the language tag, and no `-vbr`, `-b`, `-filter` or
      `-mapping_family`. `selectAudioStreams` is not touched. Add tests:
      - AC-7: Opus 5.1 titled `Surround 5.1`;
      - AC-8: Opus in one language and AC3 in another, checking the indices;
      - AC-9: Opus and AC3 in the same language;
      - Opus 7.1 and stereo titles.
      → T006
      *Done when:* those cases pass, and `npx vitest run src/ffmpeg/` plus
      `npx --no tsc --noEmit` are green.

### Group 4 — rule document

- [x] **T008** `[worker]` Amend `.claude/agents/ffmpeg.md` § Rules as `worker/plan.md` step 10
      lists:
      - V2, V3, V5 and V6 amended;
      - a new V7 for deinterlacing and the aspect;
      - a new A7 for the Opus copy;
      - `6.json` named as the case that forced these.
      Remove the V2 note calling the corpus stale only if it is no longer true.
      → T007
      *Done when:* each of REQ-1–REQ-6 and REQ-11 is stated in that file's own words, and
      `bin/comments worker` reports no violations for this feature's diff.

### Group 5 — verification and docs

- [~] **T009** (gate green; AC-10/AC-11 live pass pending: needs the checkout stack) `[docs]` Full gate, then the manual pass:
      - run `npx --no tsc --noEmit`, `npm test` and `bin/comments worker` for `worker`, and record
        the counts;
      - AC-10: import `A1_t00.mkv` and check the output's `ffprobe` (`av1`, progressive, `16:9`,
        `bt470bg`, video under 1.5 GiB) plus a panning shot;
      - AC-11: import the hand-built Opus MKV and check `-c:a:0 copy` in the recorded command and
        an identical Opus stream in the output.
      → T008
      *Done when:* the gate is green, and AC-10/AC-11 are ticked or left `[~]` with what is still
      missing.
- [x] **T010** `[docs]` Update the docs:
      - root `CLAUDE.md` pipeline table, Transcode row: `mpeg2video` in the recognized list,
        deinterlacing of interlaced sources, BT.601 tags for SD, Opus audio copied, and `115` in
        the specs column;
      - `services/worker/CLAUDE.md`, only if a module or convention it describes changed;
      - a new entry at the top of `docs/spec/history.md` with the T009 counts.
      → T009
      *Done when:* `grep -n "115" CLAUDE.md docs/spec/history.md` shows both entries.
- [x] **T011** `[docs]` Walk the acceptance criteria in `spec.md`:
      - tick each one that is verified, and leave each unverified one with its blocker named;
      - set `status: Implemented` on `spec.md`, `plan.md` and `worker/plan.md`, and
        `status: Done` here;
      - run `/pending-acs`.
      → T010
      *Done when:* `bin/pending-acs --check` exits 0.

## Blocked

| Task | Service | What blocked it | Needs |
| :-- | :-- | :-- | :-- |
| T005 | worker | Rule conflict with `1.json` (SAR 1385:1384) — resolved by the user: 1 % square tolerance, REQ-6 amended | — |
| T007 | worker | Rule conflict with `4.json`/`5.json` (all-Opus probes) — resolved by the user: audio lines re-frozen to the copy output | — |
