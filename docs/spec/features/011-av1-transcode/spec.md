---
title: AV1 Transcode
spec_version: 0.1.0
author: Juan "Dientuki" Farias
created_at: 2026-08-17
last_updated: 2026-08-17
status: Implemented         # Draft | Approved | Implemented | Superseded
services: [api, web, worker]
---

# SPEC: AV1 Transcode (`spec.md`)

## Context & Goal

The root `CLAUDE.md` lists the Transcode stage as *not started*, and that is no longer true. The
real driver exists and runs today behind `ENCODE_DRIVER=ffmpeg`:
`services/worker/src/encode/encode.ffmpeg.ts` probes the file with `ffprobe`
(`src/ffmpeg/metadata.ts`), assembles an argument list from its streams
(`src/ffmpeg/buildCommand.ts` + `src/ffmpeg/params.ts`), and runs FFmpeg followed by an `mkvmerge`
remux and an atomic rename (`src/ffmpeg/runner.ts`). It converts H264 and VC-1 to AV1 with
`libsvtav1`, tonemaps 4K Dolby Vision and HDR10 down to 1080p SDR, transcodes the audio it keeps to
Opus, and drops every subtitle that is not text. What is missing is not the encoding — it is the
set of rules that decide *what* to keep.

Those rules are wrong or half-finished in four places. First, the languages are hard-coded:
`getAudioParams` and `getSubtitleParams` (`src/ffmpeg/params.ts`) always allow the original language
plus `spa` plus `eng`, and there is no language preference anywhere in the system — not in
`SETTINGS_CATALOG`, not on `User`, not on `Movie`/`Show`. Second, `getQuality` has its animation
branch commented out, so an anime title and a live-action title get the same CRF. Third, whether a
file is a disc remux is guessed from the *filename* (`buildCommand.ts` looks for the substring
`remux`), so a correctly named release that omits the word silently gets the web-grade CRF. Fourth,
`params.ts` is the most rule-dense file in the repository and has no tests at all — a wrong argument
there produces a `ProcessJob` marked completed and a file with the wrong audio, with no error in any
log (Constitution, Article IX).

This feature replaces those four rule sets. A user picks the languages they want — globally, and
additionally per title — and the encode keeps the original language plus the union of what every
owner of that title asked for. Quality selection stops guessing from filenames and reads the
container instead. A missing *original* audio track becomes a hard failure instead of a silent
fallback. When this ships, the Transcode row in the root `CLAUDE.md` moves to **working**, and the
`web` Settings screen and both detail pages (`/movies/<id>`, `/shows/<id>`, from `008-movie-detail`
and `009-show-detail`) gain a language picker.

## Requirements

> **Explicit assumption, flagged here so it is visible at approval time**: one list of languages
> governs both audio *and* subtitles. That is how the code behaves today — `getAudioParams` and
> `getSubtitleParams` receive the same `originalLang` and build the same allow-list — and how the
> feature was described. Two independent lists would double the join tables in *Data Model Changes*
> and the payload field in the contract delta.

### Functional Requirements

- [x] **REQ-1 (Global preference)**: A signed-in user must be able to choose **N** preferred
      languages (zero, one or several) that apply to every title in their library. Zero chosen
      languages means the encode keeps only the title's original language.
- [x] **REQ-2 (Per-title preference)**: A signed-in user must be able to choose **N** additional
      languages for one specific film or series. These are *added to* that user's global
      preference, never a replacement for it.
- [x] **REQ-3 (Merge across owners)**: The set of languages an encode is allowed to keep must be
      `{original language} ∪ ⋃(global preference of every owner) ∪ ⋃(per-title preference of every
      owner)`, deduplicated. A title with two owners keeps what both of them asked for, because the
      encode produces exactly one file and both of them will watch it. Ownership is the existing
      `UserMovie`/`UserShow` join (`005-movie-search`, `006-media-search`); for an episode it is
      resolved through its season's show.
- [x] **REQ-4 (One audio track per allowed language)**: For each allowed language present in the
      file, the encode must keep exactly one track — the best one, ranked by source codec
      (`truehd` > `dts` > `eac3` > `ac3` > anything else), then by channel count descending, then
      by bitrate descending. Tracks whose title contains `commentary`, `description`, `visual` or
      `sdh` must be discarded before ranking. When several Spanish tracks exist and at least one is
      titled `latin`/`latino`, the ranking must be restricted to those.
- [x] **REQ-5 (Audio output format)**: Every kept audio track must be re-encoded to Opus with VBR
      on, at 128k for stereo or less, 320k for 5.1, 512k for 7.1, carrying its `language` tag and a
      title naming the layout and the codec.
