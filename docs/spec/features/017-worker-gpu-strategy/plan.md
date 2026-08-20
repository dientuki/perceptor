---
title: Worker GPU Strategy — Implementation Plan
spec_version: 0.2.0
last_updated: 2026-08-20
status: Implemented
---

# PLAN: Worker GPU Strategy (`plan.md`)

## Approach

The feature has two halves that meet at one seam, and the seam is not GraphQL.

**The `worker` half** turns the tonemap filter choice from a compile-time fact into a runtime one.
`getVideoParams` (`services/worker/src/ffmpeg/params.ts`) currently hardcodes a `libplacebo` string
in two branches (`:88` Dolby Vision, `:116` HDR10). It gains an explicit `vulkanAvailable: boolean`
parameter and emits either that same `libplacebo` chain or a software `zscale`/`tonemap` equivalent.
The boolean is threaded down from `encode.ffmpeg.ts` through `buildFfmpegCommand` as an argument
rather than read from a module global inside `params.ts` — `params.ts` is a pure rule-dense function
and the one file in this service with real test coverage; keeping the decision an argument is what
makes AC-5's four cases writable without stubbing a module.

The probe itself is a new `src/ffmpeg/vulkan.ts`. It reuses the exact pattern of
`src/ffmpeg/metadata.ts` — `promisify(execFile)` against an ffmpeg-family binary, `try`/`catch`
around it — rather than the much heavier `spawn`-with-signal-handling machinery in
`src/ffmpeg/runner.ts`, which exists to survive hours-long jobs and has nothing this needs. The
result is memoized in a module-level variable (NFR-1) and read through a synchronous getter, so
`buildFfmpegCommand` stays synchronous and its existing spec keeps working.

**The `infra` half** stops asking a human a question that has a correct answer the machine can
determine. `bin/dev`, `bin/prod` and `bin/build` each carry an identical three-line `USE_GPU` block
(`bin/dev:21`, `bin/prod:22`, `bin/build:34`); all three become a render-node test with `USE_GPU`
demoted to an opt-out. The `bin/install` question is deleted. `docker-compose.gpu.yaml` **survives
unchanged** — runtime detection cannot see a device compose never mapped in, so the overlay is still
the thing that maps it.

Alternatives that were live and are not taken: a CPU-only image (strategy A in `spec.md`) was
rejected by the user in favour of keeping GPU acceleration where it exists; two image variants
(strategy C) collides with `015-reproducible-image-builds`, already landed. Within B, reading the
probe result from a module global instead of passing it down was rejected for the testability reason
above.

## Order of Work

The two slices touch disjoint files and neither imports the other. What couples them is a single
environment variable name and its meaning — freeze that (below) and they genuinely run in parallel.

| Step | Service | Why it must come here |
| :-- | :-- | :-- |
| 1 | `infra` | Adds `USE_GPU` to the `worker` container's `environment:` block. Until this lands the worker's forced-off branch (REQ-6) has nothing to read and AC-2 cannot be exercised at all. |
| 1 | `worker` | Parallel with step 1 — the probe, the fallback chain and their tests need no infra change to be written or unit-tested. |
| 2 | `infra` | Dockerfile `base` stage packages (REQ-8) and the three `bin/` scripts (REQ-5). Independent of the worker slice; separated from step 1 only because it forces an image rebuild. |
| 3 | both | Joint verification. AC-1 through AC-4 each need both halves in place. |

**Genuinely parallel**: the worker slice in full, against infra step 1. **Not parallel**: AC-2, AC-3
and AC-4, which are integration criteria and belong after step 2.

## Contract Freeze

`spec.md`'s `## GraphQL Contract Delta` says **None**, and that is itself the frozen decision — an
implementer who finds themselves adding a field to `EncodeJobDetails`, `EncodeInput` or either
`queue/types.ts` to carry GPU state has misread the feature and must stop and report. The machine
running FFmpeg is the only one that can answer this question; routing it through `api` would put a
fact about the worker's own host into a payload `api` cannot compute.

The real contract here is an **environment contract**, and it is frozen on the same terms:

- **`USE_GPU` is tri-state, and `true` does not mean "force GPU".** Unset or `true` means *auto*:
  use the GPU if the host has a render node and the probe succeeds. Only the literal string `false`
  is load-bearing — it forces the CPU path on both halves. There is deliberately no "force GPU"
  value, because forcing a device that does not work produces `VK_ERROR_INCOMPATIBLE_DRIVER` at
  encode time, which is the bug this feature exists to remove.
- **The variable is read in two places with the same semantics.** `bin/*` uses it to decide whether
  to append the overlay; the worker uses it to decide whether to skip the probe. Both must treat
  exactly `false` as opt-out and everything else as auto. An implementer who makes one side
  case-insensitive, or accepts `0`/`no`, has created a state where the overlay is attached but the
  worker refuses to use it — no error anywhere, just a silently slower encode.
- **`docker-compose.gpu.yaml` is not deleted, and its contents do not change.** It is tempting to
  fold the device mapping into `docker-compose.yaml` now that inclusion is automatic; that breaks
  every host without `/dev/dri`, which is the whole point of REQ-4.
- **The FFmpeg output metadata title is identical on both paths** (REQ-6). Making it say "CPU
  tonemapped" is an obvious-looking improvement that would leave two files in one library
  disagreeing about the same source.

