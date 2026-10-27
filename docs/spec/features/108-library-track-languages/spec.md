---
title: Library Track Languages
spec_version: 0.1.1
author: Juan "Dientuki" Farias
created_at: 2026-10-27
last_updated: 2026-10-27
status: Approved
services: [api, worker, web]
---

# SPEC: Library Track Languages (`spec.md`)

## Context & Goal

A title's detail page says nothing about what its library file actually holds. A user who wants to
know whether a film already has Spanish subtitles, or which audio languages an episode came with,
has to open the file in Jellyfin or run `mkvinfo`. Perceptor never records it: `FfprobeLog` stores
the probe of the *input* file of an encode, not the file that ends up in the library, and a title
the media server already held when it was registered (`mediaServerPresentAt`, no `filePath`) never
went through the worker at all. `107`'s probe reads embedded subtitles and sidecars, but only for a
subtitle search, keeps no audio, and stores its result on the search, not on the title.

This feature reads every library file's audio and subtitle languages and keeps them on the title.
`worker` gets a read-only `library-probe` job that reports a file's audio languages, its embedded
non-forced subtitle languages and its sidecar tags, reusing `107`'s `embedded-languages` and
`sidecars` units. `api` stores the result on `Movie` and `Episode`, resolves sidecar tags against
its `Language` table as `107` does, and queues a read whenever the file may have changed: a
delivery, an embed, a registration or Refresh that finds the title on the media server, and once
for every title already in the library when this ships. A title with no `filePath` is located
through the media server as `107` REQ-4 does.

`web` shows it. A film's page gets two informational boxes under the poster, styled like the search
box: an eighth-note icon followed by one chip per audio language, and a captions icon followed by
one chip per subtitle language, each chip the ISO 639-2 code. A series' episode table gets a new
column with three rows per episode: the same two lines, and the `106` "Buscar subtítulos" button,
which moves there. No pipeline stage changes status; this adds a read-only branch beside the
**Notify media server** and **Browse library** stages.

## Requirements

### Functional Requirements

- [ ] **REQ-1 (What is read)**: For one library file, Perceptor records:
      - **audio languages**: the ISO 639-2 language of every audio track, normalized as the
        worker's existing `normalizeIso3` does (`fra` → `fre`); a track with no language tag or
        `und` is left out;
      - **subtitle languages**: the languages of the embedded non-forced subtitle tracks, any codec, plus the
        languages of the file's sidecars (`<base>.<tag>[.<flag>].<ext>`, `107` REQ-3's rules: exact
        `<base>.` prefix, a `forced`/`foreign` flag drops the file), each sidecar tag resolved to
        ISO 639-2 by `api` against its `Language` table, an unresolvable tag left out. An embedded
        and a sidecar track of the same language are one entry.
        A forced subtitle track (one that carries only the lines spoken in a foreign language or
        written on screen, not the whole dialogue) is left out, as in `107`: a film whose only
        Spanish track is forced does not have Spanish subtitles. That holds for an embedded track
        (`disposition.forced`) and for a sidecar flagged `forced`.

      Both lists are sets: no duplicates, order of first appearance in the file (embedded tracks
      before sidecars).
- [ ] **REQ-2 (Where the file is)**: The file read is the title's `filePath` when it has one.
      Otherwise, when the media server holds the title (`mediaServerPresentAt`), it is the path the
      configured media server reports for it, translated to a container path, as `107` REQ-4 does
      for a manual search (Jellyfin or Plex). With no media server, or a media server that does not
      know the title, nothing is read and nothing is stored.
- [ ] **REQ-3 (When it is read)**: A read is queued:
      1. when an encode delivers a film or an episode (compression on or off);
      2. when a subtitle embed completes (`101` or `103`/`106`/`107`);
      3. when a registration's media-server reconciliation, or a title's Refresh, finds that the
         media server holds a film or episode (both the promotion to `COMPLETED` and a title already
         `COMPLETED` that the Refresh confirms);
      4. once, after this feature's migration, for every film and episode that has a `filePath` or a
         `mediaServerPresentAt` and no recorded read.

      A film or episode never has more than one read queued at a time; queueing one while another
      is queued or running is a no-op.
- [ ] **REQ-4 (Read replaces, loss clears)**: A completed read replaces the title's two lists and
      its read time, even if they are identical. When a title loses its file (Refresh demotes it to
      `MISSING`, or its last owner removes it), its lists and read time are cleared. A read that
      fails leaves the previous lists untouched.
- [ ] **REQ-5 (Stale result)**: A read reports the path it read. If, when the report arrives, that
      is no longer the title's file (a replacement was delivered while it ran), the report is
      discarded; the replacement's own delivery queued a fresh read.
