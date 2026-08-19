---
title: Worker GPU Strategy — worker slice
service: worker
last_updated: 2026-08-19
status: Approved
---

# PLAN: Worker GPU Strategy — `worker` (`worker/plan.md`)

## Scope

You own the runtime half: detecting once per process whether a usable Vulkan device exists, and
emitting either the existing `libplacebo` tonemap chain or a software equivalent based on that
answer. You also own the single startup log line that says which path was chosen and why (REQ-6).

You are **not** doing: the apk packages that put a Vulkan driver in the image, the
`docker-compose.gpu.yaml` device mapping, the `bin/` scripts that decide whether to attach it, or
adding `USE_GPU` to the container's `environment:` block. All of those are the `infra` slice. You
*read* `process.env.USE_GPU`; you do not arrange for it to be there.

Writes are confined to `services/worker/` and this directory. Anything else is a stop-and-report
(see `.claude/agents/worker.md`).

**Note on your agent brief**: `.claude/agents/worker.md` still says this service has no tests and no
`vitest.config.ts`. That is stale — there are 9 suites and 75 tests today, and `vitest.config.ts`
exists. Do not add it again.

## Files

| File | New / Modified | What changes |
| :-- | :-- | :-- |
| `src/ffmpeg/vulkan.ts` | New | The probe, its memo, the `USE_GPU` opt-out parse, and the sync getter the rest of the service reads |
| `src/ffmpeg/vulkan.spec.ts` | New | Covers the opt-out parse and the "unusable" resolution paths |
| `src/ffmpeg/params.ts` | Modified | `getVideoParams` gains a `vulkanAvailable` parameter; the two `libplacebo` branches (`:88`, `:116`) each gain a software alternative |
| `src/ffmpeg/params.spec.ts` | Modified | First-ever `getVideoParams` coverage — four cases (HDR10 × DoVi, Vulkan × no Vulkan) |
| `src/ffmpeg/buildCommand.ts` | Modified | Threads the boolean through to `getVideoParams` |
| `src/ffmpeg/buildCommand.spec.ts` | Modified | Existing cases updated for the new argument |
| `src/encode/encode.ffmpeg.ts` | Modified | Reads the memoized answer and passes it to `buildFfmpegCommand` |
| `src/index.ts` | Modified | Runs the probe at startup and emits the one log line |

A new module beyond `vulkan.ts` means this plan missed something — report it rather than adding it
quietly.

## Existing code to reuse

- **`src/ffmpeg/metadata.ts`** — the pattern for the probe. `promisify(execFile)` against an
  ffmpeg-family binary, wrapped in `try`/`catch`. Its comment explains why `execFile` and not `exec`
  (no shell, no injection); the same reasoning applies here even though the probe takes no
  user-controlled input. Follow this file, **not** `src/ffmpeg/runner.ts` — that one's `spawn`,
  signal handlers and settle-once discipline exist to survive hours-long jobs and are pure overhead
  for a sub-second probe.
- **`src/ffmpeg/params.ts`'s existing 4K branch structure** — the `is4K` / `hasDolbyVision` /
  `hasHDR10` cascade already sits exactly where the new branching belongs. Extend the two `return`
  blocks; do not add a fifth top-level branch or a parallel function.
- **`src/ffmpeg/params.spec.ts`'s helper style** — `audioStream(overrides)` / `subtitleStream(overrides)`
  factories at the top of the file. Add a `videoStream(overrides)` factory in the same shape rather
  than building literals inline in each case.
- **`src/encode/types.ts`'s `EncodeInput`** — the house pattern of a locally-retyped subset. The
  probe result is *not* part of it: `EncodeInput` describes what `api` sends, and this is a local
  fact about the host. Pass it as a separate argument.

## Steps

1. **`src/ffmpeg/vulkan.ts`.** Export an async `probeVulkan()` and a sync `isVulkanAvailable()`.
   `probeVulkan` returns a small result object carrying both the boolean and the *reason*
   (`forced-off` / `no-device` / `available`), because REQ-6 needs to log which of the three it was.
   Rules, all of them load-bearing:
   - If `process.env.USE_GPU` is exactly the string `false`, resolve `forced-off` **without
     spawning anything**. Exactly `false` — not case-insensitive, not `0`, not `no`. See
     `../plan.md` § Contract Freeze; the infra side parses it identically.
   - Otherwise run ffmpeg's own Vulkan initialization over a tiny `lavfi` source. This is the
     verified-working invocation on the reference host:
     `ffmpeg -hide_banner -loglevel verbose -init_hw_device vulkan=vk -f lavfi -i testsrc=size=64x64:duration=0.1 -f null -`
   - A non-zero exit, a thrown error, or a timeout all resolve to `no-device`. **Never** let this
     reject out of startup (NFR-2).
   - Give `execFile` an explicit `timeout` option. A wedged driver must not hang the boot.
   - Inspect the verbose output and resolve `no-device` if the selected device name matches
     `llvmpipe`, `lavapipe` or `SwiftShader` — a software rasterizer answering as a GPU is the worst
     outcome available here (see `../plan.md` § Risks, first row).
   - Memoize the result in a module-level variable (NFR-1). `isVulkanAvailable()` reads the memo and
     returns `false` if the probe has not run, so a code path that forgets to await it degrades to
     CPU rather than crashing.
