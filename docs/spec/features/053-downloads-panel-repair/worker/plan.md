---
title: Downloads panel repair — worker slice
service: worker
last_updated: 2026-09-11
status: Implemented
---

# PLAN: Downloads panel repair — `worker` (`worker/plan.md`)

## Scope

This service reads FFmpeg's own realtime multiplier off the `-progress` stream it is already
parsing and hands it to `api` on the progress report it is already sending (REQ-8, NFR-2, NFR-3),
and guarantees the passthrough driver reports none (REQ-11).

It is **not** doing: persisting anything (no database here, ever — Article III), deciding when a
speed is stale (`api`'s `pipeline-status/` owns REQ-10), formatting it for a human (`web`), or any
part of the `infoHash` casing work, which never reaches this service. Nothing about what gets
encoded, selected or written changes — no FFmpeg argument moves, and `src/ffmpeg/params.ts`,
`buildCommand.ts` and the `ffmpeg/` case corpus are **out of scope and owned by a different agent**
(`.claude/agents/ffmpeg.md`).

Writes are confined to `services/worker/` and this directory. Anything else is a stop-and-report.

## Files

| File | New / Modified | What changes |
| :-- | :-- | :-- |
| `services/worker/src/encode/types.ts` | Modified | `EncodeFn`'s `onProgress` widens to `(progress, speed)` |
| `services/worker/src/ffmpeg/runner.ts` | Modified | Parses `speed=`, remembers the last value, passes it on each report |
| `services/worker/src/encode/encode.mock.ts` | Modified | Passes `null` on every report |
| `services/worker/src/encode/passthrough.ts` | Modified | Passes `null` on its single `onProgress(100)` |
| `services/worker/src/jobs/encode.job.ts` | Modified | `onProgress` takes the speed and sends it on the existing mutation |
| `services/worker/src/jobs/encode.job.spec.ts` | Modified | The seam cases |

`src/encode/encode.ffmpeg.ts` forwards `onProgress` to `runFfmpeg` by reference and needs **no
edit** — verify that rather than assuming it.

## Existing code to reuse

- **`src/encode/types.ts`'s `EncodeFn`** — the documented no-GraphQL driver seam. The speed rides
  the existing `onProgress` callback, widened. Do **not** add a second callback: speed without the
  progress report it accompanies has no throttle and no meaning, and `services/worker/CLAUDE.md`
  records why the last parameter added to this seam (`onProbe`, `023-ffprobe-log`) was made
  **required** — an optional callback a call site forgets to pass compiles clean and records nothing
  forever. Make the second parameter of `onProgress` required for the same reason: it is what makes
  REQ-11 a compile error instead of a discipline.
- **`src/ffmpeg/runner.ts`'s `child.stdout.on('data', …)` handler** — already parsing the
  `-progress pipe:1` stream that carries `speed=` on the same blocks as `out_time_us=`. Extend that
  handler; do not open a second listener.
- **`src/ffmpeg/runner.ts`'s `progressInFlight` guard** — the existing serialization that keeps two
  progress mutations from racing the same `ProcessJob` (the MariaDB 1020 failure written up in
  `encode.job.ts`). Untouched: the speed rides inside the report that guard already gates.
- **`src/jobs/encode.job.ts`'s `PROGRESS_STEP` throttle** — 5%. Untouched. The speed is sent on the
  reports that already happen, never on a schedule of its own (NFR-2).
- **`src/jobs/encode.job.ts`'s existing `try`/`catch` around the `encodeProgress` call** — already
  swallows a failed progress report so a lost one cannot stop an encode. It covers the widened call
  unchanged; nothing new is owed for NFR-3 at this level.

## Steps

1. **`src/encode/types.ts`** — widen `EncodeFn`'s fourth parameter to
   `onProgress: (progress: number, speed: number | null) => Promise<void>`. Required, not optional.
   This is the change that makes steps 3 and 4 fail to compile until they are done, which is the
   point.
2. **`src/ffmpeg/runner.ts`** — in the existing stdout handler, parse `speed=` alongside
   `out_time_us=`. FFmpeg emits it as `speed=1.02x`, with a possible leading space, and as
   `speed=N/A` during the encoder's startup buffering — the same way `out_time_us` is `N/A` there,
   which the handler already skips. Keep the last successfully parsed value in a variable scoped
   beside `progressInFlight` and pass **that** to `onProgress`, rather than requiring `speed=` and
   `out_time_us=` to land in the same stdout chunk: a `-progress` block can split across chunk
   boundaries, and requiring both would drop most reports. Anything unparseable, absent or `N/A`
   leaves the variable at `null`. Nothing in this path throws (NFR-3).
3. **`src/encode/encode.mock.ts`** — pass `null` as the second argument on its `onProgress` call. The
   mock simulates time, not an encoder; it has no speed to report and must not invent one.
4. **`src/encode/passthrough.ts`** — pass `null` on its single `onProgress(100)`. This is REQ-11: with
   `compression_enabled` off there is no FFmpeg and there is no speed, and the panel must show an
   empty Speed column rather than a fabricated value.
5. **`src/encode/encode.ffmpeg.ts`** — confirm no edit is needed. It passes `onProgress` through to
   `runFfmpeg` by reference, so the widened signature flows without a change. If the typecheck says
   otherwise, that is a finding worth reporting, not a silent fix.
6. **`src/jobs/encode.job.ts`** — widen the local `onProgress` to `(progress, speed)` and add the
   argument to the mutation document it already sends:
   `mutation ($id: Int!, $p: Int!, $s: Float) { encodeProgress(processJobId: $id, progress: $p, speed: $s) }`.
   Send `speed` explicitly as `null` rather than omitting the variable when there is none — the two
   cases stay distinguishable in `api`'s log, and an omitted variable against a declared `$s` is a
   different wire shape than an explicit null. The `PROGRESS_STEP` early return stays exactly where
   it is: a report suppressed by the throttle carries no speed either, by construction.

## Contract obligations

This service **consumes** the mutation declared in `../spec.md` § GraphQL Contract Delta:

```graphql
encodeProgress(processJobId: Int!, progress: Int!, speed: Float): String!
```

`speed` is `Float`, nullable, and is FFmpeg's realtime multiplier **unrescaled** — send `1.23` for
`speed=1.23x`. Do not convert it to a percentage, a rate, or a per-second figure; `api` stores what
it is given and `web` formats it.

There is no codegen across this boundary (`docs/spec/graphql-contract.md`). A mistyped variable name
or a wrong GraphQL type in the document above compiles cleanly here and fails at runtime as a
validation error on `api`, which this service's existing `try`/`catch` will swallow into a logged
line — so the failure mode of getting this wrong is "progress silently stops being reported", not a
crash. Check it against the delta character by character.

Error conditions, from the delta's table: there are none this service must handle. An omitted or
`null` speed is accepted; a negative or non-finite one is accepted and coerced to `null` by `api`,
never rejected. A failing report is already swallowed and logged by the existing `catch` and must
stay that way.

The delta is read-only. If it is wrong, stop and report (Article VIII).

## Tests

- **`src/jobs/encode.job.spec.ts`** (existing — extend it) — defends against the seam silently
  carrying nothing. The `EncodeFn` seam is exactly the place this service has been burned before:
  `services/worker/CLAUDE.md` records that `onProbe` was made a required parameter because an
  optional one "compiles clean and records nothing forever", and the same file records that a
  missing field on `EncodeJobDetails` "silently arrives `undefined`, which reads as 'no preference'
  with no error anywhere". Two cases: a driver reporting a speed produces an `encodeProgress` call
  carrying that value, and a driver reporting `null` produces one carrying `null` — not an omitted
  variable, not `0`. `0` matters: it is a legitimate multiplier at the start of an encode and must
  never be laundered into "no speed" by a falsy check.

**Not owed**: `runner.ts`'s regex has no spec today and this feature does not change that —
`runner.ts` is on this service's recorded known-debt list for coverage, and standing up its first
test harness (spawning a real FFmpeg, or faking a child process) is disproportionate to a decoration
that cannot fail an encode. Its failure mode is also not silent in the sense Article IX cares about:
a wrong regex means the Speed column stays empty, which AC-6 catches by looking at it. `passthrough.ts`
and `encode.mock.ts` are not owed tests either — the required parameter makes their `null` a compile
error if forgotten, which is a stronger guarantee than a test.

## Done when

```bash
bin/cli worker npx --no tsc --noEmit
bin/npm worker run build
bin/npm worker test
```

`bin/npm worker run build` exits 0. The test suite is green above the 175 tests / 20 suites recorded
in the root `CLAUDE.md`, modulo **two pre-existing failures in `src/ffmpeg/`** — the stale
`ffmpeg/2.json` track-title string and the `buildCommand.spec.ts` CRF mismatch. The typecheck
reports the **two pre-existing errors in `src/metadata/container-tags.spec.ts`**
(`TS2554: Expected 3 arguments, but got 2`) and no others; all four predate this feature and sit in
files it does not touch. Report the before and after numbers; do not fix any of the four here.
