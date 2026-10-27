---
title: OpenSubtitles Direct
spec_version: 0.4.0
author: Juan "Dientuki" Farias
created_at: 2026-10-26
last_updated: 2026-10-27
status: Approved
services: [api, worker, web, infra]
---

# SPEC: OpenSubtitles Direct (`spec.md`)

## Context & Goal

`103-subtitle-search` finds candidates through Jellyfin: it asks Jellyfin which subtitle languages
the library file already carries, asks Jellyfin's OpenSubtitles plugin for candidates, and has the
plugin download them. That ties the whole feature to Jellyfin, and it has two concrete problems in
use:

- **Credentials live in Jellyfin's plugin**, not in Perceptor. The feature works only when the
  plugin is installed and logged in, and an installation on Plex, or with no media server, cannot
  use it at all.
- **Multi-CD uploads waste the quota.** OpenSubtitles still hosts many subtitles uploaded in two
  parts (one file per CD of an old DivX release). Jellyfin's plugin exposes them as one candidate and
  downloads only the first file. `103`'s coverage check (amendment 0.4.0, `incomplete`) rejects
  it, but only after it has spent one of the free account's ~20 daily downloads. A two-CD subtitle
  is also timed for a different cut of the film, so it is never usable.

This spec has `api` talk to the OpenSubtitles REST API directly. Perceptor ships its own
OpenSubtitles application key, as Jellyfin's plugin and Bazarr do, and an administrator only enters
the installation's OpenSubtitles.com account in Settings. The `worker` reads what the library file already carries. The feature then no
longer depends on any media server. OpenSubtitles returns the file list of every subtitle in its
search results, so a multi-part upload is dropped **before** any download is spent. Everything
after a candidate is staged is `103` unchanged: timing validation (REQ-10), embed through `101`
(REQ-11), busy handling (REQ-12), outcomes (REQ-13/14).

This spec builds on `106-manual-subtitle-search` (Implemented) and amends three of
its requirements: REQ-3.1's refusal no longer mentions Jellyfin, REQ-5's two-hour bound on waiting
for the Jellyfin item disappears with the wait itself, and REQ-7 resolves a title with no `filePath`
through whichever media server is configured (REQ-4 below). `106` must ship first.

Jellyfin keeps two roles, both optional: it is still notified after an embed when it is the
configured media server, and `101`'s administrator embed of Jellyfin sidecars ("Incrustar en
archivo") stays exactly as it is, Jellyfin only.

Pipeline stages touched: **Notify media server** (the search no longer goes through it; the Jellyfin
client loses its remote subtitle calls), **Transcode** (`worker` gains a probe job beside `103`'s
`subtitle-sync`), **Browse library** (Settings gains the OpenSubtitles account; `/preferences`
changes its availability hint). Outside the pipeline, the release build gains the application key
(`infra`).

## Requirements

### Functional Requirements

- [ ] **REQ-1 (Account Settings)**: Two installation-wide Settings, editable by an administrator in
      the existing Settings → General tab, in a block of their own headed OpenSubtitles:
      - `opensubtitles_username`;
      - `opensubtitles_password` (secret).

      Both are required: OpenSubtitles counts downloads against the logged-in account, and the
      anonymous allowance (5 per IP per day) would not cover one search. The password follows the
      existing `secret` kind exactly as `movie_db_api_key` does: readable only through the admin-only
      `settings` query, edited in a password input, never logged and never exposed through
      `mediaCapabilities` or any other non-admin field. No masking is added. The block says the
      account is an opensubtitles.com one (not .org), links to opensubtitles.com's sign-up, and states
      the account's daily download quota is what limits the feature. It never asks for an API key.
- [ ] **REQ-13 (Application key)**: Perceptor uses exactly one OpenSubtitles API key, its own,
      registered by the project's maintainer. OpenSubtitles requires one key per application and
      bans an application that makes its users create keys, so no installation is ever asked for
      one. `api` takes it from, in order:
      1. the `OPENSUBTITLES_API_KEY` environment variable, when non-empty after trimming (a
         development checkout, from its `.env`);
      2. a file the release build writes into the published `api` image from the repository's
         `OPENSUBTITLES_API_KEY` GitHub Actions secret;
      3. neither: the search is unavailable (REQ-2), and `api` logs one warning at boot that names
         the missing key, never a value.

      The key is never a Setting, never stored in the database, never returned by any GraphQL
      field (`settings` included) and never logged. It is not secret from whoever pulls the image,
      and nothing pretends otherwise: what protects it is that it is worth little without an
      account, and that rotating it is a secret change plus a release. Every request carries
      `User-Agent: Perceptor v<version>`, the application name the key is registered under.
