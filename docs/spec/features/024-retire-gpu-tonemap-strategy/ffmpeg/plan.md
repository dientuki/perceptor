---
title: Retire the GPU Tonemap Strategy — ffmpeg slice
service: ffmpeg
last_updated: 2026-08-25
status: Approved
---

# PLAN: Retire the GPU Tonemap Strategy — `ffmpeg` (`ffmpeg/plan.md`)

## Scope

You remove every trace of the Vulkan/tonemap decision from the rules and the corpus you own: the
probe module, the two filter constants, the `vulkanAvailable` parameter on both `getVideoParams`
and `buildFfmpegCommand`, and the assertions that tested the removed decision. You then retire the
seven versioned corpus cases and promote `8.json` to be the corpus (REQ-8) — in that order, because
the retired cases' probes are the evidence that the rest of the slice broke nothing.

You are **not** changing what any encode produces. This slice is pure subtraction around a decision
nobody makes any more; the arguments the worker emits for every source must come out byte-identical
(`../plan.md` § Risks, first row). You are also not touching the call sites in
`src/encode/encode.ffmpeg.ts` and `src/index.ts` — they are the `worker` agent's, land immediately
after you, and are why the typecheck is red between the two slices **by design**.

Writes are confined to `services/worker/src/ffmpeg/`, `services/worker/ffmpeg/` and this directory.
`.claude/agents/ffmpeg.md` is **not** yours even though it is your rule document — its stale V3 rule
is a `[docs]` task. Anything else is a stop-and-report.

## Files

| File | New / Modified | What changes |
| :-- | :-- | :-- |
| `services/worker/src/ffmpeg/vulkan.ts` | **Deleted** | The whole probe: `probeVulkan`, `isVulkanAvailable`, the memo, the software-rasterizer list, the `USE_GPU` parse. |
| `services/worker/src/ffmpeg/vulkan.spec.ts` | **Deleted** | Its 10 tests all cover the deleted module. |
| `services/worker/src/ffmpeg/params.ts` | Modified | Drop `SOFTWARE_TONEMAP_VF` (`:33`) and `GPU_TONEMAP_VF` (`:42`) with their comment block (`:23-32`); drop the `vulkanAvailable` parameter (`:51`); delete the orphaned `// REQ-6`/`// REQ-7` comments inside the HDR branch (`:137-139`, `:146-147`). |
| `services/worker/src/ffmpeg/buildCommand.ts` | Modified | Drop the `vulkanAvailable` parameter (`:26`) and stop forwarding it to `getVideoParams` (`:53`). |
| `services/worker/src/ffmpeg/params.spec.ts` | Modified | Delete the whole `getVideoParams — 4K HDR tonemap branches (017-worker-gpu-strategy)` describe block (`:226-309`), including its file-level comment header. Nothing else in the file changes. |
| `services/worker/src/ffmpeg/buildCommand.spec.ts` | Modified | Delete the `threads the vulkanAvailable argument through to getVideoParams` test (`:163-198`). Drop the now-extra argument from the five surviving `buildFfmpegCommand(...)` calls. |
| `services/worker/src/ffmpeg/cases.spec.ts` | Modified | Drop `vulkanAvailable` from the `CaseInput` type (`:27`), from the destructuring (`:66`), from the validator (`:81-83`) and from the `buildFfmpegCommand` call (`:176`). |
| `services/worker/ffmpeg/{1..7}.json` | **Deleted** | Retired wholesale (REQ-8) — all seven predate `8d9572d`, all carry the removed flag, three carry stale expectations, and `6.json` is `1.json` with the flag flipped. **Deleted in step 7, after the AC-4 diff has used their probes.** |
| `services/worker/ffmpeg/8.json` | Modified, then **tracked** | **Untracked in git today** — a new case in the working tree, written against the shipped behaviour. Remove its `"vulkanAvailable": true` line and `git add` it: it becomes the corpus's only case and its worked example. Enumerate the corpus from the directory, never from `git ls-files`. |

## Existing code to reuse

Nothing is added here, so the obligation inverts: these are the things you keep exactly as they are.

- `services/worker/src/ffmpeg/params.ts:45` — `HDR_DOWNSCALE_VF`. This is the **shipped** policy from
  commit `8d9572d`, not a leftover of the tonemap work. It stays, as do the four colour tags
  (`-color_range tv`, `-colorspace bt2020nc`, `-color_primaries bt2020`, `-color_trc smpte2084`) on
  the HDR branch and the `bt709` set on the SDR branch.
- `services/worker/src/ffmpeg/cases.spec.ts:40-141` — the validator, `loadCases()`, the module-scope
  load and the empty-directory guard. You remove one field's check from `validate()`; the structure
  that makes this suite unable to report green while running fewer cases than the directory holds is
  not yours to simplify.
- `services/worker/src/ffmpeg/params.spec.ts` — the `videoStream(...)`/`audioStream(...)` factories
  and the file's Article IX header. Only the `017` describe block goes; the `fre`/`fra` coverage and
  everything else stays.

## Steps

1. Delete `src/ffmpeg/vulkan.ts` and `src/ffmpeg/vulkan.spec.ts`.
2. `src/ffmpeg/params.ts`: remove both filter constants and the comment block above them, remove the
   `vulkanAvailable` parameter from `getVideoParams`, and delete the two orphaned `REQ-` comments
   inside the HDR branch. **Do not otherwise touch the branch bodies.** Every returned array must be
   character-for-character what it is now.
