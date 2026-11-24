# Security draft specs

Draft specs for the nine leads from the first `security-audit` pass over `services/api`
(Cloudflare `security-audit` skill, profile `quick`, 2026-11-20, commit `98f8779`).

Every lead is **`needs_validation`**: the audit read the code and never executed it (no OS sandbox was
available), so none is confirmed and none carries a severity. Each draft records the code path, what
"fixed" means and an acceptance criterion that reproduces the bug first. Before implementing one,
validate it, answer its `[NEEDS CLARIFICATION]` items and promote it through `/specify` into
`docs/spec/features/NNN-slug/`.

Line numbers refer to `98f8779` and will drift.

| # | Draft | Lead | Depends on / shares fix with |
| :-- | :-- | :-- | :-- |
| 01 | [Worker callbacks service-only](01-worker-callbacks-service-only.md) | Any user can call `downloadRemove`, `encodeCompleted`, `sourceScanned`, … | — |
| 02 | [infoHash format validation](02-infohash-format-validation.md) | `infoHash: "all"` makes `downloadDelete` delete every torrent | — |
| 03 | [Scan path confinement](03-scan-path-confinement.md) | `sourceScanned` + `encodeJobDiscard` delete any file in the downloads root | reachable through 01 |
| 04 | [Subtitle archive entry cap](04-subtitle-archive-entry-cap.md) | Forged zip64 count hangs/OOMs the api, boot recovery replays it | — |
| 05 | [resolveInfoHash SSRF](05-resolve-infohash-ssrf.md) | Unrestricted fetch of user URLs, unbounded body | 02 (same producer) |
| 06 | [Remove user revokes sessions](06-remove-user-revokes-sessions.md) | A deleted user's token keeps working | 07, 09 |
| 07 | [Password change revokes sessions](07-password-change-revokes-sessions.md) | Password change/reset leaves sessions live | 06 |
| 08 | [Upload finish re-authorization](08-upload-finish-reauthorization.md) | A de-owned/disabled user can finish a forced replacement | — |
| 09 | [Login/disable race](09-login-disable-race.md) | A login racing a disable leaves a live session | closed by 06 REQ-2 |

## Second audit pass (run-2)

Seventeen more leads from the `standard`-profile pass over `api`, `web`, `worker` and the compose
stack (2026-11-22, same commit). Each was reviewed by two independent verifiers and kept as
**`needs_validation`**: nothing was executed, so none is confirmed and none carries a severity.
The evidence is in `~/security-audit-skill/perceptor/run-2/`. The nine run-1 leads were not re-verified in this pass.

| # | Draft | Lead | Shares fix with |
| :-- | :-- | :-- | :-- |
| 10 | [Savepath derived from urls0](10-savepath-derived-from-urls0.md) | A user can aim a source's download folder at another user's and delete it | 02, 05 |
| 11 | [Torrent urls validation](11-torrent-urls-validation.md) | `urls[]`/magnets reach qBittorrent unvalidated (newline split) | 02 |
| 12 | [Login throttle and bcrypt bound](12-login-throttle-and-bcrypt-bound.md) | No login throttle; unbounded bcrypt cost; alias amplification | — |
| 13 | [Login timing enumeration](13-login-timing-enumeration.md) | Unknown usernames answer faster than known ones | 12 |
| 14 | [Indexer proto key search](14-indexer-proto-key-search.md) | A `__proto__` infoHash breaks the search | — |
| 15 | [Prowlarr downloadurl apikey](15-prowlarr-downloadurl-apikey.md) | Prowlarr `downloadUrl` carries its API key to every user | — |
| 16 | [Refresh rebuild throttle](16-refresh-rebuild-throttle.md) | Any user's Refresh triggers a whole-library media-server rebuild | — |
| 17 | [Manual subtitle search quota](17-manual-subtitle-search-quota.md) | Manual subtitle search is unbounded against a shared daily quota | — |
| 18 | [Rar dictionary memory cap](18-rar-dictionary-memory-cap.md) | RAR dictionary memory amplification; unbounded Subdivx body | 04 |
| 19 | [Tus size cap and expiry](19-tus-size-cap-and-expiry.md) | tus uploads have no size cap and never expire | 08 |
| 20 | [Update profile current password](20-update-profile-current-password.md) | `updateProfile` changes the password without the current one | 07 |
| 21 | [Build overlay redis db exposure](21-build-overlay-redis-db-exposure.md) | Source-build overlay publishes Redis and MariaDB with default credentials | 26 |
| 22 | [Login redirect same origin](22-login-redirect-same-origin.md) | Post-login redirect accepts protocol-relative URLs | — |
| 23 | [Worker mpls read bound](23-worker-mpls-read-bound.md) | Worker reads a `.mpls` of any size into memory | 03 |
| 24 | [Subtitle text regex bound](24-subtitle-text-regex-bound.md) | Quadratic regex on subtitle track text | — |
| 25 | [Ffmpeg protocol whitelist](25-ffmpeg-protocol-whitelist.md) | ffmpeg/ffprobe open torrent-supplied media with no protocol whitelist | 03 |
| 26 | [Worker redis control plane](26-worker-redis-control-plane.md) | Worker trusts unauthenticated Redis cancel messages and stored verdicts | 21 |

