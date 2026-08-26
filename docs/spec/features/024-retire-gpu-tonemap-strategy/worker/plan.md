---
title: Retire the GPU Tonemap Strategy — worker slice
service: worker
last_updated: 2026-08-25
status: Approved
---

# PLAN: Retire the GPU Tonemap Strategy — `worker` (`worker/plan.md`)

## Scope

Two call sites, and nothing else. The startup bootstrap in `src/index.ts` runs the Vulkan probe and
logs the chosen tonemap path; the real encode driver in `src/encode/encode.ffmpeg.ts` reads the
memo and passes it into `buildFfmpegCommand`. Both point at a module the `ffmpeg` agent deletes in
the step before yours, and at a function signature it shortens by one parameter.

This is the smallest slice in the feature and it is deliberately separate: `src/ffmpeg/` is **not**
your territory (`.claude/agents/worker.md` § Scope), so the two files above are the entire worker
share of a feature whose deletion otherwise lives next door. Do not open `src/ffmpeg/params.ts`,
`buildCommand.ts`, `vulkan.ts` or `services/worker/ffmpeg/` to "finish the job" — that work is
already done by the time you run, and editing there is a stop-and-report.

Writes are confined to `services/worker/` and this directory. `services/worker/Dockerfile` is
`infra`'s, and `services/worker/CLAUDE.md` is a `[docs]` task.

## Files

| File | New / Modified | What changes |
| :-- | :-- | :-- |
| `services/worker/src/encode/encode.ffmpeg.ts` | Modified | Drop the `isVulkanAvailable` import (`:6`), the comment block explaining the memo (`:48-51`), and the fifth argument to `buildFfmpegCommand` (`:52`). |
| `services/worker/src/index.ts` | Modified | Drop the `probeVulkan` import (`:6`), the `await probeVulkan()` call and the `tonemap path:` log line with its `REQ-6` comment (`:30-37`). |

## Existing code to reuse

- `services/worker/src/index.ts:29` — the `async function main()` bootstrap. It exists because this
  service is `"type": "commonjs"` and had no top-level `await`, and `017` needed the probe memoized
  before either `Worker` started pulling jobs. **Keep the bootstrap.** Unwrapping it back into
  top-level statements is a larger change than this feature asks for, touches the signal handling
  and the two `Worker` constructions, and gains nothing — Article X asks for less code, not for a
  restructuring nobody requested. Removing the two probe lines from inside `main()` is the whole job.
- `services/worker/src/encode/encode.ffmpeg.ts:28` — the `EncodeFn` driver signature is unchanged.
  This slice removes an argument the driver passes onward, never one it receives.

## Steps

1. `src/index.ts`: remove the `probeVulkan` import, then remove the `await probeVulkan()` call, the
   `console.log` of the tonemap path, and the `REQ-6` comment above them. `main()` now opens
   directly with `const scanWorker = new Worker…`. Leave `process.umask(0o002)`, the `connection`
   object, both `Worker` constructions and the signal handling exactly as they are.
2. `src/encode/encode.ffmpeg.ts`: remove the `isVulkanAvailable` import, the comment block at
   `:48-51`, and the final argument of the `buildFfmpegCommand(...)` call so it passes four.

## Contract obligations

`../spec.md` § GraphQL Contract Delta is **None**. Nothing this slice touches crosses a service
boundary: no field on `EncodeJobDetails` or `EncodeInput`, no `api` mutation, and — worth stating
because it is the one hand-synced contract you own — **no change to `src/queue/types.ts`**. That
file duplicates `services/api/src/queue/types.ts` with no compiler between them; this feature gives
you no reason to open it, and doing so is a signal you have misread the scope.

The internal obligation is ordering, not shape: your two edits are only valid against the shortened
`buildFfmpegCommand` signature the `ffmpeg` slice lands first. If `src/ffmpeg/vulkan.ts` still
exists when you start, the previous step has not run — stop and report rather than deleting it
yourself.

## Tests

**No test is owed by this slice, and the reason is specific rather than convenient.**

Both edits are removals of a call, and the failure they could cause is loud, not silent: a missed
import or a stale fifth argument fails `tsc --noEmit` at the file and line, and a wrong argument
count to `buildFfmpegCommand` cannot compile at all. Article IX asks for tests where a bug produces
no error anywhere; here the compiler is the error.

What these two files could otherwise get wrong — the arguments FFmpeg actually receives — is already
covered next door by `src/ffmpeg/cases.spec.ts`, which asserts the complete ordered command against
real `ffprobe` output, plus the AC-4 byte diff in `../plan.md` § Verification.

`src/jobs/encode.job.spec.ts` and `src/api/graphql-client.spec.ts` are untouched and must stay
green; neither references the probe.

## Done when

Both gates pass, and this is the point in the feature at which the typecheck becomes meaningful
again (`../plan.md` § Order of Work):

```bash
bin/cli worker npx --no tsc --noEmit
bin/npm worker test
```

Expected: 0 errors, 0 failures. Then confirm the startup line is gone rather than merely reworded:

```bash
docker compose logs worker | grep -c 'tonemap path:'
```

Expected: `0`.