- [ ] **REQ-2 (Availability, replaces `103` REQ-1)**: `MediaCapabilities.subtitleSearchAvailable` is
      true exactly when the application key resolves (REQ-13) and both Settings of REQ-1 are
      non-empty. It no longer depends on `media_server_client`. While it is false, `/preferences`
      shows the `subtitleSearch` checkbox disabled with a hint that an administrator has to enter an
      OpenSubtitles account, `106`'s button is absent, and no search starts. Stored preferences are
      kept.
- [ ] **REQ-3 (Present languages, replaces `103` REQ-6 and REQ-7)**: A search no longer waits for
      Jellyfin. Its first step is a probe of the library file by the worker, which reports:
      - the ISO 639-2 languages of its subtitle streams that are not forced, embedded tracks of any
        codec;
      - the raw language tags of sidecar subtitles in the same directory whose name is the file's base name
        followed by a language tag (`<base>.<lang>[.<flag>…].<ext>`, the naming Jellyfin and Plex
        both read), counted only when not flagged forced;
      - the file's size and its OpenSubtitles hash.

      The worker reports a sidecar's tag as written; `api` resolves it against its own `Language`
      table, the one place ISO codes are mapped. A sidecar's language tag is accepted as ISO 639-1 (`es`), ISO 639-2 (`spa`, `spa`'s
      bibliographic form included where it differs) or either with a region (`es-419`, `pt-BR`), and
      is compared by its base ISO 639-2 code as `103` REQ-5 compares wanted languages. A tag that is
      none of those (`Spanish`, `castellano`) is not counted. A sidecar flag `forced` (or `foreign`)
      makes it forced; `sdh`, `cc` and `default` do not.

      A wanted language is missing when neither list holds it. When none is missing, the search
      completes with no call to OpenSubtitles. The probe only reads; it never writes or deletes
      anything under the destinations root.
- [ ] **REQ-4 (Library file path)**: The file probed, validated and embedded is the title's
      `filePath`. For a title with no `filePath` (`106` REQ-7), the path comes from the configured
      media server: Jellyfin's item, as `106` REQ-7 already does, or Plex's item (the file of its
      media part, matched by season and episode for an episode), translated from host to container
      path (Article V). When there is no media server, or it does not hold the title, `106`'s press
      is refused with `error.subtitleSearch.no_library_path` and no search is created. When the
      server is unreachable at press time, the press is refused with
      `error.subtitleSearch.media_server_unavailable`. `106` REQ-7's checks on that path (`.mkv`,
      inside the destinations root) still run before the probe, so neither costs a call to
      OpenSubtitles. This amends `106` REQ-7, which assumed Jellyfin was always configured.
- [ ] **REQ-5 (Authentication)**: `api` logs in to OpenSubtitles with the username and password and
      reuses the token it gets until it expires or a call answers unauthorized, then logs in once
      more. A second unauthorized answer, or a rejected login, fails the search's remaining
      languages with `error.subtitleSearch.provider_unauthorized`. Every call carries the API key
      and a `User-Agent` naming Perceptor and its version, which OpenSubtitles requires.
