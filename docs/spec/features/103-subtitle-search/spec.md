---
title: Subtitle Search
spec_version: 0.5.0
author: Juan "Dientuki" Farias
created_at: 2026-10-24
last_updated: 2026-10-26
status: Approved
services: [api, worker, web]
---

# SPEC: Subtitle Search (`spec.md`)

## Context & Goal

A user asks for subtitle languages per title (`039-per-title-language-split`) and in general
(`021-user-preferences`), but those lists only filter what the source already carries. When the
release has no track in a language the user wants, nothing in the library ever fills the gap.
Example: a user wants English and Spanish subtitles for a film, the release only carried English,
so the library file ends with English only.

`101-jellyfin-subtitle-embed` gave an administrator a way to fill the gap by hand. They search in
Jellyfin's OpenSubtitles plugin, Jellyfin saves a sidecar `.srt`, they check its timing in the player,
and they press "Incrustar en archivo". This spec automates that path end to end, for owners who opt
in.

1. A file is delivered to the library and Jellyfin has indexed it.
2. `api` works out which wanted subtitle languages the file lacks.
3. For each one, `api` searches through Jellyfin's remote subtitle search (the same plugin, its
   credentials stay in Jellyfin) and fetches the best candidate's content into the downloads root.
4. The `worker` validates the candidate's timing with `ffsubsync`, against a text subtitle track of
   the file when there is one and against its audio otherwise.
5. Every accepted candidate is embedded by triggering `101`'s embed, not a second implementation of
   it.

Jellyfin is used to search and to fetch, never as a place to store the candidate. A candidate fetched
into the downloads root that fails validation is deleted there, so nothing a rejected candidate leaves
behind ever reaches the library folder (Article XII).

The feature is controlled by one per-user preference on `/preferences`, available only while the
configured media server is Jellyfin. There is no per-title control (amendment 0.5.0: a per-title
checkbox, default off, left a user with the preference on and no search for a title they never
ticked).

Pipeline stages touched:

- **Notify media server:** the Jellyfin client gains remote subtitle search and fetch
  (`services/api/src/clients/media-server/jellyfin.ts`). A finished delivery now also starts a
  subtitle search (after `ProcessJobsService`'s `notifyCreated`).
- **Transcode** (`worker`): a new `subtitle-sync` job runs `ffsubsync`. It is not part of the encode.
- **Browse library:** the language form, `/preferences`, and the title's audio/subtitle panel showing
  the last search's outcome.

No title `status` ever changes because of a search.

## Requirements

### Functional Requirements

- [ ] **REQ-1 (Availability)**: The feature is available only while the installation's
      `media_server_client` setting is `jellyfin`. `api` exposes this to every user as
      `MediaCapabilities.subtitleSearchAvailable`. It carries only that boolean, never the server
      type, host or key. While it is false:
      - `web` shows the `/preferences` checkbox disabled, with a hint that it requires Jellyfin;
      - no search ever starts.

      Stored flags are kept as they are, and take effect again if Jellyfin is configured again.
- [ ] **REQ-2 (User preference)**: Each user has a `subtitleSearch` preference (default off),
      editable on `/preferences` in the download-languages tab under the subtitle language picker,
      saved by that page's existing Save button.
- [ ] **REQ-3 (No per-title flag)**: *(amended 0.5.0; originally a per-title flag)* There is no
      per-title `subtitleSearch` flag, field, mutation or checkbox. An owner is opted in exactly when
      REQ-1 holds and that owner's `User.subtitleSearch` preference (REQ-2) is on. The preference
      cannot be overridden for a single title. Turning the preference off makes the owner not opted in
      for every title until it is turned on again.
- [ ] **REQ-4 (Trigger)**: A search starts for a film or an episode when a file is delivered to it:
      `encodeCompleted` for its job, with or without compression, after the media-server
      notification. It starts only when REQ-1 holds and at least one owner of the title (the
      series, for an episode) is opted in (REQ-3). The owners are read from the database at that moment, so a preference changed before the encode ends is honoured. A season pack starts one search per
      delivered episode. There is no other trigger (see Out of Scope).
- [ ] **REQ-5 (Wanted languages)**: The wanted languages are the union, over the opted-in
      owners (REQ-3), of each owner's effective subtitle languages: the per-title subtitle list (`039`) when
      it is non-empty, otherwise that owner's `subtitleLanguages` preference (`021`). Languages are
      compared by ISO 639-2 code. A regional variant (`es-419`, `es-ES`) is searched and matched as
      its base language (`spa`).
- [ ] **REQ-6 (Waiting for Jellyfin)**: The search needs the Jellyfin item that holds the delivered
      file: found through `findByTmdbId` (`034`), matched by season and episode number for an
      episode, and whose path is the delivered file's host path (`MediaRootsService`, Article V).
      Until Jellyfin reports that item, `api` re-checks at increasing intervals, for up to two hours
      in total. After that, the search ends as `FAILED` with `error.subtitleSearch.item_not_found`.
- [ ] **REQ-7 (Missing languages)**: A wanted language is missing when the Jellyfin item has no
      subtitle stream in it that is not forced, counting embedded tracks of any codec and external
      sidecars alike. A language that is not missing is recorded as `ALREADY_PRESENT` and not
      searched. When no language is missing, the search completes without any external call
      beyond the item lookup.
- [ ] **REQ-8 (Candidates)**: For each missing language, `api` calls Jellyfin's remote subtitle
      search for the item in that language and keeps only candidates that are:
      - in SRT format;
      - not forced;
      - not marked machine-translated or AI-translated.

      The rest are ranked:
      1. a hash match first (in practice this never happens, since Jellyfin hashes the transcoded
         file);
      2. then by how closely the candidate's release name matches the delivered source's release
         name (the release `046` writes as `PERCEPTOR_SOURCE`, known to `api` even when compression
         is off);
      3. then candidates not marked hearing-impaired before those that are;
      4. then by download count.

      At most 3 candidates per language are tried, in rank order. The first one accepted ends that
      language. When none is accepted, or there are no candidates, the language is recorded as
      `NOT_FOUND` or `REJECTED`.
- [ ] **REQ-9 (Fetch into the downloads root)**: A candidate's content is fetched through Jellyfin
      (the plugin's own download, which counts against the plugin account's quota) and written by
      `api` to a staging file under the downloads root, never under the destinations root. Jellyfin
      is never asked to save a subtitle beside the media. The staging file is deleted when its
      candidate is rejected and when the embed that read it finishes, either way.
- [ ] **REQ-10 (Timing validation)**: Each fetched candidate is validated by the worker with
      `ffsubsync`, against a reference taken from the library file:
      - its first text subtitle track that is not forced, when it has one;
      - otherwise its default audio track (its first audio track when none is default).

      The worker reports the offset found, the framerate ratio, which reference was used, the
      alignment score, the library file's duration as `ffprobe` reads it, and the start of its last
      chapter when it has chapters. A candidate is
      accepted only when all of these hold, checked in this order:
      - the framerate ratio is 1: its distance from 1 is under 0.0005. `ffsubsync` picks the ratio
        from a discrete set, and its nearest neighbour is 24/23.976 ≈ 1.001 (a subtitle timed for
        24 fps on a 23.976 fps file), which drifts about 7 s over two hours and must be rejected.
        A tolerance of 0.001 let it through by rounding;
      - the absolute offset is at most 600 000 ms, `101`'s REQ-4 bound;
      - **the candidate covers the film**: the end time of its last cue, shifted by the offset
        found, is more than a share of a reference point:
        - when the file has at least 2 chapters and its last chapter starts after 80 % of the
          duration, the reference is that chapter's start (on a disc-sourced file the last chapter
          is the end credits) and the share is 85 %;
        - otherwise the reference is the file's duration and the share is 60 %.

        It is a floor only: cues inside the credits, past the reference, are never a reason to
        reject. A candidate at or below the share is rejected with
        `error.subtitleSearch.incomplete`. This is what stops a subtitle uploaded
        in two parts ("2CD"): Jellyfin's plugin fetches only the first file, which syncs cleanly
        and scores close to a complete subtitle, so neither the framerate, the offset nor the score
        catch it. `api` reads the last cue from the staged file it wrote (REQ-9);
      - the score meets the acceptance threshold for the reference used.

      The thresholds (one for a subtitle reference, one for an audio reference) are
      **provisional**, the same standing as `094`'s probe threshold. They are measured during
      implementation on at least one known-good and one known-bad pair per reference, and recorded
      with those measurements in `docs/spec/history.md`'s entry for this spec. Each is a single
      constant in `api`, which applies the rule, so re-measuring later changes one value and no
      contract. The coverage shares (85 % of the last chapter, 60 % of the duration) and the 80 %
      chapter gate are constants beside them, with the same standing.
