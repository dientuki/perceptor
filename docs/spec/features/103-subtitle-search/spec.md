---
title: Subtitle Search
spec_version: 0.3.0
author: Juan "Dientuki" Farias
created_at: 2026-10-24
last_updated: 2026-10-24
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

The feature is gated twice. A per-user preference on `/preferences` and a per-title checkbox on the
title's language form ("¿Buscar subtítulos en internet?", under the subtitle picker,
`services/web/src/components/media/TitleLanguagesForm.tsx`). Both are only available while the
configured media server is Jellyfin.

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
      - `web` hides the per-title checkbox;
      - no search ever starts.

      Stored flags are kept as they are, and take effect again if Jellyfin is configured again.
- [ ] **REQ-2 (User preference)**: Each user has a `subtitleSearch` preference (default off),
      editable on `/preferences` in the download-languages tab under the subtitle language picker,
      saved by that page's existing Save button.
- [ ] **REQ-3 (Per-title flag)**: Each owner of a film or series has their own `subtitleSearch`
      flag on that title (default off). It is edited by a checkbox labelled
      "¿Buscar subtítulos en internet?" under the subtitle picker of the title's language form,
      saved by that form's existing Save button. An episode reads its series' owners' flags; there
      is no per-episode flag.

      The user preference (REQ-2) is a gate, not a default. The per-title checkbox is shown only
      while both REQ-1 and the owner's preference are on. Every title starts off, and nothing
      copies or falls back to the preference. An owner's **effective** flag is on only when REQ-1
      holds, their preference is on and their per-title flag is on. Turning the preference off
      keeps every per-title flag as stored but makes them all ineffective until it is turned on
      again.
- [ ] **REQ-4 (Trigger)**: A search starts for a film or an episode when a file is delivered to it:
      `encodeCompleted` for its job, with or without compression, after the media-server
      notification. It starts only when REQ-1 holds and at least one owner of the title (the
      series, for an episode) has an effective flag on (REQ-3). A season pack starts one search per
      delivered episode. There is no other trigger (see Out of Scope).
- [ ] **REQ-5 (Wanted languages)**: The wanted languages are the union, over the owners whose flag
      is on, of each owner's effective subtitle languages: the per-title subtitle list (`039`) when
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

      The worker reports the offset found, the framerate ratio, which reference was used, and the
      alignment score. A candidate is accepted only when all of these hold:
      - the framerate ratio is 1, so a candidate needing a framerate correction is rejected;
      - the absolute offset is at most 600 000 ms, `101`'s REQ-4 bound;
      - the score meets the acceptance threshold for the reference used.

      The thresholds (one for a subtitle reference, one for an audio reference) are
      **provisional**, the same standing as `094`'s probe threshold. They are measured during
      implementation on at least one known-good and one known-bad pair per reference, and recorded
      with those measurements in `docs/spec/history.md`'s entry for this spec. Each is a single
      constant in `api`, which applies the rule, so re-measuring later changes one value and no
      contract.
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
      widened to also cover an embed started by this spec for a title an owner opted into (REQ-3).
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
      - a framerate ratio other than 1 is rejected;
      - an offset over the bound is rejected;
      - a staged file is deleted on rejection and after a terminal embed;
      - a staged track is never deleted by the worker's sidecar rule;
      - no search starts when the media server is not Jellyfin, or when no owner opted in;
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
  """The caller's own flag (REQ-3)."""
  subtitleSearch: Boolean!
  """The film's most recent search, null if it never had one."""
  latestSubtitleSearch: SubtitleSearch
}

