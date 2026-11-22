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

## Not yet audited

Coverage of run-1 was partial. Deferred for a later pass: admin settings and outbound hosts, the
non-admin resolvers not reviewed (media, `searchTorrents`, calendar, `mediaRoots`, preferences),
library-probe callbacks, scheduler tasks and sweeps, Redis cache and BullMQ payloads, the
media-server index, tus size and lifetime limits, batch `remove(hashes[])`. Out of scope:
`services/worker` path confinement.
