---
title: OpenSubtitles Direct — Implementation Plan
spec_version: 0.4.0
last_updated: 2026-10-27
status: Approved
---

# PLAN: OpenSubtitles Direct (`plan.md`)

## Approach

The feature replaces the **source** of `103`'s search without changing its shape. Every
`SubtitleSearch` row still runs through `SubtitleSearchDriver.advance`
(`services/api/src/subtitle-search/subtitle-search.driver.ts`) and its four non-terminal states.
What changes is what each state talks to:

| State | `103`/`106` today | After `107` |
| :-- | :-- | :-- |
| `WAITING` | polls Jellyfin for the item, up to 5 misses (`MISS_DELAYS_MS`, `checkCount`) | queues one `subtitle-probe` job and waits for the worker's report |
| `SEARCHING` | `client.searchRemoteSubtitles(itemId, iso3)` | `OpenSubtitlesClient.search(...)` by TMDB id + hash |
| `SEARCHING` → `VALIDATING` | `client.fetchRemoteSubtitle(id)` | `OpenSubtitlesClient.download(fileId)` |
| `VALIDATING`, `EMBEDDING` | unchanged | unchanged, except `embedStaged` takes the search's own path |

What is **reused**, not rewritten:

- `candidates.ts`'s `filterAndRank` and `releaseSimilarity`: the ranking is `103` REQ-8 verbatim. Only
  the input type moves from `RemoteSubtitleCandidate` (a media-server type) to a provider-neutral
  candidate declared beside the ranking, and the filter swaps "format is srt" for "lists exactly one
  file" and "not foreign-parts-only".
- `staging.ts` (`SubtitleSearchStaging.write`): the downloaded bytes land exactly where `103` puts
  them.
- `acceptance.ts`, `last-cue.ts`, the `subtitle-sync` job and its four reports: untouched.
- `SubtitleEmbedService.embedStaged`, `assertUsableMkv`, `assertNotBusy`: reused as they are, with
  one addition (an explicit library path, below).
- `SubtitleSyncQueueService` (`services/api/src/queue/subtitle-sync-queue.service.ts`) is the
  template for the new `SubtitleProbeQueueService`; the worker's `subtitle-sync.job.ts` and
  `api/subtitle-sync-reports.ts` are the template for the probe job and its reports.
- `process-jobs/`'s `reconcileOrphanedEncodes` is where `103` already fails interrupted validations on
  the worker's boot; the probe's retry-once rule goes in the same place.
- The `Language` table (`tag`, `iso2`, `iso3`) is the one mapping between ISO 639-1, 639-2 and BCP-47
  tags. `api` resolves a sidecar's tag against it, and maps a wanted ISO 639-2 code to the code
  OpenSubtitles expects through it too. The worker gets no ISO table.
- `TmdbClient` (`services/api/src/clients/tmdb/client.ts`) and `TmdbHttpError` are the pattern for
  the new `clients/opensubtitles/` adapter: an `@Injectable` class that reads the account from
  `SettingsService` per call and throws a typed error carrying the HTTP status. The application key
  is not a Setting: it comes from `OpenSubtitlesKey` (REQ-13), resolved once at boot.
- `TORRENT_API_KEY` (`104`) is the precedent for a credential `api` reads straight from its
  environment, never through Settings. `OPENSUBTITLES_API_KEY` follows it in development; the
  release image adds the baked file as a second source.
- `RedisService` holds the login token, the way `040`'s indexer cache and `033`'s popular lists
  already use it.

Three places change shape rather than source:

1. **Library path for a title with no `filePath` moves to press time.** `106` resolves it inside the
   driver's `WAITING` step, through Jellyfin's `listItemSubtitles`. `107` REQ-4 refuses the press when
   no media server holds the title, which can only happen at press time, so
   `SubtitleSearchRequestService.requestForCaller` resolves it before creating the row and stores it
   in `SubtitleSearch.libraryPath`. The resolution goes through a new optional
   `MediaServerClient.mediaHostPath(externalId, season?, episode?)`, implemented by Jellyfin (from the
   listing it already reads) and Plex (`Media[0].Part[0].file`). The driver never talks to a media
   server again.
