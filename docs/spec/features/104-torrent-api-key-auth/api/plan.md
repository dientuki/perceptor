---
title: qBittorrent Authenticated by API Key, Not by Subnet — api slice
service: api
last_updated: 2026-10-25
status: Implemented
---

# PLAN: qBittorrent Authenticated by API Key, Not by Subnet — `api` (`api/plan.md`)

## Scope

`api` sends `TORRENT_API_KEY` on every request to qBittorrent. It maps a rejected credential to
`error.download.torrent_client_unauthorized` on every user-facing operation that calls the torrent
client. The six acquisition mutations gain the keyed `torrent_client_rejected` they were already
documented as raising. Live reads and `reset-password` name the rejection.

`api` does **not** generate, validate or write the key: `infra` does that. It does not touch the
message catalogs of `web`.

## Files

| File | New / Modified | What changes |
| :-- | :-- | :-- |
| `src/clients/torrent/auth.ts` | New | `torrentAuthHeaders(): Record<string, string>`: `{ Authorization: 'Bearer ' + process.env.TORRENT_API_KEY }`, or `{}` when the variable is unset (qBittorrent then answers `403`, which maps to the new key). |
| `src/clients/torrent/client.ts` | Modified | Every `fetch` (`info`, `files`, `add`, `start`, `stop`, `remove`, `setSavePath`) passes `headers: torrentAuthHeaders()`. |
| `src/shared-login/shared-login.ts` | Modified | `setQbittorrentLogin` sends the same headers on both calls, and turns `401`/`403` into reason `credencial rechazada (TORRENT_API_KEY)`. |
| `src/downloads/torrent-client-failure.ts` | New | Two pure functions, below. |
| `src/downloads/downloads.service.ts` | Modified | `callTorrentClient` delegates to `torrentClientFailure`. The live-read `catch` blocks log through `describeTorrentClientFailure`. |
| `src/acquisition/attach-source.service.ts` | Modified | The `info()`/`start()` reactivation calls and the `add()` call are wrapped so a failure throws `torrentClientFailure(err)`. |
| `src/media-sources/media-sources.service.ts` | Modified | `downloadedFiles`' `catch` logs through `describeTorrentClientFailure`; it still returns `null`. |
| `src/i18n/error-keys.ts`, `src/i18n/messages.en.ts` | Modified | `TORRENT_CLIENT_UNAUTHORIZED: 'error.download.torrent_client_unauthorized'` and its English text, copied verbatim from the spec. |
| `prisma/seeds/settings.ts` | Modified | Delete the `torrent_api_key` entry. |

## Existing code to reuse

- `DownloadsService.callTorrentClient` (`src/downloads/downloads.service.ts`) is today's single
  mapping from `TorrentClientError.status` to `i18nError.serviceUnavailable(TORRENT_CLIENT_REJECTED,
  { status })`. Extract it, do not duplicate it. `AttachSourceService` gets the same function
  through the import, not a second copy.
- `TorrentClientError` (`src/clients/torrent/client.ts`) already carries the HTTP status. Network
  failures are not `TorrentClientError` and keep mapping to `status: 0`.
- `i18nError.serviceUnavailable` (`src/i18n/i18n-error.ts`), the same class as the existing key.
- `messages.en.spec.ts` already fails when an `ERROR_KEYS` entry has no English message, so adding
  the key there is enough.
- `shared-login.spec.ts` and `attach-source.service.spec.ts` already exist. Extend them; do not
  start parallel suites.

## Steps

1. Add the error key and its English message.
2. Write `torrent-client-failure.ts`:
   - `torrentClientFailure(err: unknown): HttpException` maps a status of `401`/`403` to
     `TORRENT_CLIENT_UNAUTHORIZED` (no params), anything else to `TORRENT_CLIENT_REJECTED`
     `{ status }` (`0` for a non-`TorrentClientError`).
   - `describeTorrentClientFailure(err: unknown): string` returns the log fragment, e.g.
     `credential rejected (HTTP 403): check TORRENT_API_KEY` for `401`/`403`, otherwise the error's
     own message. It must never include a header or the key.