- [x] **REQ-6 (Missing original audio is a failure)**: If, after filtering, the file has no audio
      track in the title's original language, the job must fail — the `ProcessJob` ends `ERROR` (the
      `EncodeStatus` value; there is no `FAILED`) with a message naming the language that was
      missing, and no file is written to the library.
      This replaces today's fallback of copying every audio track untranscoded, which shipped a
      file with the wrong audio and reported success.
- [x] **REQ-7 (Missing extra language is not a failure)**: If a language a user asked for has no
      track in the file, the encode must continue with whatever is present and record what was
      missing in the job log. Only the original language is mandatory.
- [x] **REQ-8 (Subtitles: text only)**: The encode must keep only text subtitles — `subrip`,
      `mov_text` or `tx3g` — in an allowed language, and only when their `BPS` tag is greater than
      2 or absent. Image subtitles (PGS, VobSub) and empty tracks must be discarded. A kept
      subtitle whose title is empty or written entirely in capitals must have its title replaced
      with the language's name.
- [x] **REQ-9 (Quality)**: The CRF must be 20 when the title is not live action, 22 when the source
      is a disc remux, and 24 otherwise — evaluated in that order, so an animated remux gets 20.
- [x] **REQ-10 (Remux detection from the container)**: Whether a source is a remux must be decided
      from its `ffprobe` metadata, not its filename. A file must be treated as a remux when it
      carries a lossless audio track (`truehd`, `mlp`, any `pcm_*`, or `dts` with a `DTS-HD MA`
      profile) **or** when its video bitrate per pixel per frame is at least 0.25. That figure must
      be derived from the video stream's `bit_rate`, falling back to its `BPS` tag, falling back to
      `format.size / format.duration`. The filename remains the last resort only when no bitrate at
      all can be computed.
- [x] **REQ-11 (Video rules unchanged)**: The video decisions this feature inherits must keep
      behaving as they do today: H264 and VC-1 are converted to 10-bit AV1; HEVC at 4K is brought
      down to 1080p, tonemapped through `libplacebo` when it carries Dolby Vision or HDR10 and
      plainly rescaled when it is SDR; every other codec is copied. A file with no video stream is
      an error.

### Non-Functional & Operational Requirements

- [x] **NFR-1 (Rules are covered by tests)**: `src/ffmpeg/params.ts` and `src/ffmpeg/buildCommand.ts`
      must be covered by Vitest specs, including the missing-original-audio failure, the
      remux-detected-from-metadata case and the zero-preferences case. This is the point of the
      feature that Article IX bites hardest on: today a wrong argument in these two files produces a
      completed job and an unusable file.
- [x] **NFR-2 (Hand-retyped contract)**: The new `processJob` payload field crosses into `worker`
      with no codegen between the two services. It must be retyped by hand in
      `services/worker/src/jobs/encode.job.ts` (`EncodeJobDetails`) *and* in
      `services/worker/src/encode/types.ts` (`EncodeInput`), and recorded in
      `docs/spec/graphql-contract.md`, because nothing will fail to compile if one side drifts
      (Constitution, Article VIII).
- [x] **NFR-3 (The worker never queries the database)**: The owner merge of REQ-3 must be resolved
      inside `api` and delivered to the worker already computed, exactly as `outputRoot` is today.
      The worker receives a finished list of ISO-639-2 codes and performs no lookup of its own
      (Constitution, Article III).
- [x] **NFR-4 (Codes cross the boundary as ISO-639-2)**: The allowed-language list handed to the
      worker must be in ISO-639-2/B (`spa`, `eng`, `jpn`), because that is what `ffprobe` reports in
      `tags.language`. The UI and the stored preferences use ISO-639-1 (`es`, `en`, `ja`), matching
      `Movie.originalLanguage`/`Show.originalLanguage` as TMDB supplies them. The `languages` table
      is the only translation between the two.
- [x] **NFR-5 (No behaviour change for the mock driver)**: `ENCODE_DRIVER=mock` must keep working
      unchanged. It is what makes the rest of the pipeline testable without FFmpeg, and it ignores
      the encode details by design.

## GraphQL Contract Delta

### The encode payload gains the resolved language list

```graphql
type EncodeJobDetails {
  # …every existing field, unchanged…
  allowedLanguagesIso3: [String!]!
}
```

Resolved server-side in `services/api/src/process-jobs/process-jobs.service.ts`, already
deduplicated, with the title's original language always first. `worker` adds the field to the
`processJob(id)` query in `src/jobs/encode.job.ts` and forwards it into `EncodeInput`. Never empty:
the original language is always in it, which is what makes REQ-6 checkable.

`originalLanguageIso3` stays on the payload. It is no longer redundant with the first element of the
list — the worker needs to know *which* of the allowed languages is the mandatory one.

### Languages available to pick from