2. **`embedStaged` takes the path.** Today it re-resolves a no-`filePath` title's `.mkv` through a
   Jellyfin-only listing client, which would fail on Plex. The driver passes
   `search.libraryPath ?? filePath`, and `embedStaged` only re-checks it (`assertUsableMkv`).
3. **The after-embed notification becomes media-server-neutral.** `notifyJellyfin` becomes a
   notification through whatever `createClient()` returns. Plex gains `modifiedMedia`, the same
   path-scoped scan `createdMedia` already runs. No client means nothing to notify and **no** warning
   (REQ-10), which is a behaviour change: today a missing client records `jellyfin_refresh_failed`.

**Alternative rejected: keep the media-server probe and only swap the provider.** It would keep
Jellyfin as a hard requirement for knowing what the file already carries, which is the coupling the
spec exists to remove (NFR-3). The worker already mounts the library and already runs `ffprobe` on
it for `subtitle-sync`, so the probe costs one small job.

**Alternative rejected: a provider seam (interface + one implementation).** The spec's Out of Scope
says one provider, one code path (Article X). The driver calls `OpenSubtitlesClient` directly.

## Order of Work

| Step | Service | Why it must come here |
| :-- | :-- | :-- |
| 1 | `api` | Owns the migration, the queue payload type, the four service-only probe operations and the new keys. Nothing else can be exercised before them. |
| 2 | `worker` | Consumes `subtitle-probe` and calls the four operations. Can start once step 1's queue type and SDL exist. |
| 3 | `web` | Settings block, `/preferences` hint and copy only. No new GraphQL field to read. |
| 4 | `infra` | Build secret in `services/api/Dockerfile`, `release.yml`, `docker-compose.dev.yaml`, `docker-compose.build.yaml`, `.env.example`. Independent of the GraphQL contract; depends only on the key file path frozen below. |
| 1b | `api` (0.4.0) | `providerFileName` column (second migration), `SubtitleEmbedTrack.provenance`, stored on every embed track. |
| 2b | `worker` (0.4.0) | Tags XML + `--tags` in `101`'s embed job. Optional field, so it can land before or after 1b without breaking an embed. |
| 5 | `[docs]` | `docs/spec/graphql-contract.md` gains a `107` section; root and `api`/`worker` `CLAUDE.md` pipeline rows, plus an `OPENSUBTITLES_API_KEY` bullet in the root `CLAUDE.md` § Environment (dev `.env`, release secret, never a Setting, the rotation path); `docs/spec/history.md` entry. |

**Parallel:** `worker`, `web` and `infra` can run at the same time as `api`. The contract below is frozen and
neither reads anything `api` will improvise. `api` must still land first in the merge order, because
a worker that calls `subtitleProbeStarted` against an `api` without it gets a GraphQL validation
error. The worker would log it and report nothing, and the search would sit in `WAITING` until the
probe backstop.

## Contract Freeze

`spec.md` § GraphQL Contract Delta is frozen as of `status: Approved` (0.4.0). Things an implementer
will want to change and must not:

- **`SubtitleEmbedTrack.provenance` is the final tag value, not a structure** (0.4.0). `api` sends
  the file name or `user`; the worker sanitizes and writes it. Do not split it into a provider and a
  name, and do not add an offset field: `PERCEPTOR_OFFSET` is the existing `offsetMs`.

- **`fileSizeBytes: Float!`, not `Int`/`BigInt`.** GraphQL's `Int` is 32-bit and a film exceeds it.
  There is no `BigInt` scalar in this schema, and adding one for one field is a new contract
  vocabulary. `api` stores it as Prisma `BigInt`.
- **`movieHash` is reported by the worker, not computed by `api`.** `api`'s container mounts the
  library read-only and could hash it, but the probe already opens the file. Two readers of one file
  would be two answers to keep in agreement.
- **`sidecarLanguageTags` is raw.** The worker must not drop or normalize a tag it does not recognize.
  `Spanish` is reported as `Spanish`, and `api` decides it is not a language. A worker that "helpfully"
  maps `es` → `spa` would make the two resolve differently the day the `Language` table gains a row.
