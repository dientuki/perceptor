---
title: ffprobe Log — worker slice
service: worker
last_updated: 2026-08-20
status: Implemented
---

# PLAN: ffprobe Log — `worker` (`worker/plan.md`)

## Scope

This service decides **when** a probe is recorded and hands `api` the bytes: immediately after
`ffprobe` returns and before FFmpeg starts (REQ-1), best-effort so a recording failure never
touches the encode (NFR-1). It sends the raw stdout string exactly as `ffprobe` emitted it —
nothing here parses, reformats or trims it on the way out.

It does **not** own the table, the migration, the ordering of the log, or any authorization
decision; `api` owns all of that, and this service holds no database client (Constitution,
Articles II and III). It also does not report a recording failure to the user in any way — no
`encodeFailed`, no `ProcessJob` state change, one `console.error` and on with the encode.

Writes are confined to `services/worker/` and this directory. `src/ffmpeg/metadata.ts` is inside
`src/ffmpeg/`, which normally belongs to the **`ffmpeg` agent** (`.claude/agents/ffmpeg.md`); the
change here is a return-shape change with no effect on any selection rule and no new case in
`services/worker/ffmpeg/`. Touching a rule in `params.ts`, `buildCommand.ts` or the case corpus is
out of scope for this slice — stop and report instead.

## Files

| File | New / Modified | What changes |
| :-- | :-- | :-- |
| `services/worker/src/ffmpeg/metadata.ts` | Modified | `getMetadata` returns `{ metadata, raw }` — the parsed object plus the untouched stdout string |
| `services/worker/src/encode/types.ts` | Modified | `EncodeFn` gains a required `onProbe: (file: string, ffprobe: string) => Promise<void>` parameter, after `onProgress` |
| `services/worker/src/encode/index.ts` | Modified | Threads `onProbe` through to the selected driver |
| `services/worker/src/encode/encode.ffmpeg.ts` | Modified | Destructures `getMetadata`'s new return, `await onProbe(input, raw)` before `buildFfmpegCommand` |
| `services/worker/src/encode/encode.mock.ts` | Modified | Accepts and ignores `onProbe` (`_onProbe`) — the mock runs no `ffprobe` |
| `services/worker/src/jobs/encode.job.ts` | Modified | Defines `onProbe`, calls `recordFfprobe` inside its own `try/catch`, passes it to `encode(...)` |
| `services/worker/src/jobs/encode.job.spec.ts` | Modified | The three cases in § Tests |

## Existing code to reuse

- `src/jobs/encode.job.ts`'s `onProgress` closure — the exact pattern `onProbe` follows: defined in
  `handleEncode`, `await`ed, `fetchGraphQL` wrapped in its own `try/catch` whose `catch` only
  `console.error`s so a failed report never stops the encode. Copy the shape, not the throttling —
  `onProbe` fires once per encode and needs no `PROGRESS_STEP` equivalent.
- `src/api/graphql-client.ts`'s `fetchGraphQL` — the only way this service talks to `api`. It
  throws on `json.errors`, which is why the `try/catch` around the call is what implements NFR-1.
  Do not weaken the client itself; the swallowing belongs at this one call site, exactly as
  `onProgress` already does it.
- `src/encode/types.ts`'s `EncodeFn` — the driver seam. The new callback goes **on this type**, not
  as a GraphQL call inside `encode.ffmpeg.ts`: the driver is documented as free of database and
  GraphQL calls (its own header comment, `services/worker/CLAUDE.md` § "The encode driver seam"),
  and a network write hidden behind the FFmpeg-only driver cannot be reached by any test without
  FFmpeg. `../plan.md` § Approach records why returning the probe out of the driver was rejected.
- `src/ffmpeg/metadata.ts`'s existing `KeyedError(ERROR_ENCODE_PROBE_FAILED, …)` — unchanged. A
  failing probe still throws exactly as it does today; it never reaches `onProbe`.

## Steps