3. `callTorrentClient` becomes `try { return await action(); } catch (err) { throw
   torrentClientFailure(err); }`.
4. Add `auth.ts` and wire `headers` into all seven `fetch` calls of `QbittorrentClient`. `add`,
   `start`, `stop`, `remove` and `setSavePath` send a `URLSearchParams` body: pass `headers`
   alongside it, and let `fetch` keep setting the form content type itself.
5. `AttachSourceService.attach`: wrap the reactivation `info()`/`start()` and the `add()` so their
   failure throws `torrentClientFailure(err)`. Ordering is unchanged: `add()` still runs before any
   write, so a rejected `add()` creates no `MediaSource` (AC-8).
6. Live-read logs: `liveInfoByHash`, `liveInfoForHash` (the reread after `downloadStart`/`downloadStop`/`downloadDelete`),
   and `MediaSourcesService.downloadedFiles` log `describeTorrentClientFailure(err)`. Their
   return-empty / return-`null` behaviour stays.
7. `setQbittorrentLogin`: headers on both requests, plus the reason mapping. Prowlarr's half is
   untouched.
8. Delete `torrent_api_key` from the settings seed. `grep -rn torrent_api_key src prisma` must then
   find nothing outside migrations.

**Do not** read the key at boot or assert it like `assertAuthEnv()`. An `api` that refuses to boot
over a torrent credential would take the whole application down for what is a download-stage
problem, and `torrent` already fails loudly on its own side.

## Contract obligations

Exactly the table in `../spec.md` § GraphQL Contract Delta:
- `error.download.torrent_client_unauthorized`, no params, `ServiceUnavailableException`, for a
  `401`/`403` on the download controls and the six acquisition mutations;
- `error.download.torrent_client_rejected` `{ status }` for every other failure on those same paths.

## Tests

Owed under Article IX, because each of these failures is otherwise silent:

- `src/downloads/torrent-client-failure.spec.ts` (new) defends against a key mismatch being
  laundered into the generic "rejected (403)" message, or against a live read's log dropping the
  reason. An operator then cannot tell a wrong key from qBittorrent being down. Cases:
  - `TorrentClientError(…, 403)` and `401` map to the unauthorized key with no params;
  - `500` maps to rejected with `{ status: 500 }`;
  - a `TypeError` (unreachable) maps to rejected with `{ status: 0 }`;
  - `describeTorrentClientFailure` names `TORRENT_API_KEY` for `403` and never contains the
    environment value (set a sentinel value in `process.env` and assert its absence).

  Fault-inject by dropping the `401` arm and by swapping the two keys.
- `src/clients/torrent/client.spec.ts` (extend) defends against one method forgetting the header,
  which is silent for `setSavePath` since it ignores the response. With a mocked global `fetch` and a
  sentinel `TORRENT_API_KEY`, every public method sends `Authorization: Bearer <sentinel>`.
  Parametrize over the seven methods so a new method without the header fails the suite.
- `src/acquisition/attach-source.service.spec.ts` (extend) defends against an acquisition still
  escaping unkeyed, or creating a row after a rejected `add()`. A `TorrentClientError(…, 403)` from
  `add()` rejects with the unauthorized key, and `prisma.mediaSource.create` is never called.
- `src/shared-login/shared-login.spec.ts` (extend) covers two cases: a `403` yields the
  `TORRENT_API_KEY` reason, and both requests carry the header.

Not owed: `auth.ts` on its own is one expression covered through `client.spec.ts`. The seed deletion
is verified by the `grep` in step 8.

## Done when

```bash
bin/cli api npx --no tsc --noEmit
bin/npm api test
bin/comments api
```

The typecheck reports 0 errors, every suite is green (the count rises by the new cases only), and
the comment gate passes. `src/schema.gql` is unchanged, since the feature adds no GraphQL type.
