---
title: Plex media server client — worker slice
service: worker
last_updated: 2026-09-26
status: Implemented
---

# PLAN: Plex media server client — `worker` (`worker/plan.md`)

## Scope

`worker` makes the destination path layout-aware. It receives one new string on the encode job's
details, `libraryLayout`, and uses it to pick a path builder. That is the entire slice.

It is explicitly **not** doing, and must never do: learning which media server is configured,
reading a client id, host, port or token, or calling a media server. `NFR-3` is the hard boundary —
the worker knows *layouts*, which are naming conventions, and treats the value as opaque data it
neither validates against a roster of products nor reasons about. Adding a media server that reuses
an existing layout must require no change in this service at all.

No FFmpeg argument changes: `src/ffmpeg/` is owned by the `ffmpeg` agent and is not in this slice.
No change to `is-inside-root.ts` (frozen by `047`) or to the cleanup path.

Writes are confined to `services/worker/` and this directory.

## Files

| File | New / Modified | What changes |
| :-- | :-- | :-- |
| `services/worker/src/paths/build-output-path.spec.ts` | New | **Step 0** — characterization test of the current behaviour, written before anything moves |
| `services/worker/src/paths/library-layout.ts` | New | The layout union and `normalizeLibraryLayout` |
| `services/worker/src/paths/library-layout.spec.ts` | New | The normalizer's degradation cases |
| `services/worker/src/paths/build-output-path.ts` | Modified | Split into a shared part plus one builder per layout; same exported signature |
| `services/worker/src/jobs/encode.job.ts` | Modified | `libraryLayout` on the local `EncodeJobDetails` type **and** in the `processJob` selection set, normalized and logged beside `contentKind` |

## Existing code to reuse

- `src/encode/content-kind.ts` and `src/encode/compression-resolution.ts` — the exact template for
  `library-layout.ts`: a local union, a `readonly` values array, a private type guard, and a
  `normalize…` that returns the default and `console.warn`s rather than throwing. Copy the shape,
  including the comment explaining why it never throws. `library-layout.ts` lives in `src/paths/`
  rather than `src/encode/` because the value is consumed by the path builder, not by the encoder.
- `src/paths/build-output-path.ts` — `sanitize()`, `pad2()`, the `(0000)` year fallback and the
  `ERROR_ENCODE_EPISODE_NUMBERS_MISSING` guard are **shared by both layouts**. Do not copy them into
  a second file; lift them to module scope in the same file and have both builders call them.
- `src/paths/with-source-extension.ts` — unchanged, and it must keep working for both layouts: it
  swaps the extension on whatever string `buildOutputPath` returned. Do not special-case it.
- `src/jobs/encode.job.ts:102-106` — where `normalizeContentKind` and `normalizeCompressionResolution`
  are already called and logged in the single `[encode]` line. `normalizeLibraryLayout` goes beside
  them, in the same line.

## Steps

1. **Step 0, before touching anything.** Write `src/paths/build-output-path.spec.ts` against the
   current implementation. Pin the cases the file's own comment says were verified against the real
   library — `Alita: Battle Angel` → `Alita Battle Angel`, `X-Men: First Class` → `XMen First Class`,
   `Lisey's Story` → `Liseys Story`, `Dungeons & Dragons…` and `The Super Mario Bros. Movie` keeping
   `&` and `.` — plus a film with a null year (`(0000)`), an episode with and without a title, season
   0 padding to `Season 00`, and the missing-episode-numbers throw. Run it green **before** step 3.
   This is the only thing standing between the split and a silent library fork (REQ-16).
2. **`library-layout.ts`** — `export type LibraryLayout = 'jellyfin' | 'plex'`,
   `LIBRARY_LAYOUT_VALUES`, and `normalizeLibraryLayout(raw: string | null | undefined): LibraryLayout`
   returning `'jellyfin'` with a `console.warn` for absent, null or unrecognised input (REQ-18).
3. **`build-output-path.ts`** — widen `OutputPathInput` with `layout: LibraryLayout` and split the
   body into `jellyfinPath(details)` and `plexPath(details)` behind the unchanged exported
   `buildOutputPath`. The Jellyfin branch must be the current code moved, not rewritten.
   The Plex branch (REQ-17):
   - film → `<outputRoot>/<Title> (<Year>) {tmdb-<id>}/<Title> (<Year>) {tmdb-<id>}.mkv`
   - episode → `<outputRoot>/<Title> (<Year>) {tmdb-<id>}/Season <NN>/<Title> - S<NN>E<NN> - <Episode title>.mkv`,
     dropping ` - <Episode title>` entirely when there is no episode title.
   `sanitize()` already strips `-` from titles, so the ` - ` separators are unambiguous — do not
   change `sanitize()` to preserve dashes.
4. **`encode.job.ts`** — add `libraryLayout: string` to the local `EncodeJobDetails` type **and**
   `libraryLayout` to the `processJob` selection set, in the same edit (the standing rule in
   `services/worker/CLAUDE.md`: a field added to one and not the other is a silent `undefined`). Call
   `normalizeLibraryLayout(details.libraryLayout)`, include it in the `[encode]` log line, and pass
   it into the existing single `buildOutputPath(details)` call at line 119.

## Contract obligations

Consumed from `../spec.md` § GraphQL Contract Delta, read-only:

```graphql
type EncodeJobDetails { libraryLayout: String! }
```

- It is a **string, not an enum**, precisely so an unrecognised value is this service's problem to
  degrade on rather than a query that fails to deserialize.
- **Error conditions this consumer owns**: there are none on the wire. An absent, null or
  unrecognised `libraryLayout` is *not* an error — it resolves to `jellyfin` and logs (REQ-18). It
  must never throw, never fail the job, and never be reported through `encodeFailed`. An older `api`
  that does not send the field must keep encoding normally.
- The worker sends nothing new back: `encodeCompleted`/`encodeFailed` are unchanged.
- Everything else on `EncodeJobDetails` keeps its current meaning. `outputRoot` in particular stays a
  resolved absolute path this service joins onto and never re-derives (`048`, Article V).

If the field's name or nullability appears wrong, stop and report — do not adapt it locally
(Article VIII).

## Tests

Owed under Article IX:

- `src/paths/build-output-path.spec.ts` — the whole reason this slice is risky. A regression in the
  Jellyfin branch produces a file that plays, a job that reports `COMPLETED`, and a library that has
  quietly forked into two naming schemes with no error in any log. After step 3 it must cover both
  layouts for both kinds, and the Jellyfin cases must be **unchanged** from step 0.
- `src/paths/library-layout.spec.ts` — that an absent, null, empty or unknown value returns
  `'jellyfin'` and warns rather than throwing. AC-12 is exactly this test.

**Not owed**: the `encode.job.ts` wiring itself. `encode.job.spec.ts` already mocks
`buildOutputPath`, and a missing selection-set field is caught by AC-6/AC-7's live pass, not by a
unit test that would have to mock the very GraphQL response it is asserting about.

## Done when

```bash
bin/cli worker npx --no tsc --noEmit
bin/npm worker run build
bin/npm worker test
```

`bin/npm worker test` is expected to carry the 3 pre-existing, unrelated `src/ffmpeg/` failures first
recorded under `058-compression-resolution` (the `buildCommand.spec.ts` CRF mismatch and the stale
`ffmpeg/1.json`/`2.json` corpus cases). Confirm it is still exactly those three and no others —
`src/ffmpeg/` is untouched by this slice.