## Third audit pass (run-3)

Thirty-three more drafts from the `deep`-profile pass over `api`, `web`, `worker`, the compose stack,
`install.sh` and the release workflows (2026-11-23, commit `2a3976a`, source unchanged since `7365e13`).
This pass had an OS-enforced sandbox (bubblewrap), so findings could be reproduced locally: a finding
is **confirmed** only when a fresh verifier reproduced it in a sandboxed harness (real service code,
in-memory fakes for Prisma, Redis and fetch) and a second fresh verifier re-checked the record. Only
confirmed drafts carry a severity; nothing is high or critical. The evidence is in
`~/security-audit-skill/perceptor/run-3/` (`REPORT.md`, `findings.json`, per-verifier artifacts).

| # | Draft | Finding | Verdict | Shares fix with |
| :-- | :-- | :-- | :-- | :-- |
| 27 | [Seed admin username promotion](27-seed-admin-username-promotion.md) | Boot seed re-promotes whichever user holds ADMIN_USER's username to administrator, and any use… | confirmed (medium) | 06, 20 |
| 28 | [Downloads read writeback ready](28-downloads-read-writeback-ready.md) | A read-only downloads query promotes a completed torrent to READY and the completion hook then… | confirmed (medium) | 29 |
| 29 | [Torrent completed verify completion](29-torrent-completed-verify-completion.md) | torrentCompleted trusts its caller: any user can mark another user's in-progress torrent finis… | confirmed (medium) | 01, 02, 28 |
| 30 | [Acquire movies fair run cap](30-acquire-movies-fair-run-cap.md) | One user's unfindable auto-acquire films fill the daily 20-film cap and starve every other use… | confirmed (low) | — |
| 31 | [Season upload finish replacement guard](31-season-upload-finish-replacement-guard.md) | finishSeasonUpload supersedes a season's sources without re-checking the replacement guard che… | confirmed (low) | 08, 19 |
| 32 | [Season upload same name overwrite](32-season-upload-same-name-overwrite.md) | Concurrent same-name uploads into one season session silently overwrite each other | confirmed (low) | 08, 19, 31 |
| 33 | [Remove user unwind orphans](33-remove-user-unwind-orphans.md) | Removing a user cascades only the ownership links and leaves the user's titles, in-flight torr… | confirmed (low) | 06, 53 |
| 34 | [Install env file permissions](34-install-env-file-permissions.md) | install.sh creates .env (JWT_SECRET, DB passwords, SERVICE_TOKEN) with umask-default permissio… | confirmed (low) | 21, 35, 54 |
| 35 | [Install indexer apikey validation](35-install-indexer-apikey-validation.md) | INDEXER_API_KEY adopted from the indexer volume is written to .env unvalidated and then execut… | confirmed (low) | 34 |
| 36 | [Audio variant similarity bound](36-audio-variant-similarity-bound.md) | Pairwise similarity() on two Spanish subtitle tracks is superlinear in word count | confirmed (low) | 24, 37, 38 |
| 37 | [Imperative id marker regex](37-imperative-id-marker-regex.md) | Spanish IMPERATIVE_ID marker regex rescans across lines, quadratic on punctuation-only cues | confirmed (low) | 24, 36, 38 |
| 38 | [Subtitle variant tag regex](38-subtitle-variant-tag-regex.md) | Quadratic tag-stripping regex in subtitle variant check stalls the worker event loop on a craf… | confirmed (low) | 04, 18, 24, 37 |
| 39 | [Opensubtitles session baseurl pin](39-opensubtitles-session-baseurl-pin.md) | OpenSubtitles session cache in unauthenticated Redis can redirect the app Api-Key and user tok… | needs_validation | 21, 26 |
| 40 | [Magnet multiple btih](40-magnet-multiple-btih.md) | Magnet with several xt btih values is stored under the first hash while the raw magnet is forw… | needs_validation | 02, 10, 11 |
| 41 | [Ffprobe log recording bounds](41-ffprobe-log-recording-bounds.md) | Any logged-in user can append unbounded 2 MB rows to the never-pruned ffprobe_logs table | needs_validation | 01 |
| 42 | [Indexer search cache bound](42-indexer-search-cache-bound.md) | Any user can fill the 256 MB noeviction Redis with unique-query search cache entries, breaking… | needs_validation | 12, 21, 26 |
| 43 | [Media roots host paths](43-media-roots-host-paths.md) | mediaRoots query returns host filesystem paths (HOST_DOWNLOADS_DIR / HOST_DESTINATIONS_DIR) to… | needs_validation | — |
| 44 | [Media server provider id overflow](44-media-server-provider-id-overflow.md) | One out-of-range media-server provider id aborts the whole index rebuild | needs_validation | 16 |
| 45 | [Source scanned state guard](45-source-scanned-state-guard.md) | sourceScanned has no READY/not-retired guard, so a superseded, failed or retired source can be… | needs_validation | 01, 03 |
| 46 | [Encode report state transitions](46-encode-report-state-transitions.md) | Encode report mutations have no state-transition guard, so a stale or replayed report regresse… | needs_validation | 01, 45, 47 |
| 47 | [Encode completed output path](47-encode-completed-output-path.md) | encodeCompleted persists any outputFilePath as the title's file; library probe and media-serve… | needs_validation | 01, 25, 46 |
| 48 | [Source ready job dedupe](48-source-ready-job-dedupe.md) | Finished media-source-<id> queue job is never removed, so a second scan enqueue for the same M… | needs_validation | 28, 29, 45 |
| 49 | [Subtitle zip inflate bound](49-subtitle-zip-inflate-bound.md) | Subdivx zip with a forged originalSize blocks the api event loop during a full-size inflate | needs_validation | 04, 18 |
| 50 | [Subtitle sync duplicate delivery](50-subtitle-sync-duplicate-delivery.md) | Overlapping duplicate subtitleSyncCompleted delivery can rescale the staged subtitle twice | needs_validation | 45, 46 |
| 51 | [Rescale srt regex bound](51-rescale-srt-regex-bound.md) | rescaleSrt quadratic regex on provider subtitle text blocks the api event loop | needs_validation | 17, 18, 24 |
| 52 | [Tmdb list name length](52-tmdb-list-name-length.md) | An over-long TMDB list name aborts the whole scheduled list import for every user | needs_validation | 53 |
| 53 | [Disable user auto acquire](53-disable-user-auto-acquire.md) | Disabling a user revokes sessions only; their auto-acquire opt-ins keep driving the daily acqu… | needs_validation | 06, 09, 52 |
| 54 | [Backup dump permissions](54-backup-dump-permissions.md) | DB backup dumps in ./backups are likely world-readable and contain plaintext settings secrets | needs_validation | 21 |
| 55 | [Release tag expression injection](55-release-tag-expression-injection.md) | Release merge step interpolates the tag name into a shell script through a step output | needs_validation | — |
| 56 | [Opensubtitles key in image](56-opensubtitles-key-in-image.md) | OpenSubtitles application key is written into a layer of the publicly pullable api image | needs_validation | — |
| 57 | [Worker encode input confinement](57-worker-encode-input-confinement.md) | Compression-on encode opens whatever inputFilePath api returns, including URLs and out-of-root… | needs_validation | 01, 03, 25 |
| 58 | [Runner cancel sigkill](58-runner-cancel-sigkill.md) | Cancelling an encode never escalates to SIGKILL because the guard tests ChildProcess.killed | needs_validation | 26 |
| 59 | [Source extension replace pattern](59-source-extension-replace-pattern.md) | Torrent file extension is used as a String.replace replacement string, letting $` splice the o… | needs_validation | 01, 03, 25, 57 |

### Status changes to earlier drafts

run-3 re-verified all 26 earlier leads against current source:

- **Now confirmed (severity low):** 04 (zip entry count), 06 (removed user keeps sessions),
  07 (password change keeps sessions), 09 (login/disable race), 24 (subtitle text regex).
- **Rejected:** 25 (ffmpeg protocol whitelist): a local reproduction showed libavformat's defaults
  already block the assumed path; keep it as optional hardening only.
- **Still `needs_validation`:** the other twenty. Each spec's front matter records its verdict.

## Coverage

run-3 closed every area run-1 and run-2 had deferred (admin settings and outbound hosts, the
non-admin resolvers, library-probe callbacks, scheduler sweeps, Redis caches and BullMQ payloads,
the media-server index, tus limits, worker path confinement) in 63 hunter units across three waves,
and a final independent coverage critic found no remaining gap. Not covered by any pass: behaviour
that needs a live MariaDB, Redis, qBittorrent, Prowlarr, Jellyfin/Plex or browser, the published
images, GitHub repository settings, and the host firewall/Traefik deployment.
