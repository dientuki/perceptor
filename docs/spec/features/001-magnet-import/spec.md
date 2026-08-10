---
title: Manual Magnet Import
spec_version: 1.0.0
author: Juan Farias
created_at: 2026-08-08
last_updated: 2026-08-09
status: Implemented
services: [api, web]
---

# SPEC: Manual Magnet Import (`spec.md`)

> Written **after** the fact, against a feature that shipped on 2026-08-08. It exists as the
> worked example for `docs/spec/features/_templates/` — the templates were validated by filling
> them with a real feature whose requirements, contract and verification results were already
> known. Nothing here is speculative; every acceptance criterion below was actually observed.

## Context & Goal

Perceptor's only way to start a download was to search Prowlarr and pick a release
(`addTorrentToMovie`). That covers the common case and fails the rest: a title no configured
indexer carries, a private tracker Prowlarr is not wired to, a magnet a user already has in a
browser tab.

The pipeline downstream of "a torrent was handed to qBittorrent" is complete and works — qBittorrent's
AutoRun hook calls `torrentCompleted`, which enqueues the scan, which creates the `ProcessJob`,
which encodes, which notifies the media server. Nothing about that needs to change. What was
missing was a second **entry point** into it.

`services/web/src/components/movies/Movie.tsx` already rendered a "Magnet" button next to the
working "File" button, and already rendered an `<ImportMagnetModal>` beside the working
`<ImportFileModal>`. That modal was a skeleton: it imported `createJobFromMagnetAction` from
`@/actions/jobs`, which does not exist, and `MediaType`/`Movie`/`Episode` from `@prisma/client`,
which `web` must never import. Half the button was real and half was a stub that did not compile.

This feature makes that button work: paste a magnet, the API hands it to qBittorrent, and the
movie enters the same `MediaSource`/AutoRun flow the indexer path already uses. It changes the
"Find release (indexer)" row of the pipeline table in the root `CLAUDE.md` from one path to two.

### The part that is not obvious

`addTorrentToMovie` gets the `infoHash` **for free** — Prowlarr returns it with every search
result. A hand-pasted magnet has no such provider, and the hash is not optional:

- `MediaSource.infoHash` is `@unique @db.VarChar(40)`.
- `DownloadsService.handleTorrentCompleted` looks up **exclusively** by `infoHash`, and silently
  ignores a hash it does not know — by design, since AutoRun fires for every torrent in the client,
  including ones Perceptor did not create.

So a hash that does not match what qBittorrent reports means the download completes normally and
the movie sits in `DOWNLOADING` forever, with no error in any log. That failure mode is what most
of the requirements below are defending against.

qBittorrent reports the v1 hash as **40 hex characters**. A magnet's `xt=urn:btih:` may legally
carry either 40 hex or 32 base32 characters — the same 20 bytes, two encodings. Normalising is
mandatory, not cosmetic.

## Requirements

### Functional Requirements

- [x] **REQ-1 (Paste a magnet)**: Must accept a `magnet:?…` string from the movie detail page and
      hand it to qBittorrent, associating the resulting download with that movie.
- [x] **REQ-2 (Extract the hash locally)**: Must derive the v1 infoHash from the magnet string
      itself, with no network call.
- [x] **REQ-3 (Normalise the encoding)**: Must accept both 40-char hex and 32-char base32
      `xt=urn:btih:` values and store both as lowercase 40-char hex.
- [x] **REQ-4 (Prefer v1 in hybrid magnets)**: Given a magnet carrying both `urn:btih:` and
      `urn:btmh:`, must use the v1 (`btih`) hash — that is what AutoRun will report.
- [x] **REQ-5 (Reject what cannot work)**: Must reject, with a distinct user-facing message, a
      string that is not a magnet, a magnet with no usable infoHash, and a BitTorrent-v2-only
      magnet.
- [x] **REQ-6 (Name the release)**: Must use the magnet's `dn=` parameter as `releaseTitle`,
      URL-decoded, or `null` when absent.
- [x] **REQ-7 (Refuse to steal a source)**: Given a magnet whose infoHash already belongs to a
      *different* movie, must reject it naming that movie, and must not proceed even when the
      caller asks to force.
- [x] **REQ-8 (Replace an in-progress download)**: Given a movie that already has a download, must
      reject the first attempt with a message the UI can recognise, and succeed on a second
      attempt that confirms.

### Non-Functional & Operational Requirements

- [x] **NFR-1 (No half-applied state)**: Must not create or modify any database row if the magnet
      is rejected — by the parser, by the duplicate check, or by qBittorrent itself. Everything
      that can fail must fail before the first write.
- [x] **NFR-2 (Fail loudly at the torrent client)**: `QbittorrentClient.add()` must check the HTTP
      response. A silently-ignored rejection produces a `MediaSource` in `QUEUED` that never
      downloads — the same silent failure by another door.
- [x] **NFR-3 (Reuse over collide)**: Re-submitting a hash that already belongs to *this* movie
      (or to no movie) must reuse that `MediaSource` row rather than attempting an insert that
      violates the unique constraint.
- [x] **NFR-4 (No Prisma in web)**: The modal must not import `@prisma/client` (Constitution,
      Article II).