```graphql
type Language {
  id: ID!
  iso2: String!
  iso3: String!
  name: String!
}

type Query {
  languages: [Language!]!
}
```

Reads the `languages` table seeded by `services/api/prisma/seeds/languages.ts` (20 rows today).
`name` is the Spanish display name — user-facing copy — and is not stored in the table today; it is
derived server-side from `iso2`. The web language pickers are populated from this query and never
from a hard-coded list.

### A user's own global preference

```graphql
type User {
  # …every existing field, unchanged…
  preferredLanguages: [Language!]!
}

type Mutation {
  setPreferredLanguages(iso2: [String!]!): [Language!]!
}
```

`setPreferredLanguages` always acts on the **authenticated user**, never on a user named by
argument — it is a self-service setting on the Settings screen, not the admin `/users` surface of
`003-auth-user-management`. It **replaces** the whole list; there is no add/remove pair. Passing
`[]` clears the preference.

`User.preferredLanguages` is exposed on the existing `me` query (`services/api/src/auth/auth.resolver.ts`).
It is deliberately **not** added to the admin `users`/`user(id)` queries: an admin has no reason to
read what languages someone else prefers.

### A user's per-title preference

```graphql
type Movie {
  # …every existing field, unchanged…
  preferredLanguages: [Language!]!
}

type Show {
  # …every existing field, unchanged…
  preferredLanguages: [Language!]!
}

type Mutation {
  setMoviePreferredLanguages(movieId: Int!, iso2: [String!]!): [Language!]!
  setShowPreferredLanguages(showId: Int!, iso2: [String!]!): [Language!]!
}
```

Both mutations replace the authenticated user's list for that one title, and both are scoped exactly
like `movie(id)`/`show(id)` already are (`008-movie-detail`, `009-show-detail`): a title the caller
does not own is refused, it does not silently create the ownership row.

`Movie.preferredLanguages` and `Show.preferredLanguages` resolve to the **calling user's own** list
for that title, not the merged set of every owner. The merge is an encode-time concept and never
crosses into `web` — a user must not be shown another user's choices.

Neither mutation carries `@AllowService()`. `worker` has no business writing preferences; it reads
the already-merged result through `processJob(id)`, which is `@AllowService()` today and stays so.

### Errors

| Condition | GraphQL error | Message the user sees |
| :-- | :-- | :-- |
| An `iso2` in the argument is not a row in `languages` | `BadRequestException` | `El idioma <iso2> no está disponible` |
| The same `iso2` appears twice in one argument | `BadRequestException` | `El idioma <iso2> está repetido` |
| `setMoviePreferredLanguages` on a film the caller does not own | `NotFoundException` | `La película <id> no existe` |
| `setShowPreferredLanguages` on a series the caller does not own | `NotFoundException` | `Recurso no disponible para este usuario` |
| Any of the three mutations with a `SERVICE_TOKEN` principal | `UnauthorizedException` | `No autenticado` |

The two scoping messages are the ones `008-movie-detail` and `009-show-detail` already froze for the
same resources — reused verbatim, not new strings.

**What `web` does with each**: the Settings form and both detail-page pickers render the returned
message inline and leave the previous selection in place. The picker's options come from
`languages`, so the two `BadRequestException` rows are unreachable through the UI and exist to close
the mutation against a hand-written request.

**What `worker` does with REQ-6**: the failure is raised inside the encode driver, propagates out of
`handleEncode`'s `try`, and is reported through the existing `encodeFailed(processJobId, errorMessage)`
mutation. No new GraphQL surface — the message is Spanish because it reaches the user through the
job's `errorMessage`: `El archivo no tiene ninguna pista de audio en el idioma original (<iso3>)`.

## Data Model Changes

Each preference is a list of N languages, so a column will not do. Three new join tables, all
pointing at the `Language` table that already exists and is already seeded.

| Model | Change | Nullable / default | Backfill needed? |
| :-- | :-- | :-- | :-- |
| `UserLanguage` | New table: `userId` + `languageId`, composite PK, `Cascade` on both FKs | n/a — absence of a row is "not preferred" | No |
| `UserMovieLanguage` | New table: `userId` + `movieId` + `languageId`, composite PK, FK pair to `UserMovie`, `Cascade` | n/a | No |
| `UserShowLanguage` | New table: `userId` + `showId` + `languageId`, composite PK, FK pair to `UserShow`, `Cascade` | n/a | No |
| `Language` | Unchanged | — | No |
| `UserMovie`, `UserShow`, `User`, `Movie`, `Show` | Unchanged | — | No |

Pointing at `Language` rather than storing a loose `iso2` string buys something concrete: the row
already carries the `iso3` the worker needs, so the merge query of REQ-3 returns ISO-639-2 directly.
`resolveIso3` (`process-jobs.service.ts`) stays, but only for the title's original language, which is
an `iso2` string on `Movie`/`Show` with no relation behind it.