2. **`src/index.ts`.** Run the probe before the two `Worker`s are constructed and log the one line
   REQ-6 requires, naming the reason. **This service is `"type": "commonjs"` — there is no top-level
   `await`.** Wrap the startup in an async bootstrap function, or chain off the promise; do not
   switch the package to ESM as a side effect of this feature.
3. **`src/ffmpeg/params.ts`.** Add `vulkanAvailable: boolean` to `getVideoParams`. In the Dolby
   Vision branch (`:85-96`) and the HDR10 branch (`:113-124`), keep today's `libplacebo` `-vf` when
   it is `true` and emit the software chain when it is `false`. The software chain must land on the
   same 1920x1080 geometry and the same `bt709` output primaries/transfer/matrix (REQ-2). The
   expected shape — verify it against the real binary rather than trusting this line, then write
   what actually worked into the spec's AC evidence:
   `scale=1920:1080:force_original_aspect_ratio=decrease,zscale=t=linear:npl=100,format=gbrpf32le,zscale=p=bt709,tonemap=tonemap=hable:desat=0,zscale=t=bt709:m=bt709:r=tv,format=yuv420p10le`
   Scaling first is deliberate: tonemapping 4K and then downscaling does the expensive per-pixel
   work on four times the pixels. Both `zscale` and `tonemap` are already in the shipped image — no
   new package, and none to ask `infra` for.
   Leave the `-metadata:s:v:0` title strings **byte-identical** on both paths (REQ-6). The two
   non-tonemapping branches (`h264`, `vc1`, 4K SDR downscale, copy) are untouched.
4. **`src/ffmpeg/buildCommand.ts`.** Add the boolean as a fifth parameter and pass it to
   `getVideoParams`. Do not read `isVulkanAvailable()` inside this file — keeping it an argument is
   what lets `buildCommand.spec.ts` exercise both paths without stubbing a module.
5. **`src/encode/encode.ffmpeg.ts`.** Call `isVulkanAvailable()` and pass the result into
   `buildFfmpegCommand`. This is the only place in the service that reads the memo.
6. **Tests** — see below.

## Contract obligations

`../spec.md` § GraphQL Contract Delta is **None**, and that is a decision you are bound by, not an
absence to fill in. Specifically:

- No new field on `EncodeJobDetails` (`src/jobs/encode.job.ts`) or `EncodeInput`
  (`src/encode/types.ts`).
- No change to `src/queue/types.ts`. It is a hand-maintained mirror of
  `services/api/src/queue/types.ts`; editing it here silently desynchronizes the two.
- No new GraphQL query or mutation, and no new field in any existing selection.

If you conclude the GPU decision needs to travel in the job payload, **stop and report**. It does
not — `api` has no way to know what hardware this container can see.

You may read `process.env.USE_GPU`. That is not a contract violation: Article V forbids deriving
**paths** from the environment, and this is a runtime capability toggle, not a path.

## Tests

Article IX applies with unusual force here, because the characteristic failure of this slice is a
file that encodes successfully and looks wrong.

- **`src/ffmpeg/params.spec.ts`** (extended) — defends against the silent-wrong-colour case: a
  fallback chain with the wrong operator order, a missing `npl`, or a lost `bt709` output tag
  produces a washed-out or crushed 1080p file that passes ffmpeg, passes mkvmerge, lands in the
  library and is marked `COMPLETED` with no error anywhere. Four cases minimum (AC-5): HDR10 and
  Dolby Vision, each with `vulkanAvailable` true and false. Assert the emitted `-vf` string exactly,
  and assert that the `-metadata:s:v:0` title is identical across the true/false pair — that
  equality is REQ-6 and nothing else in the suite would catch it drifting. `getVideoParams` has
  **no coverage at all** today, so this is new ground, not an edit to existing assertions.
- **`src/ffmpeg/vulkan.spec.ts`** (new) — defends against the `USE_GPU` semantic drift named in
  `../plan.md` § Contract Freeze. Cover: exactly `false` opts out without spawning; `true`, unset,
  `False`, `0` and `no` all fall through to probing; a probe failure resolves to unusable rather
  than throwing; `isVulkanAvailable()` before any probe returns `false`.
- **`src/ffmpeg/buildCommand.spec.ts`** (extended) — only enough to keep the existing cases
  compiling with the new argument, plus one assertion that the boolean actually reaches the video
  params. The real rule coverage is in `params.spec.ts`; do not duplicate it here.
- **Not owed a test**: `src/index.ts`'s bootstrap and the log line. A missing or wrong startup log
  is immediately visible in `docker compose logs worker` and is verified by AC-1 through AC-3
  directly; it cannot fail silently. `encode.ffmpeg.ts`'s one-line change is likewise covered
  transitively by the integration criteria.

Open each new spec with the header comment naming the class of bug it prevents, matching
`params.spec.ts:1-10`. English `it(...)` strings (Article VI).

## Done when

```bash
bin/cli worker npx --no tsc --noEmit
bin/npm worker test
```

The typecheck at **0 errors** (this service is `strict: true` — a new error is a failure, not a
warning). The suite green and **above** its 75-tests/9-suites baseline; report the actual numbers.
State plainly if anything is red rather than rounding it up to "tests pass".
