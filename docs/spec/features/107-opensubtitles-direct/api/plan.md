---
title: OpenSubtitles Direct — api slice
service: api
last_updated: 2026-10-27
status: Approved
---

# PLAN: OpenSubtitles Direct — `api` (`api/plan.md`)

## Scope

`api` replaces the Jellyfin source of `103`'s subtitle search with OpenSubtitles' REST API. It:

- owns the migration;
- adds an OpenSubtitles adapter, the resolution of Perceptor's application key (REQ-13), and a
  producer for the new `subtitle-probe` queue;
- answers the worker's three probe operations;
- resolves sidecar language tags;
- moves `106`'s no-`filePath` path resolution to press time, through Jellyfin or Plex;
- makes the after-embed notification media-server-neutral;
- removes Jellyfin's remote subtitle calls.

`api` does **not** put the application key into the image or the compose files; that is `infra`'s
(`../infra/plan.md`). `api` only reads it from the two sources frozen in `../plan.md` § Contract
Freeze. `api` does **not** read the library file. The probe (streams, sidecars, size, hash) is the worker's,
and `api` only stores what the worker reports. It does not touch `web` copy, and it does not change
the `subtitle-sync` job, `acceptance.ts` or the embed's worker side.

Writes are confined to `services/api/` and this directory.

## Files

| File | New / Modified | What changes |
| :-- | :-- | :-- |
| `prisma/schema.prisma` | Modified | `SubtitleSearch`: add `movieHash String? @db.VarChar(16)`, `fileSizeBytes BigInt?`, `probeCount Int @default(0)`, `languageErrors Json?`; drop `itemId`, `checkCount` |
| `prisma/migrations/<ts>_107_opensubtitles_direct/migration.sql` | New | columns + the data steps of `../plan.md` § Migrations, in that order |
| `prisma/seeds/settings.ts` | Modified | two `""` rows: `opensubtitles_username`, `opensubtitles_password` |
| `src/settings/settings.catalog.ts` | Modified | `opensubtitles_username` `string`, `opensubtitles_password` `secret`; no key entry |
| `src/clients/opensubtitles/key.ts` | New | `openSubtitlesApiKey(): string \| null`: env, then the image file, then `null` |
| `src/clients/opensubtitles/key.spec.ts` | New | see Tests |
| `src/clients/opensubtitles/client.ts` | New | `OpenSubtitlesClient`: `login`, `search`, `download`, token cache |
| `src/clients/opensubtitles/types.ts` | New | raw response shapes |
| `src/clients/opensubtitles/errors.ts` | New | `OpenSubtitlesHttpError(status, kind)` with `kind: 'unauthorized' \| 'quota' \| 'rate_limited' \| 'unavailable'` |
| `src/clients/opensubtitles/client.spec.ts` | New | see Tests |
| `src/queue/types.ts` | Modified | `SUBTITLE_PROBE_QUEUE`, `SUBTITLE_PROBE_JOB`, `SubtitleProbeJob { subtitleSearchId: number }` |
| `src/queue/subtitle-probe-queue.service.ts` | New | `addProbe`, `removeProbe` (jobId `subtitle-probe-<id>`, `attempts: 1`) |
| `src/subtitle-search/candidates.ts` | Modified | provider-neutral `SubtitleCandidate`; filter is "one file, not foreign-parts-only, not machine/AI" |
| `src/subtitle-search/sidecar-languages.ts` | New | pure: raw tags + `Language` rows → ISO 639-2 set |
| `src/subtitle-search/provider-languages.ts` | New | pure: ISO 639-2 → OpenSubtitles language codes (`por` → `pt-pt,pt-br`, `chi` → `zh-cn,zh-tw`) |
| `src/subtitle-search/subtitle-search.driver.ts` | Modified | `WAITING` = probe; `SEARCHING`/fetch through `OpenSubtitlesClient`; quota/unauthorized/rate-limit outcomes; `embedStaged` gets the path |
| `src/subtitle-search/subtitle-search.service.ts` | Modified | `probeDetails`, `probeStarted`, `probeCompleted`, `probeFailed` |
| `src/subtitle-search/subtitle-search.resolver.ts` | Modified | the four service-only operations |
| `src/subtitle-search/entities/subtitle-probe-details.entity.ts` | New | `SubtitleProbeDetails` |
| `src/subtitle-search/derive-languages.ts` | Modified | read `languageErrors` before `NOT_FOUND`/`PENDING` |
| `src/subtitle-search/subtitle-search-request.service.ts` | Modified | wake with no delay on delivery; resolve `libraryPath` at press time; drop `checkCount` |
| `src/subtitle-search/subtitle-search.module.ts` | Modified | provide `OpenSubtitlesClient`, `SubtitleProbeQueueService`; import `RedisModule` |
| `src/subtitle-embed/subtitle-embed.service.ts` | Modified | `embedStaged(ref, tracks, mkvPath)`; `notifyJellyfin` → `notifyMediaServer`; press-time path helper |
| `src/media/media-capabilities.service.ts` | Modified | availability = key resolves and both settings non-empty; `assertSubtitleSearchAvailable` throws `provider_not_configured` |
| `src/media/entities/media-capabilities.entity.ts` | Modified | field description only |
| `src/clients/media-server/types.ts` | Modified | add optional `mediaHostPath`; remove `searchRemoteSubtitles`, `fetchRemoteSubtitle`, `RemoteSubtitleCandidate`; `ItemSubtitles.presentLanguagesIso3` removed if nothing else reads it |
| `src/clients/media-server/jellyfin.ts` | Modified | remove the two remote calls; implement `mediaHostPath` |
| `src/clients/media-server/plex.ts` | Modified | implement `mediaHostPath` and `modifiedMedia` |
| `src/process-jobs/process-jobs.service.ts` | Modified | probe retry-once in `reconcileOrphanedEncodes` |
| `src/i18n/error-keys.ts`, `src/i18n/messages.en.ts` | Modified | six new keys (spec tables); `media_server_unavailable` English copy |