## GraphQL Contract Delta

```graphql
type Mutation {
  """Manda un magnet pegado por el usuario a qBittorrent y lo asocia a la película"""
  addMagnetToMovie(movieId: Int!, magnet: String!, force: Boolean = false): Movie!
}
```

Returns the updated `Movie` — `status` becomes `DOWNLOADING` and `mediaSourceId` points at the new
or reused `MediaSource`.

Errors. `web` has no codegen, so this table is the contract for the consumer as much as the SDL is:

| Condition | Exception | Message the user sees |
| :-- | :-- | :-- |
| String is not a magnet | `BadRequestException` | `No parece un magnet link` |
| No usable `xt=urn:btih:` | `BadRequestException` | `El magnet no tiene un infoHash válido` |
| BitTorrent v2 only | `BadRequestException` | `Magnet de BitTorrent v2, todavía no soportado` |
| Movie does not exist | `NotFoundException` | `La película <id> no existe` |
| Movie already downloading, `force: false` | `ConflictException` | `Esta película ya tiene una descarga en curso. Confirmá para reemplazarla.` |
| Hash belongs to another movie | `ConflictException` | `Ese magnet ya está asociado a «<title>»` |
| qBittorrent rejects the torrent | `Error` | `qBittorrent rechazó el torrent (<status>): <body>` |

**Consumer obligation**: `web` matches on the substring `ya tiene una descarga en curso` to switch
the submit button to "Reemplazar" and retry with `force: true`. That string is therefore part of
the contract — changing it silently breaks the confirm flow with no compile error anywhere.

The message text reuses the wording `addTorrentToMovie` already produced, precisely so the existing
confirm behaviour in `SearchTorrent.tsx` keeps working unchanged.

## Data Model Changes

**None.** `MediaSource` already has every column this needs — `kind`, `status`, `infoHash`,
`downloadUrl`, `releaseTitle`, `downloadPath`. A pasted magnet is `kind: TORRENT_FILE`, whose
existing comment in `schema.prisma` already reads *"El usuario pegó un magnet o subió un .torrent"*.

## Acceptance Criteria

- [x] **AC-1**: Submitting `"pepe"` returns `No parece un magnet link`, and
      `select count(*) from media_sources` is unchanged.
- [x] **AC-2**: Submitting a `urn:btmh:`-only magnet returns `Magnet de BitTorrent v2, todavía no
      soportado`, and the row count is unchanged.
- [x] **AC-3**: Submitting a hash that already belongs to another movie returns
      `Ese magnet ya está asociado a «Inception»` — **also with `force: true`** — with no row
      created and nothing added to qBittorrent.
- [x] **AC-4**: A valid magnet moves the movie to `DOWNLOADING` and creates a `media_sources` row
      with `kind=TORRENT_FILE`, `status=QUEUED`, a lowercase 40-hex `infoHash`, and `releaseTitle`
      decoded from `dn=`.
- [x] **AC-5** *(the one that matters)*: The `infoHash` stored in that row is **byte-identical** to
      the `hash` qBittorrent reports for the torrent it just accepted:
      ```bash
      bin/cli api node -e "fetch('http://<torrent-host>:<port>/api/v2/torrents/info').then(r=>r.json()).then(t=>console.log(t.map(x=>x.hash)))"
      bin/mysql -e 'select infoHash from media_sources order by id desc limit 1'
      ```
      If these ever diverge, `torrentCompleted` will never match and the movie hangs in
      `DOWNLOADING` with no error anywhere.
- [x] **AC-6**: A second submission against a movie already downloading is rejected; retrying with
      `force: true` and a *different* hash succeeds and repoints `movie.mediaSourceId`.
- [x] **AC-7**: `bin/npm api test -- magnet` passes, covering hex normalisation, base32 decoding,
      hybrid v1+v2 preference, v2-only rejection, `dn` with `+` and `%20`, and malformed input.
- [x] **AC-8**: The Magnet button on `/movies/<id>` opens the modal (it previously broke the
      render), and an invalid magnet shows its error inline — no `alert()`, no crash, no change to
      the movie's state.

## Out of Scope

- **`.torrent` HTTP URLs.** `QbittorrentClient.add()` accepts them and `parse-torrent` is already a
  dependency, but resolving their hash means downloading the file or following a redirect —
  network I/O that can hang or fail inside a synchronous mutation. `resolveInfoHash` in
  `src/clients/indexer/client.ts` already sketches the shape for the day this is done.
- **BitTorrent v2-only magnets.** Rejected explicitly. Supporting them requires first establishing
  which hash qBittorrent's AutoRun reports for a v2 torrent — that is research, not implementation.
- **Magnets for shows and seasons.** `ImportMagnetSeasonModal.tsx` stays dead; the API exposes no
  shows yet. When it does, this modal is the thing to copy.
- **The orphan `MediaSource` that `force` leaves behind.** Replacing a download repoints
  `Movie.mediaSourceId` and abandons the old row (and the old torrent in qBittorrent). This is the
  pre-existing behaviour of the indexer path; NFR-3 only mitigates the case where the hash repeats.