- [ ] **REQ-6 (Film page)**: Under the poster, a film whose file has been read shows two boxes, the
      same shape and border as the header search box:
      - the eighth-note icon followed by one chip per audio language;
      - the captions icon followed by one chip per subtitle language.

      Each chip is the ISO 639-2 code, shown in upper case (`SPA`, `ENG`). A box whose list is empty
      shows a single muted `—`. A film whose file was never read, or that has no file, shows neither
      box.
- [ ] **REQ-7 (Episode column)**: The season accordion's episode table gains one column. For each
      episode it holds three rows: the audio line, the subtitle line (same icon and chips as REQ-6,
      smaller), and the `106` "Buscar subtítulos" button, which leaves the place it has today. The
      button keeps exactly `106`'s visibility rules. An episode never read shows the button row only;
      an episode with nothing to show in any row leaves the cell empty.
- [ ] **REQ-8 (Everyone sees it)**: The lists are a property of the file, the same for every owner,
      and readable by any user who can see the title today. No setting, preference or role gates
      them.

### Non-Functional & Operational Requirements

- [ ] **NFR-1 (Read-only)**: The read opens the library file and lists its directory, nothing else:
      no write, no rename, no temporary file under the destinations root (Article XII). `ffprobe`
      is the only external process.
- [ ] **NFR-2 (Never in the way)**: Reads run on their own queue with concurrency 1, so an encode,
      a scan or a subtitle remux is never waiting behind them. The one-time pass of REQ-3.4 on a
      large library (thousands of episodes) only fills that queue; it never delays boot, and `api`
      answers requests while it drains.
- [ ] **NFR-3 (Failure is quiet)**: A file that cannot be read (missing, unreadable, `ffprobe`
      fails) is logged by the worker with the title and path, keeps its previous lists (REQ-4) and
      surfaces no error to any user. A read is never retried on its own; the next trigger reads it
      again.
- [ ] **NFR-4 (Interrupted)**: A read lost to a worker crash is not recovered; the title keeps its
      previous lists until the next trigger. No row tracks reads in flight.
- [ ] **NFR-5 (Tests)**: Article IX cases: audio `und`/untagged left out and `fra` → `fre`; embedded
      and sidecar of one language counted once; a report whose path is not the title's file
      discarded; loss of the file clears the lists; a second queue request while one is pending is
      a no-op; the one-time pass skips a title that already has a read.

## GraphQL Contract Delta

```graphql
extend type Movie {
  """ISO 639-2 audio languages of the library file (108 REQ-1); null while the file has never been read."""
  fileAudioLanguages: [String!]
  """ISO 639-2 subtitle languages of the library file, embedded and sidecar (108 REQ-1); null while the file has never been read."""
  fileSubtitleLanguages: [String!]
}

extend type Episode {
  """ISO 639-2 audio languages of the library file (108 REQ-1); null while the file has never been read."""
  fileAudioLanguages: [String!]
  """ISO 639-2 subtitle languages of the library file, embedded and sidecar (108 REQ-1); null while the file has never been read."""
  fileSubtitleLanguages: [String!]
}

input LibraryProbeTarget {
  movieId: Int
  episodeId: Int
}

type LibraryProbeDetails {
  """Absolute container path of the library file to read."""
  filePath: String!
}

type Query {
  """Service-only (worker). Exactly one of movieId/episodeId is set."""
  libraryProbeDetails(target: LibraryProbeTarget!): LibraryProbeDetails!
}

type Mutation {
  """Service-only (worker). Safe to receive more than once; false when filePath is no longer the title's file and the report was discarded (108 REQ-5)."""
  libraryProbeCompleted(
    target: LibraryProbeTarget!
    """The path that was read, as libraryProbeDetails returned it."""
    filePath: String!
    """ISO 639-2 codes of the audio tracks, und and untagged left out."""
    audioLanguagesIso3: [String!]!
    """ISO 639-2 codes of the embedded subtitle tracks (108 REQ-1)."""
    embeddedSubtitleLanguagesIso3: [String!]!
    """Language tags of the sidecars, as written in their names; api resolves them."""
    sidecarLanguageTags: [String!]!
  ): Boolean!
}
```

`fileAudioLanguages`/`fileSubtitleLanguages` are `null` for "never read" and `[]` for "read, nothing found";
`web` hides the boxes for the first and shows `—` for the second (REQ-6). There is no failure
mutation: a failed read changes nothing (NFR-3), so the worker only logs it.

Queue: `library-probe` / `library-probe`, payload `{ movieId?: number; episodeId?: number }` with
exactly one set, concurrency 1, declared in `services/api/src/queue/types.ts` and copied by hand
into `services/worker/src/queue/types.ts`. `api` produces it with a job id per title
(`library-probe-movie-<id>` / `library-probe-episode-<id>`) so a second request while one is queued
is a no-op (REQ-3), and `attempts: 1`.