- **`subtitleProbeStarted` → `false` means abandon, with no report.** Do not turn it into an error
  or a `subtitleProbeFailed`. It is how a third run after two interruptions, or a superseded search,
  stops quietly.
- **`subtitleSearchAvailable` keeps its name.** Its meaning changes (REQ-2). Renaming it to something
  OpenSubtitles-specific would break `web`'s read with no compile error.
- **`SubtitleSearchStatus` keeps six values.** No `PROBING` value (REQ-12).
- **The retired keys stay in `error-keys.ts` and in `web`'s catalogs.** Searches stored before this
  feature still render them.
- **The application key's two sources, frozen between `api` and `infra`:**
  - the environment variable is named `OPENSUBTITLES_API_KEY`, the same as the GitHub Actions
    secret;
  - the image file is `/app/secrets/opensubtitles_api_key`, holding the key and nothing else (a
    trailing newline is tolerated, `api` trims);
  - the BuildKit secret id is `opensubtitles_api_key`.

  It is mode `0444`, because `docker-compose.yaml` runs `api` as `${PUID}:${PGID}`, not as the
  image's `nestjs` user: a `0400` file owned by `nestjs` would be unreadable at runtime, the key
  would silently not resolve, and the search would read "not configured" on every installation.
  Do not "harden" the mode.
- **`docker-compose.yaml` does not pass `OPENSUBTITLES_API_KEY` to `api`.** Only the dev overlay does.
  An end-user `.env` has no such line; passing `${OPENSUBTITLES_API_KEY:-}` there would only add a
  way to shadow the baked key. `api` still treats an empty variable as absent, as a second guard.

If any of these has to change mid-flight: stop, amend `spec.md`, re-approve, and re-brief every
service in `services:` (Article VIII).

## Migrations

**0.4.0 adds a second migration**, `<timestamp>_107_subtitle_provenance`: one nullable
`ADD COLUMN providerFileName VARCHAR(500)` on `subtitle_search_attempts`, no data step. Attempts
created before it stay `NULL`, and REQ-14 falls back to `opensubtitles:<id>` for them. It is a
separate migration because `107_opensubtitles_direct` is already applied on the development database;
editing it would make `prisma migrate` report a checksum mismatch there.


One migration, `api`-owned, named `<timestamp>_107_opensubtitles_direct`:

1. `subtitle_searches`: add `movieHash VARCHAR(16) NULL`, `fileSizeBytes BIGINT NULL`,
   `probeCount INT NOT NULL DEFAULT 0`, `languageErrors JSON NULL`.
2. **Data, before the drops** (plain SQL in the same migration, ordered so the `WAITING` rows are
   still identifiable):
   - `UPDATE subtitle_searches SET status='FAILED', errorKey='error.subtitleSearch.superseded',
     finishedAt=NOW() WHERE status IN ('WAITING','SEARCHING')`.
   - `UPDATE subtitle_search_attempts a JOIN subtitle_searches s ON s.id=a.searchId SET
     a.status='FAILED', a.reasonKey='error.subtitleSearch.superseded', a.finishedAt=NOW() WHERE
     s.status='VALIDATING' AND a.status='QUEUED' AND a.stagedPath IS NULL`. These are attempts whose
     id is a Jellyfin id and that `OpenSubtitlesClient` must never receive.
   - `EMBEDDING` rows: untouched.
3. Drop `subtitle_searches.itemId` and `subtitle_searches.checkCount`.

Staged files of the searches failed in step 2 are not deleted by SQL. The driver's boot `recover()`
already runs `staging.sweep(keepsStaging)`, which removes the staging of every terminal search with
no active embed. That is the existing mechanism, and it runs on the first boot after the migration.

`Setting` rows: `opensubtitles_username`, `opensubtitles_password` seeded `""` through `prisma/seeds/settings.ts` (create-only, as every other row). No SQL.

**Reversibility:** the column drops are not reversible: `itemId`/`checkCount` are Jellyfin-wait state
with no meaning after this feature. Rolling the code back after the migration leaves `103`'s driver
reading a column that no longer exists. A rollback means restoring the `backup` service's pre-migration
dump (`049`), the same as any destructive migration in this repository.

## Risks