- [ ] **REQ-6 (Candidates, replaces the source of `103` REQ-8)**: For each missing language, one
      search call by the title's TMDB id (the film's; for an episode, the series' plus the season
      and episode numbers), in that language, also carrying the file's hash. Regional variants are
      searched as their base language (`103` REQ-5); where OpenSubtitles splits a base language into
      variants of its own (`pt-PT`/`pt-BR`, `zh-CN`/`zh-TW`), all of them are searched. A result is
      dropped when it:
      - lists **more than one file** (a multi-CD upload);
      - is foreign-parts-only (OpenSubtitles' forced equivalent);
      - is marked machine-translated or AI-translated.

      The rest are ranked as `103` REQ-8 already ranks them, where a hash match is now real (it can
      happen when compression was off and the library file is the release itself), and the release
      name compared is the subtitle's own release name. At most 3 are tried per language, in rank
      order. Format is no longer a filter: every candidate is downloaded converted to SRT.
- [ ] **REQ-7 (Fetch, replaces the source of `103` REQ-9)**: A candidate is fetched through
      OpenSubtitles' download call and written to a staging file under the downloads root, exactly
      where `103` REQ-9 writes it today. Jellyfin is never involved.
- [ ] **REQ-8 (Quota)**: OpenSubtitles reports the remaining downloads with each download. When a
      download is refused for quota, or the remaining count reaches zero, the search stops fetching:
      every language not yet resolved ends `FAILED` with `error.subtitleSearch.quota_exhausted`, and
      every language already accepted is still embedded. No later search waits for or retries
      around the quota.
- [ ] **REQ-9 (Rate limiting)**: A call answered "too many requests" is retried once after the delay
      the answer names (bounded to 10 s). A second refusal fails that language with
      `error.subtitleSearch.provider_unavailable`.
- [ ] **REQ-10 (After the embed)**: Once `101`'s embed of a search's tracks completes, the configured
      media server is told the file changed: Jellyfin as `101` already does, Plex through its
      path-scoped scan (`072`), nothing when there is none. A failed notification is a warning on the
      embed, as in `101`, never a failed search. With no media server configured there is nothing to
      notify, so no warning is recorded.
- [ ] **REQ-11 (Jellyfin search removed)**: Jellyfin's remote subtitle search and fetch are no longer
      used and are removed from its client. `101`'s administrator embed of Jellyfin sidecars, and its
      listing of them, are untouched and still require Jellyfin.
- [ ] **REQ-12 (Status while probing)**: A search reads `WAITING` from its creation until the probe
      reports, then `SEARCHING` as today. `SubtitleSearchStatus` keeps its six values; `WAITING` now
      means "the file is being read" instead of "Jellyfin has not indexed it yet", and `web`'s
      existing label (`En espera`) covers both.
- [ ] **REQ-14 (Provenance tags on an embedded track)**: Every subtitle track Perceptor embeds
      carries two track-level Matroska tags, so the origin of a track can be read from the file
      alone (`mkvinfo`, MediaInfo), the way `046`'s `PERCEPTOR_SOURCE` records a video's release:
      - `PERCEPTOR_SOURCE`: for a track the search fetched from OpenSubtitles, the subtitle's file
        name as OpenSubtitles lists it (its `files[].file_name`, e.g.
        `Resident Evil Extinction 2007 2160p BluRay TrueHD Atmos 7 1 DV HDR10 x265-MainFrame.srt`);
        for a track an administrator embedded by hand through `101`'s "Incrustar en archivo", the
        literal `user`.
      - `PERCEPTOR_OFFSET`: the offset applied to the track before the remux, in whole milliseconds
        with its sign (`-2000`, `0`), as `101`'s `offsetMs` convention defines it.

      The value is third-party text: the worker writes it with every control character removed and
      cut to 500 characters, and escaped for the tags file. A search track whose stored file name is
      missing (an attempt fetched before this amendment) is written with OpenSubtitles' file id
      instead (`opensubtitles:<id>`), never left blank. Tracks already embedded are not rewritten.
      A failure to write the tags is a failed embed, as any other `mkvmerge` failure.

### Non-Functional & Operational Requirements

- [ ] **NFR-1 (Quota cost, replaces `103` NFR-2)**: Per search: one search call per missing language,
      at most 3 downloads per missing language, and **no download for a multi-file result**. The
      login is not repeated per search while its token is valid.
- [ ] **NFR-2 (Crash recovery, extends `103` NFR-5)**: A probe the worker has started (it reports the
      start, as `subtitle-sync` does) and that is still running when the worker announces its boot
      is queued again once; a second interruption of the same search's probe fails it with
      `error.subtitleSearch.interrupted`. Unlike a validation, a probe costs no quota, which is why
      it is retried rather than failed outright. A probe queued but never started is simply run
      when the worker comes back; `103` NFR-5's rescheduling on `api` boot covers a lost queue
      entry. No search stays non-terminal forever.
- [ ] **NFR-3 (No media-server coupling)**: With `media_server_client` set to none, the application
      key present and REQ-1's Settings filled, a delivery to a title whose owner opted in completes a search end to end.
- [ ] **NFR-4 (Constitution)**: Article XII needs no amendment: the embed, its staging in the
      downloads root and its exception are `103`'s, and the probe only reads the library.
- [ ] **NFR-5 (Tests where failure is silent, Article IX)**: Covered by tests that fail when the rule
      is removed:
      - a result listing two files is never downloaded;
      - foreign-parts-only, machine- and AI-translated results never reach a download;
      - a hash match outranks every other result;
      - a language present only as a sidecar, or only as an image track, counts as present; one
        present only as a forced track (embedded, or a sidecar flagged `forced`) counts as missing;
      - a quota refusal stops further downloads in the same search and keeps accepted languages;
      - one re-login after an unauthorized answer, and no third attempt;
      - `subtitleSearchAvailable` follows the application key and the two Settings, and ignores the
        media server;
      - the environment variable wins over the image's file, and an empty or whitespace-only
        variable falls through to the file;
      - the probe opens the library file read-only;
      - a sidecar tag that is not an ISO code (`Spanish`) is not counted as present, and
        `es-419` is counted as `spa`;
      - a second interrupted probe fails the search instead of queueing a third run;
      - the migration fails only `WAITING`/`SEARCHING` searches.
- [ ] **NFR-6 (Release carries the key)**: A release of this repository never publishes an `api`
      image without the application key: the build fails instead when the secret is empty. The key
      reaches the image only through a build secret, so it appears in neither the image's
      configuration (`docker inspect`) nor its layer history (`docker history`). A build anywhere
      else (a fork, a local `bin/build`) without the key succeeds, and its search is simply
      unavailable.

## GraphQL Contract Delta

```graphql
extend type MediaCapabilities {
  """True while Perceptor's OpenSubtitles application key is present and the OpenSubtitles username and password Settings are set (107 REQ-2). Never exposes any of them."""
  subtitleSearchAvailable: Boolean!
}

type SubtitleProbeDetails {
  id: Int!
  """Absolute container path of the library file to probe."""
  filePath: String!
}

type Query {
  """Service-only (worker). Same standing as SubtitleSyncDetails."""
  subtitleProbeDetails(id: Int!): SubtitleProbeDetails!
}

type Mutation {
  """Service-only (worker). Records that the probe started (107 NFR-2); false if the search is no longer WAITING, and the worker then abandons silently."""
  subtitleProbeStarted(id: Int!): Boolean!
  """Service-only (worker). Safe to receive more than once; false if the search is no longer WAITING."""
  subtitleProbeCompleted(
    id: Int!
    """ISO 639-2 codes of the non-forced embedded subtitle tracks (107 REQ-3)."""
    embeddedLanguagesIso3: [String!]!
    """Language tags of the non-forced sidecars, as written in their names (`es`, `es-419`, `spa`, `Spanish`); api resolves them (107 REQ-3)."""
    sidecarLanguageTags: [String!]!
    """File size in bytes. Float: a library file exceeds Int's 2^31."""
    fileSizeBytes: Float!
    """OpenSubtitles hash of the file, 16 lowercase hex digits."""
    movieHash: String!
  ): Boolean!
  """Service-only (worker). Safe to receive more than once."""
  subtitleProbeFailed(id: Int!, errorKey: String!): Boolean!
}

extend type SubtitleEmbedTrack {
  """Value of the PERCEPTOR_SOURCE track tag (107 REQ-14): the OpenSubtitles file name for a searched track, `user` for a sidecar embedded by hand. Written verbatim after sanitizing; never empty."""
  provenance: String!
}
```

`subtitleSearchAvailable` keeps its name and type; only its meaning changes (REQ-2). `web` needs no
change to read it, only to its hint copy. The two Settings travel through the existing Settings
query and mutation as any other key; no new Settings type. The application key crosses no service
boundary at all: only `api` reads it.

`SubtitleEmbedTrack.provenance` (0.4.0) is read by the worker's existing `subtitleEmbedDetails`
call; `PERCEPTOR_OFFSET` needs no new field, it is the track's existing `offsetMs`. A worker that
receives no `provenance` (an `api` older than 0.4.0) writes no tags and embeds as before.

The queue payload gains one queue and one job: `subtitle-probe` / `subtitle-probe`, payload
`{ subtitleSearchId: number }`, concurrency 1, as `103`'s `subtitle-sync`. `id` in the two mutations
and the query above is the `SubtitleSearch` id.

| Condition | HTTP / GraphQL error | Message the user sees |
| :-- | :-- | :-- |
| `setSubtitleSearch(true)` or a `106` press while `subtitleSearchAvailable` is false | `BadRequestException` `error.subtitleSearch.provider_not_configured` (replaces `unsupported_media_server`) | `La búsqueda de subtítulos requiere una cuenta de OpenSubtitles en Ajustes → General.` |
| `106` press for a title with no `filePath` and no media server holding it | `BadRequestException` `error.subtitleSearch.no_library_path` (new) | `Perceptor no sabe dónde está el archivo de este título.` |
| `106` press for a title with no `filePath` while the media server is unreachable | `BadRequestException` `error.subtitleSearch.media_server_unavailable` (kept, now thrown only here) | `No se pudo contactar al servidor de medios para ubicar el archivo.` (copy changes: it no longer names Jellyfin) |
| Service-only query/mutation with a user token | the existing service-guard key | the existing message |
| `subtitleProbeDetails` for an unknown id | `NotFoundException` `error.subtitleSearch.probe_not_found` | not user-facing (worker logs and abandons) |

New outcome keys, shown in the panel and never thrown:

| Key | Message the user sees |
| :-- | :-- |
| `error.subtitleSearch.provider_unauthorized` | `OpenSubtitles rechazó el usuario o la contraseña.` |
| `error.subtitleSearch.provider_unavailable` | `No se pudo contactar a OpenSubtitles.` |
| `error.subtitleSearch.quota_exhausted` | `Se agotaron las descargas diarias de OpenSubtitles.` |
| `error.subtitleSearch.probe_failed` | `No se pudo leer el archivo para ver qué subtítulos tiene.` |

Retired keys (no longer produced; kept in the catalog so a search stored before this spec still
renders): `error.subtitleSearch.unsupported_media_server`, `error.subtitleSearch.item_not_found`.

`web` must handle `provider_not_configured` on the `/preferences` save (revert the checkbox, as `103`
does for the key it replaces) and on `106`'s dialog, and `no_library_path` and
`media_server_unavailable` on `106`'s dialog (shown inline, the dialog stays open). The
`/preferences` hint that today reads `La búsqueda de subtítulos requiere Jellyfin como servidor de
medios.` becomes `Un administrador tiene que cargar una cuenta de OpenSubtitles en Ajustes → General.`

The worker, on `subtitleProbeDetails` → `probe_not_found` or `subtitleProbeStarted` → `false`,
logs and abandons with no outcome, the posture `103` gives `subtitleSyncStarted`. A probe that
throws reports `subtitleProbeFailed` with `error.subtitleSearch.probe_failed`, and `api` ends the
search `FAILED` with that key.

## Data Model Changes

| Model | Change | Nullable / default | Backfill needed? |
| :-- | :-- | :-- | :-- |
| `Setting` rows | seed `opensubtitles_username`, `opensubtitles_password` | empty string | No |
| `SubtitleSearch` | drop `itemId` and `checkCount` (no Jellyfin item, no bounded wait); `presentLanguages` now filled by the probe; `libraryPath` (`106`) now also filled from Plex | — | No |
| `SubtitleSearch` | add `movieHash String?`, `fileSizeBytes BigInt?` | null until the probe reports | No |
| `SubtitleSearch` | add `probeCount Int` (probes started, NFR-2) | default `0` | No |
| `SubtitleSearch` | add `languageErrors Json?`: ISO 639-2 code → error key, for a language that failed with no attempt row to carry the reason (REQ-5, REQ-8, REQ-9) | null | No |
| `SubtitleSearchAttempt` | `providerSubtitleId` now holds the OpenSubtitles file id | — | No |
| `SubtitleSearchAttempt` | add `providerFileName String? @db.VarChar(500)`: OpenSubtitles' `file_name` for the candidate (REQ-14, 0.4.0) | null; null for attempts created before 0.4.0 | No |
| `SubtitleEmbed.tracks` (Json) | each stored track gains `provenance` (REQ-14, 0.4.0). A track stored before 0.4.0 (an embed still queued at the upgrade) is served as `user` when it is a sidecar and `opensubtitles` when it is a staged search track | — (Json) | No |

Searches non-terminal when this migrates are split by how far they got:

- `WAITING` and `SEARCHING` were waiting on, or talking to, Jellyfin. They end `FAILED` with
  `error.subtitleSearch.superseded`; any staged file of theirs is deleted.
- `VALIDATING` keeps the candidates already fetched: each attempt with a staged file is validated
  as usual. Attempts not yet fetched (their id is a Jellyfin one) end `FAILED` with
  `error.subtitleSearch.superseded` and are never fetched; a language left with no accepted
  candidate ends `REJECTED` or `FAILED` by `103`'s rules.
- `EMBEDDING` finishes untouched; nothing after the embed involves the provider.

## Acceptance Criteria

- [ ] **AC-1**: With the media server set to **none**, an administrator fills the two Settings.
      `/preferences` shows the checkbox enabled. A film whose owner wants `spa` is delivered from a
      release with English only; its search reaches `COMPLETED` with Spanish `EMBEDDED`, and
      `mkvmerge -J` lists the new track.
- [ ] **AC-2**: The same with the media server set to Jellyfin: after the embed Jellyfin shows the
      Spanish track without a manual library scan.
- [ ] **AC-3 (failure)**: A film for which the top-ranked Spanish result on OpenSubtitles is a 2-CD
      upload: the attempts table has no row for it, and the account's remaining download count drops
      only by the attempts that do exist.
- [ ] **AC-4**: A film whose library file has a `<base>.es.srt` sidecar and no embedded Spanish
      track: Spanish reads `ALREADY_PRESENT` and no OpenSubtitles call is made for it.
- [ ] **AC-5 (failure)**: With a wrong password, a search ends with every missing language `FAILED`
      and `OpenSubtitles rechazó el usuario o la contraseña.` in the panel. The title's
      status is untouched.
- [ ] **AC-6 (failure)**: With the account at zero remaining downloads, a search for two missing
      languages makes no download and both read `FAILED` with
      `Se agotaron las descargas diarias de OpenSubtitles.`
- [ ] **AC-7 (failure)**: Emptying `opensubtitles_username` from Settings → General makes
      `subtitleSearchAvailable` false; `setSubtitleSearch(true)` then returns
      `La búsqueda de subtítulos requiere una cuenta de OpenSubtitles en Ajustes → General.`
- [ ] **AC-8**: Neither the application key nor `opensubtitles_password` appears in the `api` log at
      any level during a search, nor in any response to a non-admin user (`mediaCapabilities`
      included); `settings` called as a non-admin is refused as today, and `settings` called as an
      admin contains no entry holding the application key.
- [ ] **AC-16**: For a published release tag, `docker run --rm --entrypoint sh
      ghcr.io/dientuki/perceptor-api:<tag> -c 'test -s /app/secrets/opensubtitles_api_key'` succeeds, and neither
      `docker inspect` nor `docker history --no-trunc` of that image contains the key.
- [ ] **AC-17 (failure)**: A local `bin/build prod api` with no `OPENSUBTITLES_API_KEY` in `.env`
      succeeds; that image's `api` logs the missing-key warning at boot and reads
      `subtitleSearchAvailable: false` with both Settings filled. Re-running a release with the
      secret deleted fails the `api` build leg and moves no tag.
- [ ] **AC-9**: With compression off, a film whose library file is a release OpenSubtitles knows by
      hash ranks that result first (its attempt has rank 1 and is the one accepted).
- [ ] **AC-10**: `101`'s "Incrustar en archivo" still embeds a Jellyfin sidecar with Jellyfin
      configured. `schema.gql` and the Jellyfin client have no remote subtitle search or fetch left.
- [ ] **AC-11 (failure)**: The worker is killed during a probe. After it restarts the probe runs
      again and the search proceeds; killed a second time, the search reads `FAILED` with
      `error.subtitleSearch.interrupted`.
- [ ] **AC-12**: The library folder's listing (names, sizes, mtimes) is identical before and after a
      search that ends with nothing embedded.
- [ ] **AC-13**: With Plex as the media server, `106`'s button on a film Plex holds but Perceptor never
      delivered (`filePath` null) starts a search whose `libraryPath` is that film's `.mkv`; with the
      media server set to none, the same press answers
      `Perceptor no sabe dónde está el archivo de este título.` and creates no `SubtitleSearch` row.
- [ ] **AC-14 (failure)**: A search left `WAITING` by a 103-era Jellyfin wait reads `FAILED` with
      `Una entrega más nueva reemplazó esta búsqueda.` after the migration, and one left `EMBEDDING`
      still reaches `COMPLETED`.
- [ ] **AC-15**: `bin/npm api run test` and `bin/npm worker run test` pass, including NFR-5's cases.
- [ ] **AC-18**: After a search embeds a Spanish track, `mkvinfo` (or MediaInfo) of the library file
      shows on that track `PERCEPTOR_SOURCE` equal to the file name OpenSubtitles lists for the
      accepted subtitle and `PERCEPTOR_OFFSET` equal to the accepted attempt's `offsetMs`. After an
      administrator embeds a Jellyfin sidecar by hand, the new track reads `PERCEPTOR_SOURCE: user`
      and `PERCEPTOR_OFFSET` equal to the offset chosen (`0` if none). Tracks that were already in
      the file carry no such tags.

## Amendments

- **0.2.0 (2026-10-26, at approval).** Three corrections found while planning, none a change of
  intent:
  - REQ-1 and AC-8 no longer promise that `settings` hides the two secrets; the `secret` kind has
    never masked anything, and these two keys follow the same posture as `movie_db_api_key`.
  - `subtitleProbeCompleted` reports embedded ISO 639-2 codes and raw sidecar tags separately, so
    the mapping of a tag to a language happens once, in `api`, against its `Language` table, instead
    of in a second table in the worker.
  - `SubtitleSearch.languageErrors` is added: a language that failed before any attempt row existed
    (a refused login, an exhausted quota, a second rate-limit refusal) would otherwise read
    `NOT_FOUND`. `languages` on the wire is unchanged; it reads `FAILED` with that key.

- **0.3.0 (2026-10-26).** The API key leaves Settings. OpenSubtitles requires one key per
  application and bans one that makes its users create keys, which is what 0.2.0's REQ-1 asked
  every administrator to do. Perceptor now ships one key, read from `OPENSUBTITLES_API_KEY` in a
  development `.env` and from a file baked into the release image from the repository's GitHub
  Actions secret (REQ-13, NFR-6). Settings keep only the account; `infra` joins `services:`. The
  unauthorized message no longer names an API key, since the administrator cannot change it.

- **0.4.0 (2026-10-27, during the manual pass).** Provenance on embedded tracks (REQ-14, AC-18):
  every track Perceptor embeds carries `PERCEPTOR_SOURCE` (OpenSubtitles' file name, or `user` for
  a hand embed) and `PERCEPTOR_OFFSET`. Adds `SubtitleEmbedTrack.provenance` to the contract and
  `SubtitleSearchAttempt.providerFileName` to the schema, in a second migration, because the first
  one is already applied on the development database. `infra` and `web` are unaffected.

## Out of Scope

- **An API key per installation, or an administrator override of Perceptor's.** Forbidden by
  OpenSubtitles (one key per application); asking for one is what gets an application banned.
- **Hiding the application key from whoever pulls the image.** Impossible for a key `api` must use
  in clear on the user's machine: encrypting it means shipping the decryption key beside it. A
  proxy holding the key would make every installation depend on a server the project runs, and put
  every user's OpenSubtitles password through it.

- **Keeping Jellyfin as an alternative provider.** One provider, one code path (Article X). `101`'s
  manual sidecar embed is a different feature and stays.
- **Other providers** (Subdl, Subdivx, Podnapisi). A provider seam can be cut when a second one is
  actually wanted.
- **Showing the remaining daily quota** in Settings or in `106`'s dialog. OpenSubtitles reports it
  only on a download; displaying a stale number is a later decision.
- **Searching before the encode, by the source release's hash.** Now technically possible, since
  `api` can hash any file, but it changes when a search starts and where the reference comes from.
  A later spec.
- **Per-user OpenSubtitles accounts.** The account and its quota are installation-wide, like the
  TMDB key.
- **Correcting a framerate or splitting a multi-CD subtitle.** Same reasons as `103`'s Out of Scope:
  `101`'s embed applies one constant offset.
- **A "test connection" button.** A wrong credential shows up as REQ-5's outcome on the first search.
- **A separate key per environment** (RC versus final). The same application key serves every
  environment; GitHub Environments could split it later without any change in `api`.