1. `src/ffmpeg/metadata.ts`: keep `stdout` alongside the parsed value and return
   `{ metadata: JSON.parse(stdout), raw: stdout }`. The `catch` branch is untouched.
   `encode.ffmpeg.ts` is the only caller (`grep -rn "getMetadata" src/`), so no other call site
   moves.
2. `src/encode/types.ts`: add `onProbe` to `EncodeFn` as a **required** parameter. Required, not
   optional: an optional callback that a call site forgets to pass compiles clean and records
   nothing, forever, with no error (`../plan.md` § Risks).
3. `src/encode/index.ts` and `src/encode/encode.mock.ts`: thread and ignore the new parameter
   respectively. The mock deliberately never calls it — it runs no `ffprobe`, and REQ-1 covers
   probes that produced output.
4. `src/encode/encode.ffmpeg.ts`: destructure `{ metadata, raw }`, then `await onProbe(input, raw)`
   **before** `buildFfmpegCommand`. `await`, not fire-and-forget: a container killed mid-encode must
   not lose the row that AC-4 is about. `durationSeconds` and everything downstream keep reading
   `metadata` unchanged.
5. `src/jobs/encode.job.ts`: define `onProbe` next to `onProgress`, inside the existing `try`, as

   ```
   mutation ($file: String!, $ffprobe: String!) {
     recordFfprobe(file: $file, ffprobe: $ffprobe) { id }
   }
   ```

   wrapped in `try/catch` that logs and returns. Pass it as the fifth argument to `encode(...)`.
   The `catch` covers the **`fetchGraphQL` call only** — not the probe, not the encode. Widening it
   would swallow a real `ffprobe` failure and let the encode continue with no metadata
   (`../plan.md` § Risks, second row).
6. Do **not** add the two new `error.ffprobeLog.*` keys to `src/i18n/error-keys.ts`. This service
   never renders them: the errors are swallowed at the call site and never reach `encodeFailed`.
   The three keys transcribed from `api` are there because the worker recognizes them; these two it
   only discards.

## Contract obligations

Consumes `recordFfprobe(file: String!, ffprobe: String!): FfprobeLog!` from `../spec.md` §
GraphQL Contract Delta. It selects `{ id }` and discards the result — nothing downstream reads a
field off it.

Every error condition in that table is handled the same way, deliberately: `error.ffprobeLog.empty_payload`,
`error.auth.unauthenticated` (a stale or missing `SERVICE_TOKEN`), a transport failure, or anything
unforeseen is caught, `console.error`ed, and the encode continues (NFR-1). There is no error here
this service reacts to differently, and none that reaches the user.

The delta is read-only. If it is wrong, stop and report — do not adapt it locally.

## Tests

`src/jobs/encode.job.spec.ts` — **extended**, three cases, all defending failures that are silent
by construction (Article IX). NFR-1 makes a broken recording produce no error anywhere; these are
the only place it can be caught.

- A successful encode issues `recordFfprobe` with the raw string the driver handed to `onProbe`,
  **before** `encodeCompleted` — assert on the ordering of the `fetchGraphQL` calls, not just that
  the mutation happened. Recording after the fact passes a naive happy-path test and fails REQ-1.
- A `recordFfprobe` that rejects still lets the encode reach `encodeCompleted`, and no
  `encodeFailed` is sent (NFR-1).
- A probe that throws still fails the encode with `error.encode.probe_failed` and sends **no**
  `recordFfprobe` — the guard against step 5's `try/catch` being written too wide.

Not owed, with reasons: `src/ffmpeg/metadata.ts`'s new return shape is checked by the compiler at
its one call site, and `src/encode/index.ts`'s threading of `onProbe` cannot fail silently — a
missing parameter is a type error, which is why step 2 makes it required. No new case belongs in
`services/worker/ffmpeg/`: no selection rule changes, and `cases.spec.ts` drives
`buildFfmpegCommand` directly with a parsed probe, never through `getMetadata`.

## Done when

```bash
bin/cli worker npx --no tsc --noEmit
bin/npm worker test
```

Typecheck reports 0 errors and the suite is green with the three added cases. End-to-end proof
(a row appearing mid-encode) is in `../plan.md` § Verification and needs `api`'s slice running.
