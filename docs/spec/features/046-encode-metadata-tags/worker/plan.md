---
title: Encode Metadata Tags — worker slice
service: worker
last_updated: 2026-09-04
status: Implemented
---

# PLAN: Encode Metadata Tags — `worker` (`worker/plan.md`)

## Scope

The worker owns the whole feature — no other service is touched, and there is no GraphQL or Prisma
change (`../spec.md` § GraphQL Contract Delta is **None**). Inside the service the work is split
between two owners, and the split is the most important line in this file:

- **`worker` agent** — composes the two tag values in a new pure module and carries them to the
  encode driver through `EncodeInput`. Steps 1–3 below.
- **`ffmpeg` agent** (`.claude/agents/ffmpeg.md`) — appends the two arguments in
  `src/ffmpeg/buildCommand.ts` and updates the case corpus in `services/worker/ffmpeg/`. Step 4
  below, and it is **not** a `worker` task: `src/ffmpeg/` and `ffmpeg/` are the `ffmpeg` agent's
  territory (`services/worker/CLAUDE.md`). A `worker` agent that finds itself editing
  `buildCommand.ts` has crossed a boundary — stop and report.

Explicitly not done here: nothing is written on the passthrough branch
(`src/encode/passthrough.ts`, `032-optional-compression`), which keeps ignoring `details`
entirely — NFR-1.

## Files

| File | New / Modified | What changes |
| :-- | :-- | :-- |
| `services/worker/src/metadata/container-tags.ts` | New | `buildContainerTitle` and `buildSourceTag` — the two pure string rules (REQ-1 to REQ-4, NFR-3) |
| `services/worker/src/metadata/container-tags.spec.ts` | New | Article IX cover for both rules |
| `services/worker/src/encode/types.ts` | Modified | `EncodeInput` gains `containerTitle: string` and `sourceTag: string`, both required |
| `services/worker/src/jobs/encode.job.ts` | Modified | Both `EncodeInput` literals (the passthrough call and the encode call) populate the two fields from the new module |
| `services/worker/src/ffmpeg/buildCommand.ts` | Modified — **`ffmpeg` agent** | Appends the two `-metadata` argument pairs after `-map_metadata:g -1` |
| `services/worker/ffmpeg/1.json`, `2.json` | Modified — **`ffmpeg` agent** | `input` gains the two fields; `ffmpeg` gains the two argument pairs at the pinned position |
| `services/worker/src/ffmpeg/cases.spec.ts` | Modified — **`ffmpeg` agent** | `CaseInput` and `validate()` accept and require the two new input fields |

## Existing code to reuse

- `src/paths/is-inside-root.ts` — the containment check NFR-3's fallback needs. It already handles
  an empty or missing root as "refuse", which is the behaviour wanted here (fall back to the base
  name). Do not write a second `startsWith` check.
- `src/paths/build-output-path.ts` — the precedent for this module's shape: a small pure function
  with its own local input type (`OutputPathInput`), deliberately not importing `EncodeJobDetails`.
  Follow it, including the local type. Do **not** reuse its `sanitize()` — see
  `../plan.md` § Contract Freeze; the tag values are verbatim.
- `src/encode/types.ts`'s `EncodeInput` — the existing seam for "resolved values the driver needs".
  The two new fields belong on it rather than a second parameter on `EncodeFn`.
- `node:path`'s `relative`/`basename` — `sourceTag` is a path operation, not string surgery on
  `inputFilePath`.

## Steps

1. Create `src/metadata/container-tags.ts` with a local input type and two exported functions.
   `buildContainerTitle`: `kind === 'MOVIE'` returns `title` verbatim; otherwise
   `` `${title} S${pad}-E${pad}` `` plus `` ` ${episodeTitle}` `` only when `episodeTitle` is a
   non-empty string (REQ-3). Season/episode zero-padded to two digits.
   `buildSourceTag`: if `isInsideRoot(downloadsRoot, inputFilePath)`, the path of `inputFilePath`
   relative to `downloadsRoot`, with POSIX separators and no leading slash; otherwise
   `basename(inputFilePath)` (NFR-3).
   No sanitization anywhere in this file.
2. Write `src/metadata/container-tags.spec.ts`, English `it(...)` strings, opening with the
   Article IX header naming the silent failure (see § Tests).
3. Add `containerTitle` and `sourceTag` to `EncodeInput` in `src/encode/types.ts` (required, not
   optional), then populate both from the new module at the **two** call-site literals in
   `src/jobs/encode.job.ts` — the `passthrough(...)` call and the `encode(...)` call. The
   passthrough driver ignores them; passing them keeps one shape for both drivers rather than
   growing a branch.
4. **`ffmpeg` agent task.** In `src/ffmpeg/buildCommand.ts`, after the existing
   `"-map_metadata:g", "-1"` entries and before the `ENCODE_SAMPLE_SECONDS` block, append
   `"-metadata", \`title=${details.containerTitle}\`` and
   `"-metadata", \`PERCEPTOR_SOURCE=${details.sourceTag}\``. Then widen `CaseInput`/`validate()` in
   `src/ffmpeg/cases.spec.ts` and add the two fields plus the two expected argument pairs to both
   JSON cases. Position matters and is pinned by the corpus assertion — see `../plan.md` § Risks.

## Contract obligations

None — this slice consumes no new GraphQL and produces none. The obligation that does apply is
negative and is the one to hold: **do not add a field to the `processJob(id)` query** in
`src/jobs/encode.job.ts`. `title`, `seasonNumber`, `episodeNumber`, `episodeTitle`, `inputFilePath`
and `downloadsRoot` are already in that selection set and already on `EncodeJobDetails`. If
something appears missing, stop and report (Constitution, Article VIII).

The queue payload (`src/queue/types.ts` / `services/api/src/queue/types.ts`) is untouched.

## Tests

- `src/metadata/container-tags.spec.ts` — **owed**, and this is the file the feature stands on.
  The failure it defends against is silent by construction: a wrong tag value produces a file that
  encodes fine, reports `COMPLETED`, plays fine, and is wrong forever in a way no log records. Cover
  at least: a film title verbatim including punctuation (`:` and `'` must survive, proving
  `sanitize()` was not reused); the episode form with two-digit padding for single-digit season and
  episode; `episodeTitle: null` producing no trailing separator (REQ-3); a nested source path
  relative to the root with no leading slash (REQ-4); and an `inputFilePath` outside
  `downloadsRoot` falling back to the base name, asserting the result contains no `/` (NFR-3).
- `src/encode/types.ts` and the `encode.job.ts` edit — **not owed**. Both fields are required on the
  type, so a call site that misses one fails the typecheck; there is no silent state to defend.
- `src/ffmpeg/` and the corpus — the `ffmpeg` agent's existing `cases.spec.ts` already asserts the
  whole ordered command, so updating the two cases *is* the test for step 4. No new spec file.

## Done when

```bash
bin/cli worker npx --no tsc --noEmit
bin/npm worker test
```

Typecheck clean (`strict: true`), and the suite green with a higher test count than before —
report the real numbers. Note that `src/ffmpeg/cases.spec.ts` has one pre-existing, unrelated
failure recorded in the root `CLAUDE.md` (a stale expected track-title string in `2.json`, present
since `039-per-title-language-split`); confirm at `HEAD` whether it is still there before attributing
it to this feature, and do not fix it as a side effect.