## Existing code to reuse

- `subtitle-search/candidates.ts`: `releaseSimilarity` and the sort comparator stay byte-identical.
  Only the filter and the input type change. `MAX_CANDIDATES_PER_LANGUAGE` stays 3.
- `subtitle-search/staging.ts`: `SubtitleSearchStaging.write(searchId, attemptId, bytes)` takes the
  downloaded bytes as today.
- `subtitle-search/subtitle-search.service.ts`'s `started`/`completed`/`failed` for `subtitle-sync`
  are the shape of the probe's three: guarded `updateMany` on the expected status, `true` on a
  repeat, `wake` after a successful claim.
- `queue/subtitle-sync-queue.service.ts`: copy for `SubtitleProbeQueueService`, adding `removeProbe`.
- `process-jobs/process-jobs.service.ts`'s `reconcileOrphanedEncodes`: the `054` requeue pattern
  (`recoveryCount`, remove before add) is what the probe follows with `probeCount`.
- `clients/torrent/auth.ts`'s `torrentAuthHeaders()` (`104`): the precedent for a credential read
  straight from `process.env`, never a Setting, never logged. `key.ts` follows it and adds the
  image file as the second source.
- `clients/tmdb/client.ts` + `errors.ts`: the adapter shape. It is `@Injectable`, reads settings per
  call via `SettingsService.getMap()`, and throws a typed error with `status`.
- `redis/`: `RedisService` for the token (`SET … EX`).
- `languages/`: the `Language` rows (`tag`, `iso2`, `iso3`) via Prisma, for both pure mappers.
  `030`'s rule applies: look up by `tag`, never by the non-unique `iso2` alone.
- `subtitle-embed/subtitle-embed.service.ts`'s `assertUsableMkv`, `readItemListing`,
  `hostToContainerPath`: the press-time path check reuses them. The `.mkv`/inside-library refusals
  keep `106`'s keys.
- `media-server/media-server.service.ts`'s `createClient()`: the one settings→client construction.
- `media-roots/`: `hostToContainerPath('library', …)` / `containerToHostPath` (Article V).

## Steps

