---
title: Retire the GPU Tonemap Strategy — Implementation Plan
spec_version: 0.1.0
last_updated: 2026-08-25
status: Implemented
---

# PLAN: Retire the GPU Tonemap Strategy (`plan.md`)

## Approach

This feature deletes. There is no new module, no new seam and no new abstraction — the shape of the
solution is the shape of `017` run backwards, and the only design question is what must **not**
move while it happens.

The one structural decision worth recording is the slice split, because it does not match the
spec's first reading. `services/worker/src/ffmpeg/` and `services/worker/ffmpeg/` are **not** the
`worker` agent's territory: `.claude/agents/worker.md` § Scope names both directories as belonging
to the `ffmpeg` agent and instructs the worker agent to stop and report rather than edit them.
Roughly nine tenths of this feature's deletion lives in exactly those two directories —
`vulkan.ts`, both filter constants in `params.ts`, the `vulkanAvailable` parameter on
`buildFfmpegCommand`, the three specs and the case corpus. Briefing the `worker` agent for that
work would guarantee a mid-feature stop-and-report. So `spec.md`'s `services:` list carries a third
entry, `ffmpeg`, and there is an `ffmpeg/plan.md` beside this file. `/tasks` must therefore emit an
`[ffmpeg]` tag, which `.claude/commands/tasks.md` does not list today — see § Risks.

What is being **reused** rather than invented: nothing is added, so the reuse obligation inverts
into a preservation obligation. `HDR_DOWNSCALE_VF` (`services/worker/src/ffmpeg/params.ts:45`) is
the constant the shipped policy uses and stays exactly as it is. The corpus **runner**
(`src/ffmpeg/cases.spec.ts`) keeps its validator, its module-scope loading and its empty-directory
guard — only the one field disappears from the `CaseInput` type and its check; the corpus's
*contents* are reset separately and deliberately (REQ-8), and shrinking it is never a reason to
loosen the runner. `params.spec.ts`
keeps its `videoStream(...)` factory and its file-level Article IX header; only the
`017`-titled `describe` block goes.

The alternative considered and rejected: adapting the six `getVideoParams` assertions to the new
command instead of deleting them. They exist to pin the difference between two tonemap chains; with
one code path and no filter to choose, they would assert the same thing `cases.spec.ts` already
asserts against real probes. Article X says delete, and the corpus is the stronger test.

## Order of Work

| Step | Service | Why it must come here |
| :-- | :-- | :-- |
| 0 | `orch` | Capture the AC-4 baseline **on current `HEAD`, before any edit** — the argument array `buildFfmpegCommand` produces for every corpus probe. Once the signature changes, the before-state is unrecoverable and NFR-1 becomes unprovable. |
| 1 | `ffmpeg` | Owns the `getVideoParams`/`buildFfmpegCommand` signature that step 2 calls. It also owns `vulkan.ts`, the module step 2's imports point at. |
| 2 | `worker` | Removes the two call sites (`encode/encode.ffmpeg.ts`, `index.ts`). Cannot compile against the old signature or the deleted module, so it follows step 1 directly. |
| 3 | `orch` | Run the AC-4 diff over all eight probes, then the typecheck/test gates. |
| 3b | `ffmpeg` | **Only after step 3's diff is clean**: retire `1.json`–`7.json` and `git add 8.json` (REQ-8). Deleting earlier would throw away the evidence step 3 needs. |
| 4 | `docs` | The `CLAUDE.md` files, `README.md`, `.claude/agents/ffmpeg.md`, and `017`'s already-set `Superseded` status. Last, so the test counts written down are the counts actually observed in step 3. |

**Steps 1 and 2 are one landing unit.** Whatever order they are applied in, there is a window where
the codebase does not typecheck: removing a parameter from a signature and removing it from its
call sites cannot be simultaneous. Do **not** run `bin/cli worker npx --no tsc --noEmit` between
them and do not treat a red typecheck after step 1 as a failure — the gate is meaningful only once
step 2 has landed. This is the one place in this feature where an implementer will otherwise report
a false failure.

**`infra` runs genuinely in parallel** with steps 1–2. Nothing under `bin/`, `docker-compose*.yaml`,
`.env.example` or `services/worker/Dockerfile` is typechecked, imported or tested by the TypeScript
gates, and no `infra` change alters an FFmpeg argument. It shares no file with either other slice.
It must land before step 4 only so the docs describe a stack that already boots that way.

## Contract Freeze

