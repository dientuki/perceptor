---
title: Film Grain Optimization — worker slice
service: worker
last_updated: 2026-10-15
status: Implemented
---

# PLAN: Film Grain Optimization — `worker` (`worker/plan.md`)

## Scope

This service turns the already-resolved `EffectiveGrainMode` it receives into two SVT-AV1
parameters, and owns the one decision `api` deliberately did not make: what `AUTO` means. In this
feature `AUTO` means "no grain", unconditionally — a stub function that is the entire subject of the
next spec and the only thing it will replace.

It does **not** read the `grain_auto_enabled` Setting (it cannot — service principal, admin-only
query), does not know the title's own override exists, and must never interpret a literal `INHERIT`
on the payload as anything but an unrecognised value.

Writes are confined to `services/worker/` and this directory. Anything else is a stop-and-report.

## Files

| File | New / Modified | What changes |
| :-- | :-- | :-- |
| `services/worker/src/encode/grain-mode.ts` | New | The local `GrainMode` union, `normalizeGrainMode`, and `resolveFilmGrain` (the stub) |
| `services/worker/src/encode/grain-mode.spec.ts` | New | Article IX suite for both functions |
| `services/worker/src/encode/types.ts` | Modified | `grainMode: GrainMode` on `EncodeInput` |
| `services/worker/src/jobs/encode.job.ts` | Modified | `grainMode` on the `EncodeJobDetails` type and in the query string; `normalizeGrainMode`; the log line; both `EncodeInput` literals |
| `services/worker/src/ffmpeg/buildCommand.ts` | Modified | `resolveFilmGrain(details.grainMode, metadata)` → boolean into `getVideoParams` |
| `services/worker/src/ffmpeg/params.ts` | Modified | `filmGrain: boolean` threaded through `getVideoParams` → `buildAv1EncodeArgs` → `svtav1KindParams` |
| `services/worker/src/ffmpeg/params.spec.ts` | Modified | Grain on/off cases for all three content kinds |

## Existing code to reuse

- `src/encode/content-kind.ts` — the template for `grain-mode.ts`, down to the file comment
  explaining why the union is retyped locally instead of imported. Same shape: a `readonly` values
  array, a private type guard, and a `normalize*` that logs once and degrades. `resolveFilmGrain` is
  the only member with no counterpart there.
- `src/encode/compression-resolution.ts` — the second instance of that same normalizer shape; read
  both before writing a third, and do not invent a variant.
- `src/jobs/encode.job.ts`'s existing normalize block — `contentKind`, `compressionResolution`,
  `libraryLayout` and `allowedSubtitleFormats` are all normalized immediately after the query
  returns, then included in the single `[encode]` log line. `grainMode` joins both, in order, but
  **gated on the `compressing` boolean declared right above them** (REQ-10) — it is the one
  normalizer in that block that must not run when compression is off.
- `src/ffmpeg/params.ts`'s `svtav1KindParams(contentKind)` — the three-arm switch whose trailing
  `film-grain=0` is what this feature makes conditional. The arms stay three arms (`057` split them
  on purpose); `ANIME` and `CGI` are identical today and still must not be merged.
- `src/ffmpeg/params.spec.ts`'s helper that extracts the `-svtav1-params` value from the built
  argument array (`args.indexOf('-svtav1-params')`) — the new cases read through it, not through a
  second extractor.
- `src/ffmpeg/buildCommand.ts`'s existing `quality = isRemux(metadata, input)` line — the precedent
  for deriving an encode decision from the probed metadata at that point in the function. The grain
  resolution goes next to it.

## Steps

1. New `src/encode/grain-mode.ts`:
   - `export type GrainMode = 'AUTO' | 'ON' | 'OFF'` plus `GRAIN_MODE_VALUES`.
   - `normalizeGrainMode(raw: string | null | undefined): GrainMode` — absent, null or unrecognised
     (**including the literal `'INHERIT'`**, which `api` must never send and which this service must
     not try to interpret) degrades to `OFF` and `console.warn`s once, in the `[grain]` prefix style
     `content-kind.ts` uses. It must never throw.
   - `resolveFilmGrain(mode: GrainMode, metadata: unknown): boolean` — `ON` → `true`, `OFF` →
     `false`, `AUTO` → `false`, logging the mode it resolved. This is the only function in the
     slice that logs on the happy path, and it is deliberate: it runs beside the FFmpeg command
     being built, so the log line and the `-svtav1-params` string it produced appear together. The
     `metadata` parameter is accepted and **unused** in this feature: it is the seam the next spec
     needs, and taking it now is what keeps that spec to one function. State that in the spec
     locator, not in prose.
2. `src/encode/types.ts`: add `grainMode: GrainMode` to `EncodeInput` (the tri-state, not a boolean
   — see `../plan.md` § Approach for why the resolution happens later).
