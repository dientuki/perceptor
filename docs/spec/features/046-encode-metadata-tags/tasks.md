---
title: Encode Metadata Tags — Tasks
last_updated: 2026-09-04
status: Done
---

# TASKS: Encode Metadata Tags (`tasks.md`)

## Legend

| Marker | Meaning |
| :-- | :-- |
| `[worker]` `[ffmpeg]` | Which subagent owns the task. Exactly one per task. |
| `[docs]` | Documentation only. Owned by the orchestrator, not a service agent. |
| `[P]` | May run in parallel with the other `[P]` tasks in the same group. |
| `→ Tnnn` | Blocked by that task. |

**On `[ffmpeg]`.** `services:` is `[worker]` and every file in this feature lives under
`services/worker/`, but two directories inside it — `services/worker/src/ffmpeg/` and the case
corpus `services/worker/ffmpeg/` — belong to the `ffmpeg` agent, not the `worker` agent
(`services/worker/CLAUDE.md`, `.claude/agents/ffmpeg.md`). T003 is tagged `[ffmpeg]` so it
dispatches to that agent. Tagging it `[worker]` would send the `worker` agent into a directory its
own brief tells it to stop at, which is the boundary this tag vocabulary exists to protect.

No `[api]` task exists, and none may be added: `spec.md` § GraphQL Contract Delta is **None** and
`worker/plan.md` § Contract obligations makes "do not add a field to the `processJob(id)` query" the
one obligation of this feature. No `[web]` and no `[infra]` task — nothing renders these tags and
nothing about the stack's boot, wiring or `bin/` wrappers changes. No migration (`plan.md`
§ Migrations is **None**).

## Tasks

### Group 1 — the string rules

The whole feature stands on this task: both values are pure functions, and every way they can be
wrong is silent (`plan.md` § Risks).

- [x] **T001** `[worker]` Create `services/worker/src/metadata/container-tags.ts` with a local input
      type (following `src/paths/build-output-path.ts`'s `OutputPathInput`, not an import of
      `EncodeJobDetails`) exporting `buildContainerTitle` and `buildSourceTag` per `worker/plan.md`
      § Steps 1. `buildSourceTag` reuses `src/paths/is-inside-root.ts` — do not write a second
      containment check. No sanitization anywhere in the file: `sanitize()` from
      `build-output-path.ts` must **not** be reused (`plan.md` § Contract Freeze). Write
      `container-tags.spec.ts` alongside it, opening with the Article IX header naming the silent
      failure, English `it(...)` strings, covering the five cases in `worker/plan.md` § Tests.
      *Done when:* `bin/npm worker test -- container-tags` is green and its cases show
      `buildContainerTitle` returning `The Martian` verbatim for a film **(AC-1)**, `The Boys S05-E07
      The Frenchman, the Female, and the Man Called Mother's Milk` for an episode with commas and
      apostrophe intact **(AC-2)**, `The Boys S05-E07` with no trailing separator when
      `episodeTitle` is `null` **(AC-3)**, `buildSourceTag` returning
      `Some.Release-GRP/Some.Release-GRP.mkv` for an input under `/downloads` **(AC-4)**, and a base
      name containing no `/` when the input lies outside `downloadsRoot` **(AC-5)**.

### Group 2 — carry the values to the driver

- [x] **T002** `[worker]` Add `containerTitle: string` and `sourceTag: string` to `EncodeInput`
      (`services/worker/src/encode/types.ts`) — **required, not optional**, per `plan.md` § Risks —
      and populate both from `container-tags.ts` at the **two** call-site literals in
      `src/jobs/encode.job.ts`: the `passthrough(...)` call and the `encode(...)` call. Do not touch
      `src/encode/passthrough.ts`: it keeps ignoring `details` entirely, which is how NFR-1 holds.
      → T001
      *Done when:* `bin/cli worker npx --no tsc --noEmit` reports 0 errors — which is what proves
      both literals were reached — and `grep -n "containerTitle\|sourceTag"
      services/worker/src/encode/passthrough.ts` returns nothing, with `bin/npm worker test` green,
      showing the passthrough suite unchanged and still asserting the moved file is untouched
      **(AC-6)**.

### Group 3 — the FFmpeg arguments and the corpus

One task, not two: `cases.spec.ts` asserts the whole ordered argument array, so the moment
`buildCommand.ts` appends anything, both JSON cases are red until they are updated. Splitting this
leaves the suite failing between two tasks.

- [x] **T003** `[ffmpeg]` In `services/worker/src/ffmpeg/buildCommand.ts`, append
      `"-metadata", \`title=${details.containerTitle}\`` and
      `"-metadata", \`PERCEPTOR_SOURCE=${details.sourceTag}\`` immediately after the existing
      `"-map_metadata:g", "-1"` entries and before the `ENCODE_SAMPLE_SECONDS` block — the position
      is load-bearing (`plan.md` § Risks: appended before the strip, the tags vanish and FFmpeg still
      exits 0). Widen `CaseInput` and `validate()` in `src/ffmpeg/cases.spec.ts` to require the two
      new `input` fields, then add those fields and the two expected argument pairs to
      `services/worker/ffmpeg/1.json` and `2.json`. Change no track-selection rule. → T002
      *Done when:* `bin/npm worker test -- cases` is green with both corpus cases asserting the two
      argument pairs at the pinned position. `2.json` carries a pre-existing, unrelated failure
      recorded in the root `CLAUDE.md` (a stale expected track-title string, since
      `039-per-title-language-split`) — confirm at `HEAD` whether it is still present, report it
      either way, and do not fix it here.

### Group 4 — verification and docs

- [x] **T004** `[docs]` Update `services/worker/CLAUDE.md`: `src/metadata/` joins the layout map,
      and the encode-driver-seam section records that `EncodeInput` now also carries two resolved
      container tags composed outside `src/ffmpeg/`. Update the root `CLAUDE.md` Transcode row to
      name the tags written into the output, and refresh the § Current state counts with the real
      numbers from T005. The Transcode stage does not change status. → T003
      *Done when:* both files name `src/metadata/container-tags.ts` and neither claims a test count
      that was not re-measured.

- [x] **T005** `[docs]` Run the full gate and walk the acceptance criteria in `spec.md`: tick each
      box, then set `status: Implemented` on `spec.md`, `plan.md` and `worker/plan.md`, and
      `status: Done` on this file. → T003
      *Done when:* `bin/cli worker npx --no tsc --noEmit` reports 0 errors, `bin/npm worker run
      build` exits 0 and `bin/npm worker test` is green with a higher test count than the
      pre-feature baseline, all three counts reported for real **(AC-7)**; and AC-1 to AC-6 are each
      ticked against the task that proves them.

**Manual pass** (not a task — it needs a real encode and a real library, so it belongs to the user,
per `plan.md` § Verification): encode a film and an episode with compression on, confirm the two
tags in the command from `docker compose logs -f worker`, `ffprobe` the file that lands in the
library to see both tags survived the `mkvmerge` remux, then turn `compression_enabled` off and
confirm the moved file carries neither.

## Blocked

| Task | Service | What blocked it | Needs |
| :-- | :-- | :-- | :-- |