`spec.md`'s `## GraphQL Contract Delta` is **None**, and frozen as of `status: Approved`. There is
nothing on the GraphQL surface to unwind: `017` deliberately never routed the GPU decision through
`api`, so `EncodeJobDetails`, `EncodeInput`, the `processJob`/`encode` payloads in
`src/queue/types.ts` and every `api` mutation are untouched. An implementer who finds themselves
editing `src/queue/types.ts` has misread the feature — stop and report.

The things an implementer will be tempted to change and must not:

- **`HDR_DOWNSCALE_VF` and the four colour tags on the HDR branch** (`params.ts:140-152`). They look
  like leftovers of the tonemap work and are not — they are the shipped policy from `8d9572d`.
  Touching them changes what lands in the library (NFR-1).
- **The `-metadata:s:v:0` titles.** `Downscaled from 4K DoVi` / `Downscaled from 4K HDR10` /
  `Downscaled from 4K SDR` are current and correct. The old `Tonemapped from …` strings survive only
  in stale test expectations, which is what makes them look authoritative. They are not.
- **The orphaned `// REQ-6` / `// REQ-7` comments** inside the HDR branch. They must be **deleted**,
  not rewritten to cite `024` — Constitution Article XI allows no explanatory comment here, and
  `017` is exactly the kind of reference that goes stale.
- **The HLG colour tag.** `spec.md` § Out of Scope records that the HDR branch fires on
  `arib-std-b67` while tagging `smpte2084`. It is a real observation and it is **not** this
  feature's to fix. Correcting it changes an encode.
- **The corpus retirement's timing.** *Which* cases go is settled (REQ-8: all seven versioned ones,
  `8.json` survives and is committed). *When* they go is not negotiable either — after the AC-4 diff,
  never before. An implementer who sees seven stale files and deletes them first has destroyed the
  only evidence that the cleanup changed no encode.

## Migrations

**None.** No Prisma model, field, enum or migration. `api` does not participate in this feature.

## Risks

| Risk | How it fails | Mitigation |
| :-- | :-- | :-- |
| **A cleanup silently changes an encode.** Collapsing the HDR and SDR branches, dropping `HDR_DOWNSCALE_VF`, or "tidying" a colour tag while removing the tonemap constants next to it. | FFmpeg exits 0, mkvmerge exits 0, the `ProcessJob` reports `COMPLETED`, and a wrong 1080p file lands in the library. No error in any log (Article IX). | Step 0 captures the argument array for every corpus probe on `HEAD`; step 3 diffs it. AC-4. This is the feature's central guard and the reason step 0 exists at all. |
| **The rule document keeps prescribing the tonemap.** `.claude/agents/ffmpeg.md` rule **V3** still reads "Dolby Vision and HDR10 are tonemapped — `libplacebo` when a Vulkan device is available…". | Nothing fails now. The next time the `ffmpeg` agent is dispatched it reads V3 as its authority, sees code that disagrees, and "fixes" the code by reintroducing tonemapping — a regression delivered as a bug fix, from the rule file, months later. | A `[docs]` task in step 4 rewrites V3 to the shipped behaviour and strips every citation of a retired case from § Rules (V3, V5, A-series, L1) and from the case-shape example. Highest-value item in the docs slice; it is not cosmetic, and REQ-8 makes it load-bearing — with the corpus down to one case, § Rules is the *only* surviving record of what those cases proved. |
| **The corpus reset discards the repository's only end-to-end argument coverage.** Retiring `1.json`–`7.json` (REQ-8, owner's decision) removes the sole assertions over 4K DoVi remux audio, English SDH exclusion, the HEVC-1080p copy rule and the `throws` case. | Nothing fails now. Later, a rule change to `params.ts` that breaks one of those behaviours produces a green suite, a `COMPLETED` job and a wrong file in the library — the exact failure `cases.spec.ts` was built to catch, with the net removed. | **Not mitigated, accepted.** Two things narrow it: the retired cases are deleted only *after* the AC-4 diff has used their probes, so this feature itself is still proven; and the rules they backed survive in `.claude/agents/ffmpeg.md` § Rules, whose citations REQ-9 corrects. Re-earning the coverage with fresh probes is follow-up work and should be raised as its own item. |
| **The retired cases are deleted too early.** Their `ffprobe` blocks are the only real-file evidence available for the AC-4 byte diff. | Deleting them before the diff runs leaves NFR-1 resting on a single case, so a cleanup that silently changed an encode for a DoVi or SDH source would pass unnoticed. | Ordering is explicit: step 0 captures all eight, step 3 diffs all eight, and only step 3b deletes the seven. AC-4. |
| **`8.json` is untracked.** It is a new case in the working tree, not in git — and after this feature it is the *entire* corpus. | An implementer working from `git ls-files` or a diff never sees it, deletes "the corpus" including it, and `loadCases()` throws on an empty directory — or it survives locally, is never `git add`ed, and CI has no cases at all. | Named explicitly in `ffmpeg/plan.md` § Files, with an explicit `git add`. The corpus is enumerated from the **directory**, never from git. AC-5. |
| **The validator and the JSON files change in different tasks.** `cases.spec.ts:81` hard-requires `input.vulkanAvailable` to be a boolean. | Whichever lands first, `loadCases()` throws at module scope and the whole suite fails collection — reported as "the cleanup broke the tests", sending someone hunting in the wrong file. | One task changes the validator and all corpus files together. `ffmpeg/plan.md` step 4. |
| **The image is not rebuilt.** Removing `vulkan-loader`/`mesa-vulkan-*` from the `base` stage changes nothing in a running dev container. | AC-5 appears to pass against the old image, which still has the drivers, so the removal is never actually verified. | Verification runs `bin/build worker` before `bin/dev`. |
| **A stale `USE_GPU` in a developer's own `.env`.** Editing `.env.example` does not touch an existing `.env`. | Silent only if something still reads it — which is precisely what this feature removes. | AC-6 proves inertness by comparing both invocations directly rather than assuming the default. |