Cascading through `UserMovie`/`UserShow` rather than through `User` and `Movie` separately means
removing a title from a library takes its language choices with it, which is the intent — the
preference has no meaning without the ownership.

An empty list is the default for everyone, so no backfill exists to write. Article VII's migration
rule is satisfied by a single additive migration with three `CREATE TABLE`s and no `ALTER`.

## Acceptance Criteria

- [x] **AC-1**: Given a Japanese film owned by user A (global preference `es`, `pt`) and user B (no
      global preference, per-title preference `en`), when it is encoded, then `ffprobe` on the
      output reports exactly four audio streams, all `opus`, tagged `jpn`, `spa`, `por`, `eng`.
- [x] **AC-2**: Given a title no owner has set any preference on, when it is encoded, then the
      output has exactly one audio stream, in the original language.
- [x] **AC-3**: Given the file of AC-1 but with no Portuguese track, when it is encoded, then the
      job completes with three audio streams and `docker compose logs worker` names `por` as
      missing.
- [x] **AC-4 (failure path)**: Given a file whose only audio track is `eng` for a title whose
      original language is `jpn`, when it is encoded, then the `ProcessJob` row ends
      `status = ERROR` with `errorMessage` containing `jpn`, and no file exists under the library
      root — verified with `bin/mysql -e 'select status, errorMessage from process_jobs order by id
      desc limit 1'`.
- [x] **AC-5**: Given a 1080p Blu-ray remux whose filename does not contain the word `remux`, when
      it is encoded, then `ProcessJob.ffmpegCommand` contains `-crf 22`.
- [x] **AC-6**: Given a web-DL of the same title at ~8 Mbps, when it is encoded, then
      `ProcessJob.ffmpegCommand` contains `-crf 24`.
- [x] **AC-7**: Given a title with `isLiveAction = false`, when it is encoded, then
      `ProcessJob.ffmpegCommand` contains `-crf 20`, whether or not the source is a remux.
- [x] **AC-8**: Given a source carrying PGS subtitles and no text subtitles, when it is encoded,
      then `ffprobe` on the output reports zero subtitle streams.
- [x] **AC-9**: Given a signed-in user on `/settings`, when they select two languages and save,
      then reloading the page shows both still selected, and `bin/mysql -e 'select count(*) from
      user_languages'` returns 2.
- [x] **AC-10**: Given user A signed in, when they open a film that user B has set a per-title
      language on, then the picker shows A's own selection and not B's.
- [x] **AC-11**: `bin/npm worker test` passes, including the new `params` and `buildCommand` specs.
- [x] **AC-12**: `bin/cli api npx --no tsc --noEmit` and `bin/cli worker npx --no tsc --noEmit` each
      report 0 errors; `bin/cli web npx --no tsc --noEmit` still reports exactly the 11 known
      pre-GraphQL errors across the same 4 files (`services/web/CLAUDE.md` § Current state) and not
      one more.

## Out of Scope

- **Every SVT-AV1 parameter except the CRF.** `-preset 4`, `keyint`, `scd`, the animation-specific
  `aq-mode`/`enable-qm`/`sharpness` block and the 10-bit `pix_fmt` stay exactly as they are. They
  are tuned by hand against real encodes and changing them belongs in its own measured comparison,
  not in a feature about track selection.
- **Hardware acceleration** (QSV, NVENC, VAAPI). The worker container ships a CPU-only FFmpeg and
  nothing in the compose file passes a device through. Adding it means device mapping, a second
  encoder path and a per-host capability check.
- **Re-encoding 1080p HEVC.** It is copied today and stays copied: HEVC at 1080p is already an
  efficient codec, and a second lossy pass into AV1 costs hours to save little.
- **Removing `ENCODE_DRIVER=mock`.** It is what lets the surrounding workflow — output paths,
  torrent cleanup, the Jellyfin notification — be exercised without waiting hours for FFmpeg.
- **Two separate language lists for audio and subtitles.** See the assumption above the
  requirements; one list is the current behaviour and the described intent.
- **The commented-out `rename` in `services/worker/src/encode/encode.mock.ts`.** It is a manual
  testing aid with its reason written above it, not a bug this feature should fix.
- **The `movieId`/`episodeId` naming debt** recorded in the root `CLAUDE.md`. It crosses all three
  services with no codegen and is scheduled separately; folding it in here would make a partial
  rename break the download pipeline at runtime with no compile error anywhere.
- **Letting an admin edit another user's language preferences.** `setPreferredLanguages` is
  self-service by design. An admin surface for it would need its own justification on the `/users`
  screen.