1. **Schema + migration.** Edit `schema.prisma`. Generate the migration with
   `bin/npm api run prisma:migrate -- --create-only --name 107_opensubtitles_direct`, then hand-edit
   it so the two `UPDATE`s of `../plan.md` § Migrations run **after** the `ADD COLUMN`s and
   **before** the `DROP COLUMN`s. `prisma:generate`.
2. **Settings.** Add the two catalog entries and seed rows. No `opensubtitles_api_key` row exists
   anywhere: not in the catalog, not in the seed.
3. **Application key** (`clients/opensubtitles/key.ts`, REQ-13):
   - `OPENSUBTITLES_API_KEY` from `process.env`, trimmed. Non-empty wins, read on every call (as
     `torrentAuthHeaders` does), so a changed `.env` plus a restart is enough in development.
   - Otherwise, `/app/secrets/opensubtitles_api_key` (a module constant, the path frozen with
     `infra`), read once with `readFileSync`, trimmed and memoized. A missing or unreadable file
     memoizes `null` without throwing.
   - Otherwise `null`.
   - Never logs the value. The driver's existing `onApplicationBootstrap` logs one warning when it
     resolves `null`: "OpenSubtitles API key not found (OPENSUBTITLES_API_KEY or the image's key
     file); subtitle search is unavailable".
4. **Error keys.** Add `provider_not_configured`, `no_library_path`, `probe_not_found`,
   `provider_unauthorized`, `provider_unavailable`, `quota_exhausted`, `probe_failed`. Keep
   `unsupported_media_server`, `item_not_found` and `media_server_unavailable` (the English copy of
   the last one stops naming Jellyfin).
5. **`OpenSubtitlesClient`** (`https://api.opensubtitles.com/api/v1`):
   - every request sends `Api-Key` (from `openSubtitlesApiKey()`), `User-Agent: Perceptor
     v<api package.json version>` and `Content-Type: application/json`. `Perceptor` is the
     application name the key is registered under on opensubtitles.com;
   - `login()` is `POST /login`. It caches `{ token, baseUrl }` in Redis under
     `opensubtitles:token:<sha256(apiKey + username + password)>` with a 23-hour TTL, and uses the
     returned `base_url` for later calls;
   - `search({ tmdbId | parentTmdbId+season+episode, languages, moviehash })` is `GET /subtitles`. It
     maps each result to `SubtitleCandidate`: `id` = the first file's `file_id`, `fileCount`,
     `release`, `hearing_impaired`, `foreign_parts_only`, `machine_translated`, `ai_translated`,
     `moviehash_match`, `download_count`;
   - `download(fileId)` is `POST /download { file_id, sub_format: 'srt' }`, then `GET` the returned
     link. It returns `{ bytes, remaining: number | null }`;
   - error handling (REQ-5, REQ-9):
     - `401`: drop the cached token, log in once more, retry once; a second `401` throws `unauthorized`;
     - `406` on download: `quota`;
     - `429`: wait `min(Retry-After or ratelimit-reset, 10 s)`, retry once; a second `429` throws
       `rate_limited`;
     - network errors and `5xx`: `unavailable`.
   - Error messages carry method, path and status only. Never a body, header or credential.
6. **Pure mappers.**
   - `sidecar-languages.ts`: a tag matches a `Language.tag` exactly (`es-419`); else its base before
     `-`/`_` matches a `tag` (`pt-BR` → `pt`); else a 3-letter tag matches an `iso3`, with `/T` → `/B`
     (`fra` → `fre`); else it is dropped. The result is a deduplicated set of `iso3`.
   - `provider-languages.ts`: the inverse for the search call, from `iso3` to the base `tag` (= ISO
     639-1). It expands `por` and `chi` per REQ-6.
