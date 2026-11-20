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

## Not yet audited

Coverage of run-1 was partial. Deferred for a later pass: admin settings and outbound hosts, the
non-admin resolvers not reviewed (media, `searchTorrents`, calendar, `mediaRoots`, preferences),
library-probe callbacks, scheduler tasks and sweeps, Redis cache and BullMQ payloads, the
media-server index, tus size and lifetime limits, batch `remove(hashes[])`. Out of scope:
`services/worker` path confinement.