3. `src/ffmpeg/buildCommand.ts`: remove the parameter and the forwarded argument.
4. `src/ffmpeg/cases.spec.ts` **and every JSON in `services/worker/ffmpeg/` in the same change** —
   the validator hard-requires the field (`:81-83`), so splitting these two edits fails the suite at
   collection rather than at an assertion (`../plan.md` § Risks). Strip `input.vulkanAvailable` from
   all eight files, `8.json` included. Do **not** delete anything yet.
5. Correct the stale `ffmpeg` expectation in `1.json`, `3.json` and `4.json`. Their arrays still
   carry the tonemap `-vf` and the `Tonemapped from 4K …` title from before `8d9572d`. Take the
   corrected array from what the code **now** produces — verified against the step 0 baseline in
   `../plan.md` § Verification, not retyped by hand. This is throwaway work on files that will be
   deleted in step 7, and it is not optional: a green suite over all eight cases is what proves the
   cleanup changed no encode, and it is the last moment the evidence exists.
6. `src/ffmpeg/params.spec.ts` and `src/ffmpeg/buildCommand.spec.ts`: delete the two blocks named in
   § Files and drop the extra argument from the surviving `buildFfmpegCommand` calls.
7. **After** the orchestrator confirms the AC-4 diff is clean and the suite is green over all eight
   cases: `git rm services/worker/ffmpeg/{1,2,3,4,5,6,7}.json` and `git add
   services/worker/ffmpeg/8.json` (REQ-8). Re-run `bin/npm worker test` — `ffmpeg cases` must now
   report exactly one test, and `loadCases()` must still be the code that would throw on an empty
   directory. Do not weaken the runner to accommodate a smaller corpus.

## Contract obligations

`../spec.md` § GraphQL Contract Delta is **None** — this slice consumes no GraphQL and owes nothing
across the service boundary. The one contract you do owe is internal and has no compiler behind it
either: `buildFfmpegCommand`'s signature is called from `src/encode/encode.ffmpeg.ts`, which is the
`worker` agent's file and changes in the step immediately after yours. Do not edit that call site,
and do not add a default value to the parameter to keep it compiling — a defaulted parameter would
let the worker slice be silently skipped and leave the flag threaded through forever.

## Tests

Article IX cuts both ways here: this slice's job is to remove tests that defend a decision that no
longer exists, while leaving intact the ones that defend what an encode produces.

- `src/ffmpeg/vulkan.spec.ts` — **deleted**. It tests `probeVulkan`'s `USE_GPU` parse and its
  failure-to-CPU degradation. With no probe, there is no silent failure left to defend.
- `src/ffmpeg/params.spec.ts`'s `017` block — **deleted**. It asserts which of two tonemap chains is
  emitted. One code path, no filter, nothing to get wrong.
- `src/ffmpeg/buildCommand.spec.ts`'s threading test — **deleted**. It asserts a parameter reaches a
  function; the parameter is gone.
- `src/ffmpeg/cases.spec.ts` — **the runner is kept and load-bearing; its corpus is deliberately
  reduced to one.** The runner asserts the complete ordered argument array against the verbatim
  `ffprobe` of a real file, and that is what catches the failure this slice can actually cause: a
  tidy-up that quietly changes an encode, where FFmpeg exits 0, the job reports `COMPLETED`, and the
  wrong file lands in the library. Steps 4–6 keep all eight cases green precisely so that guarantee
  holds *while the risky edits happen*; step 7 then retires seven of them on the owner's decision
  (REQ-8). Do not touch `loadCases()`, the module-scope load or the empty-directory guard to suit a
  one-case corpus — those are what stop the suite reporting green while running nothing.

**No new test is owed.** A removal that changes no behaviour is proven by the corpus going green
against corrected expectations plus the `../plan.md` AC-4 byte diff, both over all eight cases,
before any is retired. Writing a test that asserts an absence — "no argument contains `libplacebo`"
— would be a test of the diff, not of the code, and Article X says no.

**What this slice knowingly gives up** belongs in your report, not silently in the diff: after step
7 the repository has no assertion covering 4K DoVi remux audio selection, English SDH exclusion, the
HEVC-1080p copy rule (V5) or the `throws` case. Say so when you report, so the follow-up to re-earn
that coverage with fresh probes is raised rather than assumed.

## Done when

Before step 7, with all eight cases still present:

```bash
bin/npm worker test
```

Expected: green, **8** cases in `ffmpeg cases`, and the total down from 13 files/117 tests — never
up. After step 7:

```bash
bin/npm worker test
git status --short services/worker/ffmpeg/
```

Expected: green with exactly **1** case in `ffmpeg cases`, and `services/worker/ffmpeg/` holding
`8.json` alone, tracked.

The typecheck below only passes once the `worker` slice has landed too — see `../plan.md` § Order of
Work. A red `tsc` reporting that `encode.ffmpeg.ts` passes 5 arguments to a 4-argument function is
the **expected** intermediate state, not a failure to report:

```bash
bin/cli worker npx --no tsc --noEmit
```