7. **Probe operations** in `SubtitleSearchService` + resolver, each `@AllowService()` with the
   explicit `principal.type !== 'service'` rejection `encodeWorkerStarted` uses:
   - `probeDetails(id)`: path = `movie.filePath ?? episode.filePath ?? libraryPath`. If the row is
     missing or not `WAITING`, or there is no path, throw `notFound(probe_not_found)`.
   - `probeStarted(id)`: `updateMany where { id, status: 'WAITING', probeCount: { lt: 2 } }` increments
     `probeCount`. Returns `count === 1`.
   - `probeCompleted(id, embedded, sidecarTags, size, hash)`:
     - resolve the tags (step 6);
     - `present = embedded ∪ resolved`;
     - guarded `WAITING` → `SEARCHING` writing `presentLanguages`, `fileSizeBytes`, `movieHash`;
     - `wake(0)`;
     - a repeat or a non-`WAITING` row returns `true`/`false` per the SDL description.
   - `probeFailed(id, key)`: an unknown key is stored as `probe_failed` (the `failed()` posture).
     Fails the search with the key.
8. **Driver.**
   - `WAITING`:
     - if `!isSubtitleSearchAvailable()`, fail with `provider_not_configured`;
     - otherwise `removeProbe` + `addProbe`, then wake at `PROBE_BACKSTOP_MS` (60 min);
     - on a backstop wake still `WAITING`, fail with `probe_failed`;
     - delete `MISS_DELAYS_MS`, `MAX_MISSES`, `resolveItem`, the `checkCount` logic and the `106`
       branch (which moved to step 10).
   - `SEARCHING`:
     - one `search()` per missing language, with that language's provider codes and the stored hash;
     - the release name compared stays `releaseName(search)` (`103` REQ-8);
     - attempts store `providerSubtitleId = file_id`.
   - Fetch (`startNext`):
     - before each download, if `languageErrors` already holds `quota_exhausted` for any language,
       stop fetching;
     - on a `quota` error, or a successful download with `remaining === 0`, write `quota_exhausted`
       into `languageErrors` for every missing language that has no `ACCEPTED` attempt (and is not
       the one just downloaded, when that one succeeded). Mark that language's unfetched `QUEUED`
       attempts `FAILED` with the same key;
     - the downloaded candidate, if any, is still validated.
   - `unauthorized` (search or download): write `provider_unauthorized` to `languageErrors` for every
     unresolved language and stop.
   - `rate_limited` / `unavailable`: write `provider_unavailable` for **that** language and continue
     with the next one.
   - End of `SEARCHING`:
     - unchanged when something was accepted (go to `EMBEDDING`);
     - when nothing was accepted and every unresolved language carries the same provider-wide key
       (`provider_unauthorized` or `quota_exhausted`), `fail(search, thatKey)` instead of `complete`;
     - otherwise `complete`.
   - `EMBEDDING`: `embedStaged(ref, tracks, search.libraryPath ?? target.filePath)`.
   - Remove `clientOnce`'s media-server requirement. The driver injects `OpenSubtitlesClient` and no
     longer `MediaServerService`/`MediaServerIndexService`.
9. **`derive-languages.ts`.** Before `deriveOne`, a language present in `languageErrors` with no
   `ACCEPTED` attempt reads `FAILED` with that key.
10. **Press-time path (REQ-4).** In `SubtitleSearchRequestService.requestForCaller`, after
   `assertManualSearchPreflight`, when the target has no `filePath`:
   - `createClient()`; `null` throws `no_library_path`;
   - `findByTmdbId`, then `mediaHostPath(externalId, season, episode)`; `null` from either throws
     `no_library_path`;
   - a thrown client error (unreachable) throws `media_server_unavailable`;
   - `hostToContainerPath('library', …)`; `null` throws `error.subtitleEmbed.outside_library`;
   - `assertUsableMkv`;
   - store the path as `libraryPath` on the created row.

   The delivery path (`requestFor`) always has a `filePath`. It drops `FIRST_WAKE_DELAY_MS` and wakes
   at `0`, since there is no media server to wait for any more.