- [ ] **REQ-11 (Embed through `101`)**: Once every missing language of a search is resolved, the
      accepted candidates (if any) are embedded by one `101` embed of that film or episode, in one
      remux. Each track carries:
      - its language and `101`'s REQ-5 track title;
      - the offset REQ-10 found;
      - default off and forced off.

      Everything else is `101`'s behaviour unchanged: verification, atomic rename, failure leaving
      the library as it was, and the Jellyfin refresh. The difference is that the tracks are staged
      files (REQ-9), not sidecars: the worker must not delete them (`101`'s sidecar deletion does not
      apply), and `api` deletes them from the downloads root once the embed is terminal. The embed
      runs even though no administrator asked for it, which needs NFR-1.
- [ ] **REQ-12 (Busy)**: If the `101` embed is refused because the title has work in flight or
      another embed (`101` REQ-16, `error.subtitleEmbed.busy`), the search ends `FAILED` with that
      key and its staged files are deleted. Nothing is retried. `101`'s guard is already
      per-episode for a season pack: once the pack is scanned, it only counts the episode's own
      jobs and sources, and an episode is only delivered after its pack is scanned. Each episode of
      a pack therefore embeds as soon as its own job finishes, without waiting for the rest. In
      practice `busy` means a replacement of the same title is in flight, and that replacement's
      delivery starts its own search.

      A new search of the same film or episode, started by a later delivery (REQ-4), supersedes any
      earlier one that is not terminal. The earlier one ends `FAILED` with
      `error.subtitleSearch.superseded` and its staged files are deleted.
- [ ] **REQ-13 (Outcome readable on the title)**: The latest search of a film or episode must be
      readable on it by any owner, with:
      - its status (`WAITING`, `SEARCHING`, `VALIDATING`, `EMBEDDING`, `COMPLETED`, `FAILED`);
      - its failure key;
      - one outcome per wanted language (`ALREADY_PRESENT`, `EMBEDDED`, `NOT_FOUND`, `REJECTED`,
        `FAILED`).

      `web` shows it in the title's audio/subtitle panel. A search never appears in `/downloads` or
      `activeDownloadCount`, and never writes a title status.
- [ ] **REQ-14 (Failures are outcomes)**: Jellyfin unreachable or rejecting a call, a fetch that
      fails, and `ffsubsync` crashing on one candidate all mark that candidate or language as
      failed and move on to the next, never an unhandled error. The keys are the outcome keys listed
      under the GraphQL Contract Delta. A search
      never blocks or fails the delivery that triggered it.

### Non-Functional & Operational Requirements

- [x] **NFR-1 (Constitution amendment)**: Article XII's first `101` exception (replacing a library
      `.mkv` with its verified remux) only applied at an administrator's explicit request. It is
      widened to also cover an embed started by this spec for a title with an opted-in owner (REQ-3).
      The second exception, sidecar deletion, is not widened: this spec never deletes anything under
      the destinations root. *Ratified as constitution v1.6.0 on 2026-10-24.*
- [ ] **NFR-2 (External quota)**: Each candidate tried costs one download from the plugin's account,
      whose free tier has a small daily quota. Per search: at most one remote search call per missing
      language and at most 3 fetches per missing language (REQ-8). A language already present costs
      nothing. No search is ever repeated automatically for the same delivery.
- [ ] **NFR-3 (Worker image)**: `ffsubsync` must be present in the worker image for `linux/amd64`
      and `linux/arm64` (`083`). The image is Alpine (musl), so the plan must show that its native
      dependencies install on both. The size increase must be measured and recorded in the plan.
