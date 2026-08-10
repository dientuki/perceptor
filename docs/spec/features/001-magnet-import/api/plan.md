---
title: Manual Magnet Import — api slice
service: api
last_updated: 2026-08-09
status: Implemented
---

# PLAN: Manual Magnet Import — `api` (`api/plan.md`)

## Scope

Parse the magnet, expose the mutation, and make the qBittorrent client fail loudly. This slice owns
the whole server side: the infoHash, the `MediaSource`, the conflict rules and the error messages
`web` displays verbatim.

Not doing: anything in `services/web/`, and nothing downstream of `qbittorrent.add()` — AutoRun,
`torrentCompleted`, the scan and the encode already work and are not touched.

## Files

| File | New / Modified | What changes |
| :-- | :-- | :-- |
| `src/clients/torrent/magnet.ts` | New | Pure `parseMagnet(magnet) → { infoHash, displayName }` |
| `src/clients/torrent/magnet.spec.ts` | New | The unit tests for it |
| `src/movies/movies.service.ts` | Modified | Extract `attachTorrentSource`, add `addMagnetToMovie` |
| `src/movies/movies.resolver.ts` | Modified | The `addMagnetToMovie` mutation |
| `src/clients/torrent/client.ts` | Modified | `add()` checks `response.ok` |

## Existing code to reuse

- `src/movies/movies.service.ts` → `addTorrentToMovie` — its body *is* the shared trunk. Extract it
  rather than writing a parallel method; the two entrances must not drift.
- `src/clients/torrent/client.ts` → `QbittorrentClient.add()` — already derives a unique per-torrent
  save path from the URL. Nothing new needed for magnets.
- `src/media-roots/` → `resolveFromRoot`, already used by `add()`. Do not compose paths by hand.
- The `ConflictException` wording already in `addTorrentToMovie` — reuse the exact string, it is
  part of the contract.

## Steps

1. `magnet.ts`. Reject anything not starting with `magnet:?`. Parse with `URLSearchParams` over
   everything after the prefix. Read **all** `xt` params; prefer `urn:btih:`. Accept 40-char hex
   (lowercase it) or 32-char base32 (decode to 20 bytes via a 5-bit accumulator, RFC 4648, no
   padding, then hex). If only `urn:btmh:` is present, throw the v2 message. Read `dn` for the
   display name.
2. `magnet.spec.ts`. See Tests below.
3. `movies.service.ts`: rename the body of `addTorrentToMovie` to a private
   `attachTorrentSource(movieId, { kind, infoHash, urls, releaseTitle, force })`, and insert the
   duplicate-hash branch (see Contract obligations). `addTorrentToMovie` becomes a one-liner passing
   `kind: 'TORRENT_SEARCH'`; `addMagnetToMovie` parses (wrapping the parser's `Error` in
   `BadRequestException`) and passes `kind: 'TORRENT_FILE'` with `urls: [magnet]`.
4. `movies.resolver.ts`: the mutation, alongside `addTorrentToMovie`, with no annotated return type
   for the reason already commented in that file. `schema.gql` regenerates itself on boot.
5. `client.ts`: `if (!response.ok) throw` in `add()`.

**Order inside `attachTorrentSource` is the requirement, not a detail** (NFR-1): movie lookup →
in-progress guard → duplicate-hash check → `qbittorrent.add()` → create/update `MediaSource` →
repoint the movie. Everything that can throw throws before the first write and before the external
call.

## Contract obligations

Produce exactly the SDL and the error table in `../spec.md`. Two consequences:

- The message strings are user-facing and Spanish; `web` renders them verbatim and matches a
  substring of the in-progress one. They are API surface.
- `force` must **not** override the cross-movie collision. It looks inconsistent from in here and
  is deliberate — see `../plan.md` § Contract Freeze.

The duplicate-hash branch, precisely:

| `findUnique({ where: { infoHash } })` | Action |
| :-- | :-- |
| Row exists, belongs to a **different** movie | `ConflictException` naming that movie. Ignore `force` |
| Row exists, belongs to **this** movie or to none | **Reuse it**: update to `QUEUED`, new `downloadPath`, `errorMessage: null` |
| No row | Create |

The reuse branch also closes a latent P2002 on the pre-existing indexer path, where re-picking the
same release crashed with a raw Prisma error.

## Tests

`src/clients/torrent/magnet.spec.ts` — owed under Constitution, Article IX. This is the only
bit-level logic in the change and its failure is completely silent: a wrong hash means the torrent
downloads fine and the movie hangs in `DOWNLOADING` forever, with nothing in any log.

Cases: uppercase hex → lowercased; a known base32 value → its hex equivalent; hybrid v1+v2 → v1
wins; v2-only → throws; `dn` with `+` and with `%20`; no `dn` → `null`; empty string; an `http`
URL; no `xt` at all; a hash of the wrong length.

Use a **verified** hex↔base32 pair. Compute it and check it before writing the test — a test vector
recalled from memory is how a parser gets "proven" against the wrong answer.

Nothing else in this slice is owed a test: `attachTorrentSource` fails loudly, and the resolver is
three lines of wiring.

## Done when

```bash
bin/cli api npx --no tsc --noEmit
bin/npm api test -- magnet
```

Typecheck error count no higher than before (3, all in `auth.service.spec.ts`), and the magnet
suite green.