## Verification

Step 0, **before any edit**, on current `HEAD`:

```bash
bin/cli worker node -e 'const{readdirSync,readFileSync,writeFileSync}=require("fs");const{join}=require("path");require("tsx/cjs");const{buildFfmpegCommand}=require("/app/src/ffmpeg/buildCommand.ts");const d="/app/ffmpeg";const out={};for(const f of readdirSync(d).filter(n=>n.endsWith(".json")).sort()){const c=JSON.parse(readFileSync(join(d,f),"utf8"));const i=c.input;try{out[f]=buildFfmpegCommand(i.file,i.output,c.ffprobe,{allowedLanguagesIso3:i.allowedLanguagesIso3,originalLanguageIso3:i.originalLanguageIso3,isLiveAction:i.isLiveAction},i.vulkanAvailable)}catch(e){out[f]="THREW: "+e.key}}writeFileSync("/app/ffmpeg-baseline.json",JSON.stringify(out,null,2))'
```

Re-run the same dump after steps 1–2 (dropping the final `i.vulkanAvailable` argument), then diff
the two files. **An empty diff is AC-4.** Delete both dumps afterwards — neither belongs in the
repo, and `services/worker/ffmpeg/` must contain only cases.

Step 3, the gates:

```bash
bin/cli worker npx --no tsc --noEmit
bin/npm worker test
```

Expected: 0 errors, and 0 failures. Today the suite reports `Test Files 3 failed | 10 passed (13)`
and `Tests 11 failed | 106 passed (117)`; the after-state has fewer tests, not more, and every
remaining one green (AC-1, AC-2).

The removal is complete when this returns nothing (AC-3):

```bash
grep -rniE 'vulkan|libplacebo|tonemap|USE_GPU|dev/dri' services/worker bin docker-compose.yaml docker-compose.dev.yaml .env.example README.md CLAUDE.md
```

Then the stack, which is what proves `infra` (AC-5):

```bash
bin/build worker && bin/dev && docker compose logs worker
```

Expected: `worker` reaches a running state, and the log contains **no** `tonemap path:` line and no
`VK_ERROR_INCOMPATIBLE_DRIVER`. Confirm the drivers are gone from the image itself:

```bash
bin/cli worker sh -c 'apk info -e vulkan-loader mesa-vulkan-intel mesa-vulkan-ati; ls /dev/dri'
```

Expected: no package listed, and `/dev/dri` absent inside the container even on this host, which
has a render node — that is REQ-5 holding.

The manual pass, which no command covers:

1. Encode one real 4K HDR source end to end and confirm the output plays, is 1920x1080, and
   `ffprobe` reports `color_transfer=smpte2084` — HDR preserved, matching what `8d9572d` shipped.
2. Add `USE_GPU=false` back into `.env` by hand, re-run `bin/dev`, and confirm the `docker compose`
   invocation and the worker's behaviour are unchanged (AC-6).
3. Run `bin/install` against a scratch checkout and confirm it asks nothing about a GPU and that
   `grep -c USE_GPU .env` returns `0` (AC-7).