11. **Media-server clients.**
    - Jellyfin: delete `searchRemoteSubtitles`, `fetchRemoteSubtitle` and their types. `mediaHostPath`
      reads the item (or the series' episode map) through the listing it already has.
    - Plex: `mediaHostPath` = `GET /library/metadata/<ratingKey>` (film) or `.../allLeaves` matched by
      `parentIndex`/`index` (episode), then `Media[0].Part[0].file`. `modifiedMedia(hostPath)` runs
      the same section-scoped scan as `createdMedia`.
12. **`SubtitleEmbedService`.**
    - `embedStaged` gains a required `mkvPath` and no longer calls `listingClient`/`resolveMkvPath`. It
      still runs `assertUsableMkv(mkvPath)` and `assertNotBusy`.
    - `notifyJellyfin` becomes `notifyMediaServer`: no client returns `true` (no warning). A client
      without `modifiedMedia` logs and returns `true`. A throw returns `false`. The stored warning key
      stays `jellyfin_refresh_failed`.
13. **Availability.** `subtitleSearchAvailable` = `openSubtitlesApiKey() !== null` and both
    settings `.trim() !== ''`.
    `assertSubtitleSearchAvailable` throws `provider_not_configured`. `setSubtitleSearch(true)` and
    `106`'s press already call it.
14. **Crash recovery** (`reconcileOrphanedEncodes`, beside `103`'s attempt sweep):
    - a `WAITING` search with `probeCount >= 2` fails with `interrupted`;
    - a `WAITING` search with `probeCount === 1` gets `removeProbe` then `addProbe`.

    `probeCount === 0` is a probe never started. Its queue entry is still there, so leave it.
15. **Provenance (spec 0.4.0, REQ-14).**
    - Schema: `SubtitleSearchAttempt.providerFileName String? @db.VarChar(500)`, in a **new** migration
      `<timestamp>_107_subtitle_provenance` (a single nullable `ADD COLUMN`). Never edit
      `107_opensubtitles_direct`: it is already applied on the development database.
    - `OpenSubtitlesClient.search` maps `files[0].file_name` onto a new optional `fileName` on
      `SubtitleCandidate`. `filterAndRank` ignores it (the comparator and `releaseSimilarity` stay
      byte-identical: ranking still reads `release`).
    - The driver writes `providerFileName` when it creates the attempt row.
    - `StoredTrack` (the `SubtitleEmbed.tracks` Json) gains `provenance: string`:
      - `embedStaged` sets it from the attempt: `providerFileName`, else `opensubtitles:<providerSubtitleId>`.
        The driver passes it in the staged track it already builds (`languageIso3`, `stagedPath`,
        `offsetMs`, now `provenance`);
      - `101`'s sidecar path (`queueEmbed` from the administrator's mutations) sets the literal `user`.
    - `SubtitleEmbedTrack` entity gains `provenance: String!` with the SDL description in `spec.md`.
      `details()` serves a stored track that lacks it as `user` when `isSidecar !== false`, else
      `opensubtitles`.
    - `api` does not sanitize the value; the worker does (REQ-14), since it is the one writing the
      tags file.

## Contract obligations

Expose exactly `../spec.md` § GraphQL Contract Delta:

- `SubtitleProbeDetails { id, filePath }`;
- `subtitleProbeDetails`;
- `subtitleProbeStarted`, `subtitleProbeCompleted(id, embeddedLanguagesIso3, sidecarLanguageTags,
  fileSizeBytes: Float!, movieHash)`, `subtitleProbeFailed`;
- `subtitleSearchAvailable` with its new meaning.

All four probe operations are service-only.

Throw:

| Where | Key |
| :-- | :-- |
| `setSubtitleSearch(true)` / a press, not configured | `provider_not_configured` (`badRequest`) |
| a press, no media server holds the title | `no_library_path` (`badRequest`) |
| a press, media server unreachable | `media_server_unavailable` (`badRequest`) |
| `subtitleProbeDetails` for an unknown or non-`WAITING` id | `probe_not_found` (`notFound`) |

The queue payload `SubtitleProbeJob { subtitleSearchId }` in `queue/types.ts` must match the worker's
copy exactly.

## Tests

Article IX: each case is verified to fail when its rule is removed.

- `subtitle-search/candidates.spec.ts`:
  - a two-file result ranked first is dropped;
  - a foreign-parts-only, machine- or AI-translated result is dropped;
  - a hash match outranks a higher similarity and download count;
  - the existing ranking cases keep passing unchanged.
- `subtitle-search/sidecar-languages.spec.ts`:
  - `es` → `spa`, `es-419` → `spa`, `pt-BR` → `por`, `fra` → `fre`;
  - `Spanish` and `castellano` → nothing;
  - an empty tag list → empty.
- `subtitle-search/provider-languages.spec.ts`: `por` expands to both Portuguese variants, `chi` to
  both Chinese ones; `spa` → `es`.
- `clients/opensubtitles/client.spec.ts` (`fetch` stubbed):
  - one re-login after a `401`, and a second `401` throws `unauthorized` with exactly two login calls;
  - a `429` waits at most 10 s and retries once;
  - a `406` on download is `quota`;
  - the token is reused across calls and missed after a credential change;
  - no thrown error's message contains the password or the API key (AC-8).
- `clients/opensubtitles/key.spec.ts` (a real `mkdtemp` file, the `media-roots.service.spec.ts`
  posture, the path injected for the test):
  - the environment variable wins over the file;
  - an empty or whitespace-only variable falls through to the file;
  - the file's trailing newline is trimmed;
  - no variable and no file → `null`, without throwing.
- `subtitle-search/subtitle-search.driver.spec.ts` (extend):
  - `WAITING` queues a probe and calls no OpenSubtitles method;
  - a `remaining: 0` download stops further downloads in the same search, and the accepted language is
    still embedded;
  - `unauthorized` fails every unresolved language and the search ends `FAILED`;
  - `embedStaged` receives `libraryPath`;
  - no media-server client is constructed anywhere in the driver.
- `subtitle-search/subtitle-search.service.spec.ts` (extend):
  - `probeStarted` refuses a third start;
  - `probeCompleted` writes the union of embedded and resolved sidecar languages, and is idempotent.
- `subtitle-search/derive-languages.spec.ts` (extend): a `languageErrors` entry reads `FAILED` with its
  key where it would have read `NOT_FOUND`.
- `subtitle-search/subtitle-search-flags.spec.ts` (rewrite): availability follows the key and the two
  settings, each one removed in turn, and ignores `media_server_client`.
- `settings/` (extend whichever spec covers the catalog): `updateSettings` with an
  `opensubtitles_api_key` entry is refused with `error.setting.not_editable`, so the key can never be
  written into the database by mistake.
- `subtitle-search/subtitle-search-request.service.spec.ts` (extend):
  - no-`filePath` + no client → `no_library_path` and no row;
  - Plex `mediaHostPath` → the row carries `libraryPath`;
  - an unreachable server → `media_server_unavailable`.
- `process-jobs/process-jobs.service.spec.ts` (extend): `probeCount` 1 → re-queued with remove before
  add; `probeCount` 2 → `FAILED interrupted`.
- `subtitle-embed/subtitle-embed.service.spec.ts` (extend): no client → `completed` stores no
  warning.
- `clients/media-server/plex.spec.ts` (extend): `mediaHostPath` picks the episode by
  `parentIndex`/`index`, and `null` when absent.
- The migration's data steps are not unit-tested. They are verified live by AC-14.
- Provenance (0.4.0):
  - `clients/opensubtitles/client.spec.ts`: a search row's `files[0].file_name` comes back as the
    candidate's `fileName`;
  - `subtitle-search.driver.spec.ts`: the attempt row stores `providerFileName`, and the staged track
    handed to `embedStaged` carries `provenance` = that name, or `opensubtitles:<id>` when it is null;
  - `subtitle-embed.service.spec.ts`: a hand (sidecar) embed stores `provenance: 'user'`; `details()`
    serves `user`/`opensubtitles` for a stored track without the field.

## Done when

```bash
bin/cli api npx --no tsc --noEmit        # 0 errors
bin/npm api test                         # green, new cases included
bin/npm api run lint
bin/cli api npx prisma migrate status    # up to date
bin/comments api
git diff services/api/src/schema.gql     # exactly the spec delta, now including SubtitleEmbedTrack.provenance
grep -rn "searchRemoteSubtitles\|fetchRemoteSubtitle\|RemoteSubtitleCandidate" services/api/src --include=*.ts   # empty
grep -rn "checkCount\|itemId" services/api/src/subtitle-search --include=*.ts             # empty
```