3. `src/jobs/encode.job.ts`:
   - add `grainMode: string` to the local `EncodeJobDetails` type;
   - **add `grainMode` to the query string** — the field list is hand-written with no codegen, and
     omitting it is this slice's one silent failure (the feature stops working while every encode
     still succeeds);
   - `const grainMode = compressing ? normalizeGrainMode(details.grainMode) : 'OFF'` beside the
     other normalizers. **The ternary is the requirement, not a micro-optimization** (REQ-10): with
     compression off nothing about grain may run, and an unconditional call would print NFR-3's
     warning for a job that is never going to reach FFmpeg;
   - include `grainMode=${grainMode}` in the existing `[encode]` log line;
   - pass `grainMode` in **both** `EncodeInput` literals — the `passthrough` one and the `encode`
     one. `passthrough` ignores `details` entirely (compression off, REQ-10), but the literal must
     still typecheck and stay symmetrical with its twin.
4. `src/ffmpeg/buildCommand.ts`: `const filmGrain = resolveFilmGrain(details.grainMode, metadata)`
   next to the `quality` line, passed as the new last argument to `getVideoParams`. This function is
   reached **only** on the compressing path — `passthrough` never calls it and ignores `EncodeInput`
   entirely — which is what makes REQ-10 structural here rather than a check someone has to
   remember to write.
5. `src/ffmpeg/params.ts`: thread `filmGrain: boolean` through `getVideoParams` →
   `buildAv1EncodeArgs` → `svtav1KindParams`. In each of the three `case` arms, the trailing
   `"film-grain=0"` becomes `"film-grain=8", "film-grain-denoise=1"` when `filmGrain` is true.
   **When false the string must carry `film-grain=0` and no `film-grain-denoise` term at all**
   (REQ-7) — a leftover denoise term runs a denoise pass with no grain synthesis, which looks like
   nothing more than a slightly soft encode. Everything else in the string — `keyint=10s`, `scd=1`,
   `enable-overlays=1`, `tune=0`, `input-depth=10`, and each kind's own terms — is untouched.
   The two copy paths (`copyVideoArgs`, unrecognised codec and AV1-within-ceiling) never reach
   `buildAv1EncodeArgs` and need no change.

## Contract obligations

Consumed from `../spec.md` § GraphQL Contract Delta, read-only:

- `EncodeJobDetails.grainMode: EffectiveGrainMode!` — `AUTO` | `ON` | `OFF`, non-null. `INHERIT`
  never arrives; if one does, that is an `api` bug, and this service's correct response is the
  `OFF` + warning path, not a workaround.
- `EncodeJobDetails.compressionEnabled: Boolean!` — unchanged by this feature, but now load-bearing
  for it: `false` means the grain mode is never normalized, never resolved and never logged
  (REQ-10). This slice reads it through the `compressing` boolean that already exists.
- There is **no error condition on this field**. It is part of a query that already fails as a whole
  when `api` is unreachable (`fetchGraphQL` throws on `json.errors`, deliberately — see
  `services/worker/CLAUDE.md`). The only failure mode this slice owns is the degradation in NFR-3,
  and it is not an error: absent/null/unrecognised → `OFF` + exactly one log line, never a throw,
  never a failed encode. An `api` that has not shipped the field yet yields `undefined`, which
  resolves to `OFF`, which is byte-identical to today's behaviour.
- Nothing is reported back: this slice adds no mutation, no field to an existing mutation, and no
  new payload on `encodeCompleted`/`encodeFailed`.

## Tests

- `src/encode/grain-mode.spec.ts` — **owed**, both halves. `normalizeGrainMode`'s degradation is a
  textbook silent failure: `undefined` in, a successful grain-free encode out, no error anywhere —
  which is exactly what a forgotten query field produces, so the case that pins `undefined → OFF`
  *and the warning* is what makes that mistake visible in a log instead of invisible. `'INHERIT'`
  gets its own case, since it is the one unrecognised value a reader would expect to be handled.
  `resolveFilmGrain` is owed its `AUTO → false` case for a different reason: it is the function the
  next spec rewrites, and this is the assertion that documents what it means today.
  Open with the Article IX header naming the failure class.
- `src/ffmpeg/params.spec.ts` — **owed**, six cases: each of `LIVE_ACTION`/`ANIME`/`CGI` with grain
  on and off. The on cases assert `film-grain=8` **and** `film-grain-denoise=1` and that the kind's
  own terms are unchanged (REQ-8); the off cases assert `film-grain=0` and
  `not.toContain('film-grain-denoise')` (REQ-7). The existing three `film-grain=0` assertions stay
  — they become the off-path cases.
- `src/jobs/encode.job.ts`'s wiring and `src/encode/types.ts` — **not owed**. A missing field on
  `EncodeInput` or a literal that does not supply it is a compile error under `strict: true`. The
  one thing in this file that *can* fail silently — the query string — cannot be caught by a unit
  test either (there is no schema to check it against); it is covered by the mandatory log line and
  by AC-3's live pass, not by a spec file.
- `src/ffmpeg/buildCommand.ts` — **not owed** on its own: it threads one boolean, and both ends of
  the thread are covered above.

## Done when

```bash
bin/cli worker npx --no tsc --noEmit
bin/npm worker test
bin/comments worker
```

Typecheck 0 errors, the suite green with the new cases, and the comment gate clean — every new
comment must be either the Article IX test header or a well-formed `// Spec 092, REQ-n` locator.