| Condition | HTTP / GraphQL error | Message the user sees |
| :-- | :-- | :-- |
| `libraryProbeDetails` for a target with neither or both ids | `BadRequestException` `error.libraryProbe.invalid_target` | not user-facing (worker logs and abandons) |
| `libraryProbeDetails` for a title that no longer exists, or has no file it can locate (REQ-2) | `NotFoundException` `error.libraryProbe.not_found` | not user-facing (worker logs and abandons, reports nothing) |
| `libraryProbeDetails` for a title the media server holds while the media server is unreachable | `ServiceUnavailableException` `error.libraryProbe.media_server_unavailable` | not user-facing (worker logs and abandons) |
| Either service-only operation with a user token | the existing service-guard key | the existing message |
| `libraryProbeCompleted` for a target that no longer exists | none: resolves `false` | — |

`web` reads two new nullable fields per type. They are prefixed `file` because `Movie.audioLanguages`/`subtitleLanguages` already exist (`039`: the caller's per-title preferred languages, `[Language!]!`) and mean something else; `Show` is not extended. `web` handles no new error. The worker abandons silently on every
`libraryProbeDetails` error above.

## Data Model Changes

| Model | Change | Nullable / default | Backfill needed? |
| :-- | :-- | :-- | :-- |
| `Movie` | add `fileAudioLanguages Json?`, `fileSubtitleLanguages Json?` (arrays of ISO 639-2 codes), `tracksReadAt DateTime?` | null = never read | No: REQ-3.4's one-time pass fills them asynchronously, the UI hides the boxes meanwhile |
| `Episode` | the same three columns | null = never read | No: same |

No other table. Reads in flight are not tracked (NFR-4).

## Acceptance Criteria

- [ ] **AC-1**: A film delivered with English audio and English and Spanish embedded subtitles shows,
      under its poster, an audio box with `ENG` and a subtitle box with `ENG` `SPA`.
- [ ] **AC-2**: A film the media server (Jellyfin) already held when it was added, never delivered by
      Perceptor (`filePath` null), shows both boxes within a minute of being added, filled from its
      file.
- [ ] **AC-3**: The same as AC-2 with Plex as the media server.
- [ ] **AC-4**: A `<base>.es.srt` sidecar beside a film's file that has no embedded Spanish: after a
      Refresh, the subtitle box shows `SPA` once. A `<base>.es.forced.srt` alone adds nothing.
- [ ] **AC-5**: After a `107` search embeds Spanish into a film, the subtitle box shows `SPA` without
      a Refresh (reload of the page only).
- [ ] **AC-6**: A series' season accordion shows, per episode, a column with the audio line, the
      subtitle line and the "Buscar subtítulos" button; the button no longer appears anywhere else in
      the row and still follows `106`'s visibility.
- [ ] **AC-7 (failure)**: With the media server set to none, a film with no `filePath` shows neither
      box and no error anywhere; `api` and `worker` logs show no read attempted for it.
- [ ] **AC-8 (failure)**: A film whose library file is made unreadable (`chmod 000`) and then
      Refreshed keeps the boxes it showed before; the `worker` log names the title and the path; no
      error reaches the UI.
- [ ] **AC-9 (failure)**: Refresh on a film whose file was deleted outside Perceptor demotes it to
      `MISSING` (`069`) and its boxes disappear.
- [ ] **AC-10**: On the first boot after the migration, every film and episode with a file gets its
      boxes without anyone pressing anything; `api` answers `/` normally while the reads drain, and
      an encode started meanwhile is not slowed by them beyond a shared disk (it never waits in the
      read queue).
- [ ] **AC-11**: The library folder's listing (names, sizes, mtimes) is identical before and after a
      read.
- [ ] **AC-12**: A file with an audio track tagged `und` and one tagged `fra` shows `FRE` only.
- [ ] **AC-13**: `bin/npm api run test` and `bin/npm worker run test` pass, including NFR-5's cases.

## Amendments

- **0.1.1 (2026-10-27, at planning).** The two GraphQL fields and columns are named
  `fileAudioLanguages`/`fileSubtitleLanguages`, not `audioLanguages`/`subtitleLanguages`: those names
  are already `Movie`'s per-title language preferences (`039`). No change of intent.

## Out of Scope

- **Codecs, channels, bitrate, resolution, HDR.** Only languages. The boxes answer "what language
  can I watch and read this in", not a media report; MediaInfo already does the rest.
- **Distinguishing a sidecar chip from an embedded one.** Shown the same (decided 2026-10-27): the
  media server presents both the same way.
- **Per-language track details** (count of tracks, SDH, commentary, a track's title). One chip per
  language.
- **A season or series summary.** Lists are per episode; no union is shown on the series header.
- **Clickable chips or filtering the library by language.** Informational only.
- **Recovering an interrupted read** (NFR-4) or **a scheduled re-read.** The triggers in REQ-3 cover
  every way the file changes through Perceptor; a file changed outside it is re-read on Refresh.
- **Replacing `107`'s probe with this one.** `107` needs the hash and size for a search and runs only
  for a search; this one runs for every file and keeps audio. They share the pure units, not the job.
