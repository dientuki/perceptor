---
title: Encode Metadata Tags — Implementation Plan
spec_version: 0.1.0
last_updated: 2026-09-04
status: Implemented
---

# PLAN: Encode Metadata Tags (`plan.md`)

## Approach

Three global `-metadata` arguments have to reach the FFmpeg command, and the whole design question
is **who composes the strings**. The values are pure functions of data the job already carries
(`title`, `seasonNumber`, `episodeNumber`, `episodeTitle`, `inputFilePath`, `downloadsRoot`), while
the place they are consumed — `services/worker/src/ffmpeg/buildCommand.ts` — sits inside
`src/ffmpeg/`, which belongs to the **`ffmpeg` agent** and its case corpus, not to the `worker`
agent (`services/worker/CLAUDE.md` § "The rules in `src/ffmpeg/` have their own agent").

So the seam is drawn to keep the composition out of there. A new pure module
`services/worker/src/metadata/container-tags.ts` produces the two ready-made strings —
`buildContainerTitle(details)` and `buildSourceTag(details)` — and they travel to the driver as two
new fields on `EncodeInput` (`src/encode/types.ts`). `buildFfmpegCommand` then does the smallest
thing it can: append `-metadata title=<containerTitle>` and `-metadata PERCEPTOR_SOURCE=<sourceTag>`
immediately after the existing `-map_metadata:g -1`, with no knowledge of films, series, episode
numbers or download roots. Every rule that could be got wrong is then testable as a pure function
outside `src/ffmpeg/`, and the corpus in `services/worker/ffmpeg/` grows two input fields rather
than two rules.

This mirrors the house pattern rather than inventing one: `EncodeInput` is already a deliberate
resolved *subset* of `EncodeJobDetails` (the four language lists arrive pre-merged by `api` for
exactly this reason), and `paths/build-output-path.ts` is already the precedent for "a small pure
module that composes one string out of the job's fields, with its own local input type". The
rejected alternative was passing the raw job fields down into `EncodeInput` and composing inside
`buildCommand.ts`: fewer files, but it puts an `S05-E07` formatting rule and a downloads-root
containment fallback behind the `ffmpeg` agent's door, where the only test harness is a corpus of
verbatim `ffprobe` dumps — a bad place to prove REQ-3's null episode title or NFR-3's escape case.

`src/paths/is-inside-root.ts` already answers "is this file under this root", and is reused for
NFR-3's fallback rather than a second containment check being written next to it.

## Order of Work

One service, two owners inside it. The ordering is not about services but about the fact that a
corpus case asserts the **whole ordered argument array**: the moment `buildCommand.ts` appends two
arguments, both JSON cases in `services/worker/ffmpeg/` fail until they carry the new input fields
and the new expected arguments. They are one change.

| Step | Owner | Why it must come here |
| :-- | :-- | :-- |
| 1 | `worker` | `src/metadata/container-tags.ts` and its test — a pure module with no dependency on anything below; can land and be green on its own. |
| 2 | `worker` | Widen `EncodeInput` (`src/encode/types.ts`) and populate the two fields at both call sites in `jobs/encode.job.ts`. Typecheck stays clean: the fields are consumed by nobody yet. |
| 3 | `ffmpeg` | Append the two arguments in `src/ffmpeg/buildCommand.ts` **and** update both cases in `services/worker/ffmpeg/` in the same step. Splitting these two leaves the suite red. |

Steps 1 and 2 can overlap; step 3 must not start before step 1 fixes the exact string forms, since
the corpus hard-codes the expected values.

## Contract Freeze

`spec.md`'s `## GraphQL Contract Delta` is **None**, and it is frozen as None. The implementer will
be tempted by exactly one thing:

- **Adding a field to the `processJob(id)` selection set.** Everything REQ-1 to REQ-4 needs is
  already in it and already typed on `EncodeJobDetails` (`src/jobs/encode.job.ts`). If a value
  appears to be missing, the query is being misread — stop and report rather than adding a field,
  which would be a contract change requiring `api` and a re-approval (Constitution, Article VIII).

Two further freezes that are not GraphQL but behave like a contract here:

- **`S05-E07` in the tag, `S05E07` in the file name.** They differ on purpose (spec REQ-2, § Out of
  Scope). An implementer noticing the mismatch and "fixing" `buildOutputPath` renames every episode
  file in every library.
- **No sanitization of the tag values** (NFR-4). `buildOutputPath`'s `sanitize()` exists because a
  filesystem rejects `:` and `/`; a Matroska tag does not. Reusing `sanitize()` here would look like
  consistency and would silently strip the punctuation REQ-2's own example depends on.

## Migrations

None.

## Risks

| Risk | How it fails | Mitigation |
| :-- | :-- | :-- |
| The tags are appended **before** `-map_metadata:g -1` | FFmpeg still exits 0 and the file lands in the library with no title and no source tag — no error anywhere, and nobody looks at an encode's argument array again | The two arguments are appended immediately after the strip, and the two corpus cases assert the full ordered array, so the position is pinned by the test rather than by a comment |
| `sanitize()` reused for the tag values | Titles quietly lose `:`/`-`/`'` — the file is fine, the tag is wrong, and it looks right at a glance | Named in § Contract Freeze; `container-tags.spec.ts` asserts a title with a colon and an apostrophe survives verbatim |
| `episodeTitle: null` rendered into the string | `The Boys S05-E07 null` in every episode of a series whose background fetch has not landed yet (`041-episode-info-refresh`) | REQ-3; a dedicated test case, since this is the shape of the data on the *first* encode of a fresh series, not an edge case |
| The two new `EncodeInput` fields are added to the type but not to one of the two call-site literals in `encode.job.ts` | TypeScript catches it — the fields are required, not optional | Deliberate: both fields are **required** on `EncodeInput`, following the same reasoning as `onProbe` (`services/worker/CLAUDE.md` § "The encode driver seam") — an optional field a call site forgets writes nothing forever, with no error |
| `inputFilePath` outside `downloadsRoot` | An absolute container path (`/downloads/…`) written into the file and shipped to the library, violating Article V in a place nobody greps | NFR-3's basename fallback, reusing `paths/is-inside-root.ts`, with its own test |

Not a risk, and deliberately untested: whether `mkvmerge`'s final remux preserves the global tags.
Verified by hand with `ffprobe` against a produced file before the spec was written (`spec.md`
§ Out of Scope).

## Verification

```bash
bin/cli worker npx --no tsc --noEmit
bin/npm worker test
```

The typecheck is the gate that proves step 2 reached both call-site literals; the suite is the gate
for the string rules and the corpus. Expect the suite count to rise by the new `container-tags`
tests and to stay green on the two existing cases with their updated expectations.

Manual pass, against a real encode:

1. With compression **on**, encode a film and an episode. `docker compose logs -f worker` prints the
   command; confirm `-metadata title=The Martian` (AC-1) and the `S05-E07` form (AC-2), and confirm
   `PERCEPTOR_SOURCE` is the release folder plus file name with no `/downloads` prefix (AC-4).
2. `ffprobe` the file that lands in the library and confirm both tags are on it — this is the only
   place the `mkvmerge` remux is observed rather than assumed.
3. Turn `compression_enabled` **off** in Settings and encode again: no FFmpeg runs, the moved file
   is untouched and carries neither tag (AC-6, NFR-1).