- **0.4.0: a file name that breaks the tags file, silently or not.** OpenSubtitles' `file_name` is
  uploader-controlled. An unescaped `&` or `<` makes `mkvmerge` reject the XML and fail the embed
  (visible); a stray newline would split a tag value (invisible). The worker sanitizes and escapes
  (`embed-tags.ts`, tested), and `api` never trusts the value for anything else.
- **0.4.0: older stored embeds.** An embed queued before the upgrade has no `provenance` in its Json;
  `details()` fills `user`/`opensubtitles` so the contract's `String!` holds.

| Risk | How it fails | Mitigation |
| :-- | :-- | :-- |
| A multi-file result reaches `download` | One of ~20 daily downloads spent on a subtitle that can never pass, with nothing anywhere saying why. This is the bug the spec exists for. | `candidates.spec.ts` fault-injection case: a two-file result ranked first is absent from the output. AC-3 live. |
| The probe job id is deduplicated | `api` re-queues a probe after an interruption with the same `jobId` BullMQ still holds as failed/active. The add is a silent no-op, and the search sits in `WAITING` until the backstop. | `removeProbe` before `addProbe` on every re-queue, the ordering `054` established for encodes. Covered in `subtitle-probe-queue.service.spec.ts`. |
| The token is reused across a credential change | An administrator fixes a wrong password. `api` keeps the old token until expiry, or worse, a valid token for the *old* username keeps working against another account's quota. | The Redis key embeds a SHA-256 of `apiKey + username + password`. A changed credential, or a rotated application key, misses the cache. The password itself is never written to Redis. |
| The key file is unreadable at runtime | `api` runs as `${PUID}:${PGID}`. A file readable only by `nestjs` makes the key resolve to nothing on every real installation, and the search reads "not configured" with nothing pointing at the image. | Mode `0444` (Contract Freeze). AC-16 checks the file from the published image; the boot warning (REQ-13) names the missing key. |
| A release ships without the key | The secret is deleted or renamed. The build still succeeds (`required=false` is needed for forks), and every installation on that tag loses the search. | A step in `release.yml`'s `api` leg fails the build when the secret is empty and the repository is `dientuki/perceptor` (NFR-6). `merge` needs `build`, so no tag moves. |
| The key leaks into image metadata | Passed as `ARG`/`build-args`, it shows in `docker history`; as `ENV`, in `docker inspect`. That is no worse than the file, but it is what NFR-6 rules out. | BuildKit secret mount only. AC-16 greps `inspect` and `history`. |
| OpenSubtitles revokes the application key | Every installation's searches start failing at once. If OpenSubtitles answers a revoked key with `401`, the panel blames the administrator's username or password, which they cannot fix. | The client logs the endpoint and status of the first refusal, so a maintainer can tell a `/login` refusal (account) from one on an authenticated call. The fix is the documented rotation (new key, secret, release). Not mitigated further: there is no way to detect a revoked key ahead of a call. |
| The secret reaches every service's build | `release.yml`'s matrix passes `secrets:` to all five legs; a future Dockerfile mounting it by accident ships the key in `web`. | The `secrets:` input is set only on the `api` leg (a matrix-conditional expression). |
| A secret reaches a log line | `api`'s `Logger.warn(String(error))` prints an error whose message embeds a request body or header. | The client's errors carry status and endpoint path only, never body or headers. A client spec asserts a thrown error's message contains neither secret (AC-8). |
| Quota spent after the stop | The driver fetches the next candidate of the *next* language after a `remaining: 0` answer, because the stop was recorded on the attempt, not the search. | Quota exhaustion is search-wide: written to `languageErrors` for every unresolved language and checked before every download. Covered in `subtitle-search.driver.spec.ts`. |
| No-client notify still records a warning | With `media_server_client = none`, every successful embed shows "no se pudo avisar a Jellyfin", which is wrong copy for a correct outcome (REQ-10). | `notifyMediaServer` returns success when `createClient()` returns `null`. Spec case. |
| Sidecar of a *different* file counted | `Movie (2010).es.srt` beside `Movie (2010) - 4K.mkv` would be read as the 4K file's Spanish track. A wanted language is skipped and never searched, with no error. | Match on the exact base name plus `.`, case-sensitive as the filesystem is. `sidecars.spec.ts` covers the prefix-collision case. |
| `embedStaged` re-resolves through Jellyfin | On Plex, a no-`filePath` title's accepted candidates are fetched, validated and then fail at embed with `unsupported_media_server`, after the quota is spent. | The driver passes the stored path. A driver spec asserts `embedStaged` receives `libraryPath`. AC-13 live. |
| Rate-limit retry blocks the driver | A `Retry-After: 3600` would park the BullMQ consumer for an hour. | Bounded to 10 s (REQ-9). Anything longer counts as the second refusal. |
| `remaining` is absent from a download answer | The client reads `undefined` as zero, or as "unlimited". | Absent means unknown and does not stop. Only a numeric `0` or the documented quota refusal stops. |