- [ ] **NFR-4 (No overlap with the encode)**: A `subtitle-sync` job runs on its own queue with
      concurrency 1. It never runs inside an encode job and never delays one beyond sharing the CPU.
- [ ] **NFR-5 (Crash recovery)**: A validation still running when the worker announces its boot
      (`054`'s `encodeWorkerStarted`) is marked failed with `error.subtitleSearch.interrupted`, its
      staged file is deleted, and the search continues with the next candidate. A search left
      non-terminal by an `api` restart or a lost queue entry resumes where its rows say it is: on
      boot, `api` schedules every non-terminal search again. No search ever stays non-terminal
      forever.
- [ ] **NFR-6 (Tests where failure is silent, Article IX)**: Covered by tests that fail when the rule
      is removed:
      - a language with only a forced track counts as missing;
      - machine-translated, AI-translated, forced and non-SRT candidates never reach validation;
      - a framerate ratio other than 1 is rejected, including 1.001;
      - a candidate whose last cue ends at or before 60 % of the file's duration is rejected;
      - with a qualifying last chapter, a candidate at or below 85 % of its start is rejected, and
        a file whose last chapter starts before 80 % of the duration falls back to the duration;
      - an offset over the bound is rejected;
      - a staged file is deleted on rejection and after a terminal embed;
      - a staged track is never deleted by the worker's sidecar rule;
      - no search starts when the media server is not Jellyfin, or when no owner is opted in;
      - the 3-candidate cap holds;
      - an item whose path is not the delivered file is not used.

## GraphQL Contract Delta

```graphql
extend type MediaCapabilities {
  """True while media_server_client is jellyfin (REQ-1). Never exposes the server type."""
  subtitleSearchAvailable: Boolean!
}

extend type UserPreferences {
  subtitleSearch: Boolean!
}

extend type Movie {
  """The film's most recent search, null if it never had one."""
  latestSubtitleSearch: SubtitleSearch
}

extend type Episode {
  latestSubtitleSearch: SubtitleSearch
}

enum SubtitleSearchStatus {
  WAITING
  SEARCHING
  VALIDATING
  EMBEDDING
  COMPLETED
  FAILED
}

enum SubtitleSearchLanguageOutcome {
  PENDING
  ALREADY_PRESENT
  EMBEDDED
  NOT_FOUND
  REJECTED
  FAILED
}

type SubtitleSearchLanguage {
  languageIso3: String!
  outcome: SubtitleSearchLanguageOutcome!
  """i18n key when outcome is FAILED or REJECTED, else null."""
  reasonKey: String
}

type SubtitleSearch {
  id: Int!
  status: SubtitleSearchStatus!
  """i18n key when status is FAILED, else null."""
  errorKey: String
  languages: [SubtitleSearchLanguage!]!
  createdAt: DateTime!
  finishedAt: DateTime
}

enum SubtitleSyncReference {
  SUBTITLE
  AUDIO
}

type Mutation {
  setSubtitleSearch(enabled: Boolean!): UserPreferences!

  """Service-only (worker). Moves a queued validation to running; false if it is no longer queued."""
  subtitleSyncStarted(id: Int!): Boolean!
  """Service-only (worker). Safe to receive more than once (038's posture). api applies REQ-10's acceptance rule."""
  subtitleSyncCompleted(
    id: Int!
    offsetMs: Int!
    framerateRatio: Float!
    reference: SubtitleSyncReference!
    score: Float!
    """Duration of the library file, in milliseconds, as ffprobe reads it. Feeds REQ-10's coverage check."""
    mediaDurationMs: Int!
    """Start of the library file's last chapter, in milliseconds; null when it has fewer than 2 chapters. api decides whether it qualifies (REQ-10)."""
    lastChapterStartMs: Int
  ): Boolean!
  """Service-only (worker). Safe to receive more than once."""
  subtitleSyncFailed(id: Int!, errorKey: String!): Boolean!
}

type Query {
  """Service-only (worker). Container paths, same standing as SubtitleEmbedDetails."""
  subtitleSyncDetails(id: Int!): SubtitleSyncDetails!
}

type SubtitleSyncDetails {
  id: Int!
  """Absolute container path of the library .mkv used as the reference."""
  filePath: String!
  """Absolute container path of the staged candidate, under the downloads root."""
  candidatePath: String!
}
```

**Change to `101`'s worker contract**: `SubtitleEmbedTrack` gains `isSidecar: Boolean!`. It is
`true` for every track a `101` request names, and the worker deletes it after the rename exactly as
today. It is `false` for a REQ-9 staged track, which the worker never deletes (`api` cleans up the
downloads root, REQ-11). `101` is approved and being implemented, so this spec lands after it and
this field is the only edit to its contract.

The queue payload gains one queue and one job: `subtitle-sync` / `subtitle-sync`, payload
`{ subtitleSyncId: number }`. The worker reads everything else through `subtitleSyncDetails`.

`Episode.latestSubtitleSearch` resolves for any owner of the series, like the episode itself.

| Condition | HTTP / GraphQL error | Message the user sees |
| :-- | :-- | :-- |
| `setSubtitleSearch` while `subtitleSearchAvailable` is false | `BadRequestException` `error.subtitleSearch.unsupported_media_server` | `La búsqueda de subtítulos requiere Jellyfin como servidor de medios.` |
| Service-only mutation/query called with a user token | the existing service-guard key | the existing message |
| `subtitleSyncDetails` for an unknown id | `NotFoundException` `error.subtitleSearch.sync_not_found` | not user-facing (worker logs and abandons) |

Outcome keys, shown in the panel and never thrown (REQ-13/REQ-14):

| Key | Message the user sees |
| :-- | :-- |
| `error.subtitleSearch.item_not_found` | `Jellyfin no indexó el archivo a tiempo; no se buscaron subtítulos.` |
| `error.subtitleSearch.media_server_unavailable` | `No se pudo contactar a Jellyfin para buscar subtítulos.` |
| `error.subtitleSearch.fetch_failed` | `No se pudo descargar el subtítulo.` |
| `error.subtitleSearch.sync_failed` | `No se pudo validar la sincronización del subtítulo.` |
| `error.subtitleSearch.framerate_mismatch` | `El subtítulo es de una versión con otro framerate.` |
| `error.subtitleSearch.offset_too_large` | `El subtítulo está demasiado desfasado.` |
| `error.subtitleSearch.incomplete` | `El subtítulo está incompleto (solo cubre parte de la película).` |
| `error.subtitleSearch.low_score` | `El subtítulo no coincide con este archivo.` |
| `error.subtitleSearch.interrupted` | `La búsqueda se interrumpió.` |
| `error.subtitleSearch.superseded` | `Una entrega más nueva reemplazó esta búsqueda.` |
| `error.subtitleEmbed.busy` (reused from `101`) | `101`'s existing message |

`web` must handle `unsupported_media_server` on save: show it in the `/preferences` form's existing error list
and revert the checkbox.

## Data Model Changes

| Model | Change | Nullable / default | Backfill needed? |
| :-- | :-- | :-- | :-- |
| `User` | `subtitleSearch Boolean` | `false` | No |
| `UserMovie`, `UserShow` | drop `subtitleSearch` (0.5.0) | — | No |
| `SubtitleSearch` (new) | `movieId?`/`episodeId?` (exactly one, cascade), `status`, `errorKey?`, `subtitleEmbedId?` (the `101` embed it triggered), `checkCount` (REQ-6's bounded wait), `createdAt`, `finishedAt?` | — | No |
| `SubtitleSearchAttempt` (new) | `searchId` (cascade), `languageIso3`, `providerSubtitleId`, `releaseName`, `rank`, `stagedPath?`, `status` (`QUEUED`/`RUNNING`/`ACCEPTED`/`REJECTED`/`FAILED`), `offsetMs?`, `framerateRatio?`, `reference?`, `score?`, `reasonKey?` | — | No |
| `SubtitleEmbed.tracks` (JSON, `101`) | each track gains `isSidecar` | absent reads as `true` | No (absent = `101`'s behaviour) |

The per-language outcomes of REQ-13 are derived from a search's attempts and its item lookup, not
stored twice.

## Acceptance Criteria

- [ ] **AC-1**: With the media server set to Plex or none, `/preferences` shows the "search subtitles
      online" checkbox disabled with its hint, and a title's language form shows no subtitle-search
      checkbox. With Jellyfin configured the language forms still show none: the preference is the
      only control.
- [ ] **AC-1b**: With the owner's preference off, delivering a title creates no `subtitle_searches`
      row. With it on, delivering a title creates one with no per-title action taken.
- [ ] **AC-2**: With Jellyfin configured, `setSubtitleSearch(true)` succeeds; after switching the media
      server to none it returns `La búsqueda de subtítulos requiere Jellyfin como servidor de medios.`
      and the stored preference is unchanged. `schema.gql` has no `setMovieSubtitleSearch`,
      `setShowSubtitleSearch`, `Movie.subtitleSearch` or `Show.subtitleSearch`.
- [ ] **AC-3**: A film whose owner wants `eng` and `spa` subtitles and has the preference on is delivered from a
      release carrying only English. Within the REQ-6 window, `subtitle_search_attempts` holds `spa`
      rows only, and the film's panel shows English `ALREADY_PRESENT` and Spanish `EMBEDDED`.
      `mkvmerge -J` on the library file lists a new `spa` subtitle track titled `Español` after the
      original tracks, and Jellyfin shows no external `.srt` for it.
- [ ] **AC-4**: For AC-3's film, the embedded Spanish track plays in sync in Jellyfin. The attempt
      row records the reference used (`SUBTITLE`, since the file carried English text) and the
      offset applied.
- [ ] **AC-5**: A film whose release carries no text subtitles is delivered with a missing language.
      The accepted attempt records `reference = AUDIO`.
- [ ] **AC-6 (failure)**: A candidate is forced to fail validation, for example by staging an `.srt`
      from a different cut of the film. The attempt is `REJECTED` with a reason key, its staging file
      no longer exists under the downloads root, and nothing was written under the destinations root
      (the library folder's listing is identical before and after).
- [ ] **AC-7 (failure)**: With Jellyfin stopped when the delivery completes, the search stays
      `WAITING` and then ends `FAILED` with `error.subtitleSearch.item_not_found` no later than two
      hours after the delivery. The title's status reads `COMPLETED` throughout.
- [ ] **AC-8**: A delivery for a title where no owner is opted in creates no `subtitle_searches` row and
      makes no Jellyfin remote search call (Jellyfin's log shows none).
- [ ] **AC-9**: A delivered episode of a series with an opted-in owner gets its own search. Delivering a two-episode
      season pack creates two searches. The first episode's search reaches `COMPLETED`, with its
      language `EMBEDDED`, while the second episode is still encoding, and the second follows when
      its own job finishes.
- [ ] **AC-9b**: Delivering a film again (a replacement) while its previous search is still `WAITING`
      leaves the earlier search `FAILED` with `error.subtitleSearch.superseded` and its staged
      directory gone.
- [ ] **AC-10**: A language with no candidates in Jellyfin's search ends `NOT_FOUND` with zero fetches.
      A language with five candidates that are all rejected shows exactly three attempts.
- [ ] **AC-11 (failure)**: The worker container is killed during a validation. After it restarts, that
      attempt reads `FAILED` with `error.subtitleSearch.interrupted`, its staged file is gone, and the
      search proceeds to the next candidate or finishes.
- [ ] **AC-12**: `bin/npm api run test` and `bin/npm worker run test` pass, including NFR-6's cases.
- [ ] **AC-13 (failure)**: A candidate covering half the film (the first file of a "2CD" upload, or
      an `.srt` cut at the midpoint) is staged as the only candidate. Its attempt reads `REJECTED`
      with `error.subtitleSearch.incomplete`, and its staged file is gone.

## Out of Scope

- **Searching on demand, or for titles already in the library.** The only trigger is a delivery
  (REQ-4). Turning the preference on for a film already delivered does nothing until its next delivery.
  Turning it on for a whole series would mean one search per episode at once, which a free
  OpenSubtitles quota cannot absorb. A manual "search now" button is a later feature.
- **Re-searching later.** A language `NOT_FOUND` today may have a subtitle next week. There is no
  periodic re-search. That would be a scheduler task, like `refresh_movies`.
- **Plex, or no media server.** Plex's subtitle search stores results in its own data folder (see
  `101`'s Out of Scope). Searching providers directly (OpenSubtitles API, Subdl, Subdivx) without
  Jellyfin is a separate, larger feature.
- **Framerate correction.** `ffsubsync` can rescale a subtitle made for another framerate, but
  `101`'s embed applies only a constant offset. A candidate that needs rescaling is rejected (REQ-10),
  and the next one is tried.
- **Split corrections (`alass`).** Different offsets per section do not fit `101`'s single offset.
- **Searching before the encode**, by the source release's hash. It would give exact matches, but it
  needs a provider client that does not go through Jellyfin, which only hashes the library file.
- **Forced or hearing-impaired subtitles as a goal.** Forced candidates are excluded, and
  hearing-impaired ones are only ranked lower.
- **Regional variants.** A `spa` track of any variant satisfies `es-419` and `es-ES` alike. Jellyfin's
  search takes only a three-letter language.
- **Changing the default subtitle track.** Embedded tracks are never default. Picking a default stays
  `101`'s manual action.
- **Image subtitles (PGS/VobSub) as a reference.** `ffsubsync`'s `--pgs-ref-stream` exists, but v1
  references a text track or the audio only.

## Amendments (2026-10-25, `spec_version` 0.4.0)

Measured during implementation, before T024 set any threshold, on six films of the maintainer's
library with real OpenSubtitles candidates fetched through Jellyfin and run through the worker's
`ffsubsync` exactly as the `subtitle-sync` job runs it. The video files were never written.

**What changed and why:**

1. **REQ-10 coverage check (new rejection, `error.subtitleSearch.incomplete`).** Two of the three
   Spanish candidates for *The Lost World: Jurassic Park* (1997) were the first half of a "2CD"
   upload (confirmed on opensubtitles.org's CD column). They ended at 1:01:59 and 1:04:36 of a
   2:08:39 film, synced cleanly (offsets -0.08 s and -3.38 s, ratio 1.000), and scored 307 289 and
   320 324, close to the complete candidates of *Up in the Air* (364 547–382 513). No score
   threshold separates them. Coverage does: 48 % and 50 % against 89–100 % for every complete
   candidate measured. Jellyfin's plugin does not expose the number of files per upload, so this
   cannot be filtered before the fetch.
2. **REQ-10 framerate tolerance tightened from 0.001 to 0.0005.** The third Spanish candidate for
   *Shutter Island* reported a ratio of 1.001 and is the upload OpenSubtitles tags as 24 fps; the
   old bound accepted it by rounding.
3. **Coverage against the last chapter when there is one.** All five library files measured carry
   chapters, and the last one starts at 94–96 % of the file, at the end credits. Measured against
   that start, every good candidate covers 99 % or more and the "2CD" halves 51–53 %, so the share
   can rise to 85 % and also catch a subtitle missing its last quarter, which 60 % of the duration
   lets through. A file with no chapters, or with automatic ones whose last start is not near the
   end, falls back to the duration and 60 %.
4. **Contract**: `subtitleSyncCompleted` gains `mediaDurationMs: Int!` and `lastChapterStartMs: Int`,
   read by the worker from the `ffprobe` it already runs on the library file to pick the reference
   (with chapters requested).

**Measurements** (`score`, `offset`, `framerate`, coverage). Subtitle reference = the file's English
text track; audio reference = its default audio track with `--vad webrtc`.

Coverage below is against the duration. Last chapter start: Shutter Island 2:10:31 (95 %),
Resident Evil 1:34:08 (94 %), Up in the Air 1:44:07 (95 %), Split 1:52:27 (96 %), The Lost World
2:01:56 (95 %).

| Film | Reference | Candidate | Score | Offset | Ratio | Coverage | Verdict |
| :-- | :-- | :-- | --: | --: | --: | --: | :-- |
| The Guyver (1991) | subtitle | matching sidecar | 438 001 | -17.99 s | 1.000 | — | good |
| The Guyver (1991) | subtitle | another film's `.srt` | 28 446 | +9.87 s | 1.001 | — | bad |
| The Guyver (1991) | audio | matching sidecar | 211 884 | -18.05 s | 1.000 | — | good |
| The Guyver (1991) | audio | another film's `.srt` | -1 051 | +558.8 s | 1.042 | — | bad |
| Split (2016) | subtitle | spa #1 / #2 / #3 | 630 129 / 633 427 / 629 973 | 0 / -1.0 / 0 s | 1.000 | 100 % | good |
| Up in the Air (2009) | subtitle | spa #1 / #2 / #3 | 373 920 / 364 547 / 382 513 | -6.3 / -1.2 / -7.2 s | 1.000 | 95–100 % | good |
| The Lost World (1997) | subtitle | spa #1 | 604 068 | -4.16 s | 1.000 | 94 % | good (maintainer checked) |
| The Lost World (1997) | subtitle | spa #2, #3 (2CD, first file) | 307 289 / 320 324 | -0.08 / -3.38 s | 1.000 | 48 % / 50 % | bad: incomplete |
| Resident Evil (2002) | audio | spa #1, #2 (PAL) | -274 713 / -249 509 | +586.9 / -558.2 s | 1.043 / 1.042 | — | bad: framerate |
| Resident Evil (2002) | audio | spa #3 | 247 976 | -0.13 s | 1.000 | 93 % | good (maintainer checked) |
| Shutter Island (2010) | audio | spa #1 (PAL) | 191 485 | +55.5 s | 1.043 | 89 % | bad: framerate |
| Shutter Island (2010) | audio | spa #2 | 217 484 | +1.03 s | 1.000 | 94 % | good (maintainer checked) |
| Shutter Island (2010) | audio | spa #3 (24 fps) | 197 537 | +0.58 s | 1.001 | 94 % | bad: framerate (this amendment) |
| Shutter Island (2010) | audio | eng #1 (PAL) | 179 955 | +1.91 s | 1.043 | 90 % | bad: framerate |
| Shutter Island (2010) | audio | eng #2 | 202 612 | +0.82 s | 1.000 | 94 % | good (maintainer checked) |

Once the framerate and coverage checks run first, the score threshold only has to reject a subtitle
of another film: the lowest good score is 364 547 (subtitle) and 202 612 (audio); the bad ones are
28 446 and -1 051. The scores grow with the number of cues, so a short film will score lower than
any of these; a threshold that rejects one only means no subtitle is embedded, never a wrong one.

**Observed, not acted on here** (candidates for a later amendment):

- REQ-8's Jaccard similarity favours a candidate named with the bare title over one naming the same
  release markers (`2160p`, `remux`, `hevc`), since every unshared token counts against it.
- Jellyfin exposes each candidate's `FrameRate` (`0` when unknown). Filtering a known mismatch before
  the fetch would have saved two of the downloads above.
- When the OpenSubtitles daily download quota is exhausted, Jellyfin answers a fetch with a bare
  `500 Error processing request.` (its log says `RateLimitExceededException`), so `api` cannot tell
  it apart from any other failure: every remaining candidate of the search is spent as
  `fetch_failed`.

## Amendments (2026-10-26, `spec_version` 0.5.0)

Found while testing the published `:latest` images: *Stand by Me* was delivered with the owner's
preference on and no search was created, because the per-title flag (REQ-3, default off, never
inherited) was never ticked. Nothing failed, so nothing was logged.

**What changed:**

1. **REQ-3 replaced.** The per-title flag, its checkbox, `Movie.subtitleSearch`, `Show.subtitleSearch`,
   `setMovieSubtitleSearch`, `setShowSubtitleSearch` and the `UserMovie`/`UserShow.subtitleSearch`
   columns are removed. The user preference is the only switch and cannot be overridden per title.
2. **REQ-4** reads the opted-in owners from `User.subtitleSearch` at the end of the encode.
3. **Behaviour change, intended:** a user with the preference on now gets a search on every
   subsequent delivery. `/preferences` help text says so.
4. **Migration:** drop the two columns. No backfill; the stored values are discarded.
5. **Contract:** the four removed members above; no new error keys.
6. **Unchanged:** the wanted languages (REQ-5), ranking, acceptance, embedding, and the absence of a
   retroactive or on-demand search (Out of Scope).