extend type Show {
  subtitleSearch: Boolean!
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
  setMovieSubtitleSearch(movieId: Int!, enabled: Boolean!): Boolean!
  setShowSubtitleSearch(showId: Int!, enabled: Boolean!): Boolean!

  """Service-only (worker). Moves a queued validation to running; false if it is no longer queued."""
  subtitleSyncStarted(id: Int!): Boolean!
  """Service-only (worker). Safe to receive more than once (038's posture). api applies REQ-10's acceptance rule."""
  subtitleSyncCompleted(
    id: Int!
    offsetMs: Int!
    framerateRatio: Float!
    reference: SubtitleSyncReference!
    score: Float!
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
`Movie.subtitleSearch`/`Show.subtitleSearch` are the caller's own row, like `audioMandatory`.

| Condition | HTTP / GraphQL error | Message the user sees |
| :-- | :-- | :-- |
| `set*SubtitleSearch` while `subtitleSearchAvailable` is false | `BadRequestException` `error.subtitleSearch.unsupported_media_server` | `La búsqueda de subtítulos requiere Jellyfin como servidor de medios.` |
| Film/series missing or not owned by the caller | `NotFoundException`, the existing `movie`/`show` not-found keys | the existing messages |
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
| `error.subtitleSearch.low_score` | `El subtítulo no coincide con este archivo.` |
| `error.subtitleSearch.interrupted` | `La búsqueda se interrumpió.` |
| `error.subtitleSearch.superseded` | `Una entrega más nueva reemplazó esta búsqueda.` |
| `error.subtitleEmbed.busy` (reused from `101`) | `101`'s existing message |

`web` must handle `unsupported_media_server` on save: show it in the form's existing error list and
revert the checkbox, the same as the form's other errors. The `/preferences` form does the same.

## Data Model Changes

| Model | Change | Nullable / default | Backfill needed? |
| :-- | :-- | :-- | :-- |
| `User` | `subtitleSearch Boolean` | `false` | No |
| `UserMovie` | `subtitleSearch Boolean` | `false` | No |
| `UserShow` | `subtitleSearch Boolean` | `false` | No |
| `SubtitleSearch` (new) | `movieId?`/`episodeId?` (exactly one, cascade), `status`, `errorKey?`, `subtitleEmbedId?` (the `101` embed it triggered), `checkCount` (REQ-6's bounded wait), `createdAt`, `finishedAt?` | — | No |
| `SubtitleSearchAttempt` (new) | `searchId` (cascade), `languageIso3`, `providerSubtitleId`, `releaseName`, `rank`, `stagedPath?`, `status` (`QUEUED`/`RUNNING`/`ACCEPTED`/`REJECTED`/`FAILED`), `offsetMs?`, `framerateRatio?`, `reference?`, `score?`, `reasonKey?` | — | No |
| `SubtitleEmbed.tracks` (JSON, `101`) | each track gains `isSidecar` | absent reads as `true` | No (absent = `101`'s behaviour) |

The per-language outcomes of REQ-13 are derived from a search's attempts and its item lookup, not
stored twice.

## Acceptance Criteria

- [ ] **AC-1**: With the media server set to Plex or none, `/preferences` shows the "search subtitles
      online" checkbox disabled with its hint, and a title's language form shows no
      "¿Buscar subtítulos en internet?" checkbox. With Jellyfin configured and the user's preference
      off, the per-title checkbox is still hidden. Turning the preference on shows it, unchecked.
- [ ] **AC-1b**: With an opted-in title, turning the owner's preference off and delivering the title
      creates no `subtitle_searches` row. Turning the preference back on shows the title's checkbox
      still checked.
- [ ] **AC-2**: With Jellyfin configured, calling `setMovieSubtitleSearch` and then switching the media
      server to none and calling it again returns `La búsqueda de subtítulos requiere Jellyfin como
      servidor de medios.`, and the stored flag is unchanged.
- [ ] **AC-3**: A film whose owner wants `eng` and `spa` subtitles and opted in is delivered from a
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
- [ ] **AC-8**: A delivery for a title where no owner opted in creates no `subtitle_searches` row and
      makes no Jellyfin remote search call (Jellyfin's log shows none).
- [ ] **AC-9**: A delivered episode of an opted-in series gets its own search. Delivering a two-episode
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

## Out of Scope

- **Searching on demand, or for titles already in the library.** The only trigger is a delivery
  (REQ-4). Turning a flag on for a film already delivered does nothing until its next delivery.
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