## Verification

```bash
bin/cli api npx --no tsc --noEmit
bin/npm api test
bin/cli worker npx --no tsc --noEmit
bin/npm worker test
bin/cli web npx --no tsc --noEmit
bin/npm web run lint
bin/comments
bin/cli api npx prisma migrate status
docker compose -f docker-compose.yaml -f docker-compose.build.yaml config >/dev/null
bin/build prod api
git diff services/api/src/schema.gql
```

`schema.gql`'s diff must show exactly the spec's delta:

- `SubtitleProbeDetails`;
- `subtitleProbeDetails`;
- the three probe mutations;
- the new descriptions on `subtitleSearchAvailable`;

and nothing else. It must not show `searchRemoteSubtitles`, which was never in GraphQL; that removal
is in the Jellyfin client only.

Manual pass (AC numbers from `spec.md`):

1. `OPENSUBTITLES_API_KEY` in `.env`. Settings → General, OpenSubtitles block: fill the username
   and password of a real opensubtitles.com account. `mediaCapabilities { subtitleSearchAvailable }`
   reads `true` with `media_server_client = none` (AC-1). Empty the username → `false` (AC-7).
2. Media server `none`: deliver a film with English only, owner wants `spa`. Watch `subtitle_searches`
   go `WAITING` → `SEARCHING` → `VALIDATING` → `EMBEDDING` → `COMPLETED`. Then
   `bin/cli worker mkvmerge -J <file>` lists Spanish (AC-1).
3. Same with Jellyfin: the Spanish track shows in Jellyfin with no manual scan (AC-2).
4. A film whose top Spanish result is a 2-CD upload (look one up on opensubtitles.com first): no
   attempt row for it, and the account's `remaining` drops only by the attempt count (AC-3).
5. Put `<base>.es.srt` beside a library file: Spanish reads `ALREADY_PRESENT`. The `api` log shows
   no OpenSubtitles call for `spa` (AC-4).
6. Wrong password → AC-5. An account at zero → AC-6. Grep the `api` log for the password and key
   → AC-8.
7. Compression off, a release OpenSubtitles knows by hash → the accepted attempt has `rank = 1`
   (AC-9).
8. Jellyfin, a title with an external `.srt`: "Incrustar en archivo" still works (AC-10).
9. `docker compose kill worker` mid-probe twice → AC-11. `ls -la --time-style=full-iso` of the
   library folder before and after a search that embeds nothing → AC-12.
10. Plex: `106`'s button on a Plex-only film → AC-13. Media server `none` → the refusal copy.
11. Before migrating: leave one search `WAITING` (Jellyfin stopped) and one `EMBEDDING`, then
    migrate → AC-14.
12. Remove `OPENSUBTITLES_API_KEY` from `.env`, `bin/build prod api`, run it: boot warning,
    `subtitleSearchAvailable: false` (AC-17). With the key back, the same build has
    `/app/secrets/opensubtitles_api_key`, and `docker history --no-trunc` / `docker inspect` of it
    do not contain the key.
13. After the first release candidate that carries 107: AC-16 against the published tag.
14. (0.4.0) After a search embeds a track: `mkvinfo <file>` (or MediaInfo) shows `PERCEPTOR_SOURCE`
    = the OpenSubtitles file name and `PERCEPTOR_OFFSET` = the attempt's `offsetMs` on the new track
    only. After a hand embed of a Jellyfin sidecar: `PERCEPTOR_SOURCE: user` (AC-18).