Changing any of the above means amending `spec.md`, re-approving, and re-briefing both slices
(Constitution, Article VIII).

## Migrations

**None.** No Prisma model, field, enum or migration — `api` does not participate in this feature.

## Risks

| Risk | How it fails | Mitigation |
| :-- | :-- | :-- |
| **A software Vulkan driver passes the probe** | If `mesa-vulkan-swrast` (lavapipe) ever enters the image, the probe finds a "usable" Vulkan device that is actually the CPU pretending to be a GPU. `libplacebo` then runs on llvmpipe — correct output, no error, and an encode perhaps an order of magnitude slower than the `zscale` path it rejected. Nothing in any log says so. | Do not install `mesa-vulkan-swrast` (infra step 2 pins the package list). The probe additionally rejects a device whose reported name matches `llvmpipe`/`lavapipe`/`SwiftShader`. Verified today: the probe on this host reports `Intel(R) UHD Graphics (TGL GT1)`, real hardware. |
| **The fallback chain produces wrong colours instead of failing** | A `zscale`/`tonemap` chain with the wrong operator order or a missing `npl` is not an error — it emits a washed-out or crushed 1080p file that encodes fine, passes mkvmerge, lands in the library and is marked `COMPLETED`. This is the Article IX case for this feature. | `params.spec.ts` asserts the exact emitted chain for all four cases (AC-5); AC-1 and AC-2 compare `ffprobe` colorimetry of GPU vs CPU output on the same synthetic source, so the two paths are checked against each other, not just against themselves. |
| **A too-cheap probe says yes where the real chain says no** | The probe initializes a Vulkan device on a 64x64 test frame; the encode then runs `libplacebo` on 4K 10-bit frames and may fail on memory or a missing format. | Accepted, and deliberately not defended against: this failure is **loud** — ffmpeg exits non-zero, `runner.ts` captures the stderr tail and `encodeFailed` reports it. Silent-failure budget goes to the row above instead. |
| **The probe hangs** | `execFile` with no timeout against a wedged driver leaves the worker booting forever. Both queues stay unconsumed and the backlog grows with no error — the queue looks idle, not broken. | NFR-2: the probe carries an explicit timeout and any timeout, non-zero exit or thrown error resolves to *unusable*. Never to a rejected promise that escapes startup. |
| **`USE_GPU` semantics drift between the two halves** | See the Contract Freeze bullet — overlay attached, worker declining to use it, or the reverse. No error either way. | The tri-state rule is frozen above and restated in both service plans; `vulkan.spec.ts` covers the opt-out parse directly. |
| **Render-node group permissions differ per host** | `/dev/dri/card0` is group-owned by a gid (985 on this host) that the container — running `${PUID}:${PGID}` with `group_add: ${MEDIA_GID}` — may not hold on someone else's machine. The device is mapped, the probe fails, and the user silently gets the CPU path while believing the GPU is in use. | REQ-6's startup log line is the whole mitigation: it names *which* path was chosen and why, so "I mapped the GPU but it's slow" is diagnosable from `docker compose logs worker` rather than by guessing. Fixing the gid itself is out of scope. |

## Verification

```bash
bin/cli worker npx --no tsc --noEmit
bin/npm worker test
```

Both must be clean — the typecheck at 0 errors, the suite green and up from its 75/9 baseline by the
new `getVideoParams` cases and `vulkan.spec.ts` (AC-5, AC-6).

Then the integration pass, which is where AC-1 through AC-4 live. Generate the synthetic HDR source
once, inside the container, so no media is needed:

```bash
bin/cli worker ffmpeg -y -f lavfi -i testsrc=size=3840x2160:duration=2:rate=24 -c:v libx265 -pix_fmt yuv420p10le -color_primaries bt2020 -color_trc smpte2084 -colorspace bt2020nc /tmp/hdr4k.mkv
```

- **AC-1** — with the overlay active, run the encode chain over `/tmp/hdr4k.mkv` and confirm with
  `bin/cli worker ffprobe` that the output is `1920x1080` with `bt709` primaries, transfer and
  matrix. Confirm the startup line in `docker compose logs worker` names Vulkan.
- **AC-2** — set `USE_GPU=false` in `.env`, `bin/dev`, repeat. Same geometry, same colorimetry,
  startup line names the forced-off reason. This is the one criterion that proves the two paths
  agree, so run it on the same source file as AC-1.
- **AC-3** — restore `USE_GPU`, bring the stack up without the overlay so the container has no
  `/dev/dri`, and repeat. The job completes, the log names "no Vulkan device", and
  `docker compose logs worker` contains no `VK_ERROR_INCOMPATIBLE_DRIVER`.
- **AC-4** — the honest limit of this checkout: this host *has* a render node, so the
  no-render-node branch of `bin/dev` cannot be exercised for real here. Verify the branch by
  temporarily pointing the test at a path that does not exist and confirming the overlay is omitted
  and `worker` still reaches running; note in the implementation report that a true Windows/Docker
  Desktop confirmation is outstanding rather than claiming AC-4 passed.

A `git status --short` after the feature must show changes confined to `bin/`,
`docker-compose.yaml`, `.env.example`, `services/worker/`, `README.md`, the two `CLAUDE.md` files and
this spec directory. Anything under `services/api/` or `services/web/` means a slice left its lane.
