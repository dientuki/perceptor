---
title: Content kind classification — worker slice
service: worker
last_updated: 2026-09-14
status: Implemented
---

# PLAN: Content kind classification — `worker` (`worker/plan.md`)

## Scope

This slice carries a title's content kind from the `processJob` payload to the SVT-AV1 arguments, and
turns the two-way boolean branch into three separately editable ones. It is split across **two
agents**, and the split is not optional:

| Steps | Agent | Territory |
| :-- | :-- | :-- |
| 1–4 | `worker` (`.claude/agents/worker.md`) | `src/encode/`, `src/jobs/` |
| 5–7 | `ffmpeg` (`.claude/agents/ffmpeg.md`) | `src/ffmpeg/`, `ffmpeg/` (the case corpus) |

The `worker` agent reads `src/ffmpeg/` and must not write there; the `ffmpeg` agent writes nowhere
else. A task that crosses the line is a stop-and-report on both sides.

Not this slice at all: the derivation, the enum, the GraphQL surface (`api`), and the detail-page
control (`web`). This service never queries a database and never re-derives a kind — it consumes
what the payload carries (Constitution, Articles II and III).

## Files

| File | New / Modified | What changes |
| :-- | :-- | :-- |
| `src/encode/content-kind.ts` | New | the worker-local `ContentKind` union and `normalizeContentKind(raw)` |
| `src/encode/content-kind.spec.ts` | New | the degradation cases (see § Tests) |
| `src/encode/types.ts` | Modified | `EncodeInput.isLiveAction: boolean` → `contentKind: ContentKind` |
| `src/jobs/encode.job.ts` | Modified | the query's field list, `EncodeJobDetails`, both `EncodeInput` literals, the `[encode]` log line |
| `src/jobs/encode.job.spec.ts` | Modified | its fixture moves to the enum |
| `src/ffmpeg/params.ts` | Modified (`ffmpeg` agent) | `getVideoParams`/`getQuality` take the kind; three branches |
| `src/ffmpeg/buildCommand.ts` | Modified (`ffmpeg` agent) | passes `details.contentKind` through |
| `src/ffmpeg/buildCommand.spec.ts`, `src/ffmpeg/params.spec.ts` | Modified (`ffmpeg` agent) | fixtures and expectations |
| `src/ffmpeg/cases.spec.ts` | Modified (`ffmpeg` agent) | validates `input.contentKind` against the three values |
| `ffmpeg/1.json`, `ffmpeg/2.json` | Modified (`ffmpeg` agent) | `input.isLiveAction` → `input.contentKind`, expected `-svtav1-params` updated |

## Existing code to reuse

- `src/metadata/container-tags.ts` — the house pattern for a small pure module with a locally
  declared type, imported by both `encode/types.ts` and `jobs/encode.job.ts`. `src/encode/content-kind.ts`
  is a third of these; it does not belong inside a driver and it is not an env read.
- `details.allowedAudioLanguageTags ?? []` in `handleEncode` — the precedent for *where* defensive
  normalization of a payload field lives (in the job handler, once, at the seam), and for the rule
  that only fields whose absence has a sane meaning get defended. `contentKind` is one of those by
  requirement (NFR-4); the two iso3 lists deliberately stay undefended and must stay that way.
- The existing `[encode] <id>: compressing=… allowedAudio…` log line — extend it with the resolved
  kind rather than adding a second line. It is how a live encode shows whether the seam carries the
  value at all.
- `EncodeCancelledError`'s treatment in `src/encode/cancellation.ts` — the precedent for "an internal
  condition that must never acquire a translation key". `normalizeContentKind`'s fallback is the same
  kind of thing: it logs, it never throws, and it never reports.
- `src/ffmpeg/params.ts`'s existing common `svtav1` array (`keyint`, `scd`, `enable-overlays`,
  `tune`, `input-depth`) and the five return sites that interpolate it — the `ffmpeg` agent's job is
  to make the branch decide the *differences*, per `.claude/agents/ffmpeg.md` § Governance, not to add
  a third almost-identical argument block.

## Steps

**`worker` agent:**

1. `src/encode/content-kind.ts`: the union `'LIVE_ACTION' | 'ANIME' | 'CGI'`, its runtime value list,
   and `normalizeContentKind(raw: string | null | undefined): ContentKind` returning `LIVE_ACTION`
   plus one `console.warn` naming the unrecognised value for anything else. Never throws.
2. `src/encode/types.ts`: `EncodeInput.isLiveAction` → `contentKind: ContentKind` (required, not
   optional — a driver must not be able to receive `undefined` here).
3. `src/jobs/encode.job.ts`: swap `isLiveAction` for `contentKind` in the `processJob` query's field
   list and in the `EncodeJobDetails` type (as `string`, matching how `kind`/`sourceKind` are
   retyped); call `normalizeContentKind` **once**, before the compression branch, and pass the result
   into both `EncodeInput` literals (the `passthrough` one and the `encode` one). Add the resolved
   value to the existing `[encode]` log line.
4. `src/jobs/encode.job.spec.ts`: move the fixture off the boolean. No new case is owed here
   (see § Tests).

**`ffmpeg` agent** (after step 3 lands — it imports the union from `../encode/content-kind`):

5. `src/ffmpeg/params.ts`: `getVideoParams(videoStream, contentKind, quality)` and
   `getQuality(contentKind, quality)`. Build the `svtav1` parameter string from three cases —
   `LIVE_ACTION`: `scm=0`, `aq-mode=2`, no `enable-qm`/`qm-min`, `sharpness=0`, `film-grain=0`;
   `ANIME` and `CGI`: `scm=2`, `aq-mode=2`, `enable-qm=1`, `qm-min=4`, `sharpness=2`, `film-grain=0`.
   `ANIME` and `CGI` stay **two cases producing equal output**, by requirement (REQ-11) — do not
   collapse them, and do not fall one through to the other in a way that makes editing one alone
   awkward. `getQuality` keeps returning exactly today's values; the CRF-per-kind experiment is out
   of scope (`../spec.md` § Out of Scope). The dead commented-out blocks this branch carries today
   (the `// params cgi` note, the 3D-animation prose block, the `//anime 20, remux 22` lines) go with
   the change — Article XI.
6. `src/ffmpeg/cases.spec.ts`: validate `input.contentKind` is one of the three literals and fail the
   named file otherwise — a fixture still carrying `isLiveAction` must fail collection loudly, never
   be defaulted (NFR-7).
7. `ffmpeg/1.json`, `ffmpeg/2.json`, `buildCommand.spec.ts`, `params.spec.ts`: move each fixture to
   `contentKind` and update the expected `-svtav1-params` strings. **`LIVE_ACTION` legitimately
   changes**: it gains `aq-mode=2`, `sharpness=0` and `film-grain=0`, so every live-action
   expectation in the corpus changes and a wrong new string looks exactly like a right one. Report
   `bin/npm worker test`'s failure list **before and after**, and account for every difference.

## Contract obligations

Consumed from `../spec.md` § GraphQL Contract Delta:

- `EncodeJobDetails.contentKind: ContentKind!` replaces `isLiveAction: Boolean!`. The query must
  select `contentKind`; selecting the removed field fails the whole operation at runtime, and
  `src/api/graphql-client.ts` throws on `json.errors`, so the job fails rather than encoding wrongly.
- **The value is not trusted.** An absent, `null` or unrecognised `contentKind` must encode as
  `LIVE_ACTION` and log (NFR-4) — never throw, never `encodeFailed`. This is the one place in this
  service where a missing payload field is deliberately defended rather than left to fail loudly.
- With `compressionEnabled === false`, `passthrough.ts` still ignores `details` entirely (REQ-12).
  It receives a `contentKind` and uses nothing from it; that stays true.

This service never calls `setMovieContentKind`/`setShowContentKind` and never reports a kind back.
The delta is read-only: if a rule needs a field the payload does not carry, stop and report — that is
an `api` contract change.

## Tests

Owed under Article IX:

- `src/encode/content-kind.spec.ts` — `normalizeContentKind` is the whole degradation path. A
  fallback that threw would fail every encode on an older `api`; a fallback that silently picked
  `ANIME` would mistune every live-action film with nothing failing anywhere. Cover: each of the
  three valid values returned unchanged, an unknown string, `undefined` and `null` all returning
  `LIVE_ACTION`, and that each fallback logs rather than throws.
- `src/ffmpeg/cases.spec.ts` + the corpus (`ffmpeg` agent) — the existing mechanism *is* the test for
  the argument rules: a wrong `-svtav1-params` string produces a file that plays, a job that reports
  `COMPLETED`, and nobody finding out. Any live-action case plus one `ANIME` and one `CGI` case must
  be represented; if the corpus cannot supply a real `ffprobe` for an animated file yet, cover the
  three branches in `params.spec.ts` instead and say so in the report.

Not owed: the field rename in `encode.job.ts`'s query and both `EncodeInput` literals. A missed
literal is a typecheck error, because `EncodeInput.contentKind` is required and not a `string`.

**Two pre-existing failures are expected before this slice starts** and must be reported, not fixed
or hidden: `src/ffmpeg/cases.spec.ts`'s stale track title in `ffmpeg/2.json` and
`src/ffmpeg/buildCommand.spec.ts`'s CRF mismatch. `bin/cli worker npx --no tsc --noEmit` separately
reports 2 pre-existing errors in `src/metadata/container-tags.spec.ts` (`TS2554`), unrelated to this
feature and out of scope. Confirm the set is exactly these before changing anything, so "still
exactly those" is a checkable claim afterwards.

## Done when

```bash
bin/cli worker npx --no tsc --noEmit
bin/npm worker run build
bin/npm worker test
grep -rn "isLiveAction" services/worker/src services/worker/ffmpeg
```

The build exiting 0, the grep printing nothing, the typecheck reporting only the 2 known
`container-tags.spec.ts` errors, and `bin/npm worker test` accounted for line by line against the
pre-existing failure list above.
