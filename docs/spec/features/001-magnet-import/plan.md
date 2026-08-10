---
title: Manual Magnet Import — Implementation Plan
spec_version: 1.0.0
last_updated: 2026-08-09
status: Implemented
---

# PLAN: Manual Magnet Import (`plan.md`)

## Approach

Do not build a second download path. Build a second **entrance** to the one that exists.

`MoviesService.addTorrentToMovie` already does everything after "we have an infoHash and a URL":
guard the movie, guard an in-progress download, call `qbittorrent.add()`, create the `MediaSource`,
repoint the movie. The magnet path differs only in where the infoHash comes from — Prowlarr
supplies it there, and here it has to be parsed out of the string.

So: extract the shared trunk of `addTorrentToMovie` into a private `attachTorrentSource`, and give
it two thin public entrances that differ only in how they obtain `{ infoHash, urls, releaseTitle,
kind }`. Everything downstream — AutoRun, `torrentCompleted`, the scan, the encode, the media
server notification — is untouched.

Reused rather than rebuilt:

- `services/api/src/clients/torrent/client.ts` — `QbittorrentClient.add()`, including its per-torrent
  save-path derivation.
- `services/api/src/movies/movies.service.ts` — the existing guard order and the exact
  `ConflictException` wording, so `web`'s existing confirm flow keeps working.
- `services/web/src/lib/graphql-client.ts` — `fetchGraphQL`, via a new action following the house
  pattern.
- `services/web/src/components/import/importFileModal.tsx` — the modal layout, the inline-error
  convention, and the `onClose()` + `router.refresh()` close.

The one genuinely new unit is the magnet parser, and it is a pure function with no Nest and no
network so that it can be tested on its own.

## Order of Work

| Step | Service | Why it must come here |
| :-- | :-- | :-- |
| 1 | `api` | The parser is the risk. It is pure and testable, so it lands and is proven first |
| 2 | `api` | The mutation. Nothing in `web` can be written against a schema that does not exist |
| 3 | `api` | Harden `add()`. Must precede any live test, or a rejected magnet leaves a phantom row |
| 4 | `web` | The action, then the modal. Both consume step 2 |

Nothing runs in parallel here. The feature is small and every step depends on the one before it —
marking steps `[P]` would have been decoration.

## Contract Freeze

The delta in `spec.md` is frozen. Two things an implementer will want to change and must not:

- **The exact string `Esta película ya tiene una descarga en curso.`** It looks like a message and
  is actually an API. `web` matches on a substring of it to decide whether to offer "Reemplazar".
  There is no codegen and no test across the boundary, so rewording it breaks the confirm flow
  with no error at compile time or run time — the button simply never changes.
- **`force` being ignored for the cross-movie collision.** From inside `api` it looks inconsistent:
  `force` overrides one conflict but not the other. It is deliberate. Replacing your own download
  is a decision the user can make; taking a source away from a different movie is not.

## Migrations

**None.** No schema change — `MediaSource.kind = TORRENT_FILE` already exists and its comment in
`schema.prisma` already describes exactly this case.

## Risks

| Risk | How it fails | Mitigation |
| :-- | :-- | :-- |
| Stored `infoHash` ≠ the hash qBittorrent reports | Download completes, `handleTorrentCompleted` finds no match and returns silently, movie stuck in `DOWNLOADING` forever, nothing in any log | Normalise to lowercase 40-hex in the parser; unit tests for both encodings; **AC-5** compares the stored value against the live client |
| base32 decoded wrong | Same as above, but only for magnets using that encoding — so it survives casual testing | A hand-verified hex↔base32 pair as a test vector, cross-checked before the test was written |
| Hybrid v1+v2 magnet, v2 hash picked | Same silent hang, only on hybrid magnets | Iterate **all** `xt` params and prefer `btih`; explicit test |
| qBittorrent rejects the magnet, API doesn't notice | `MediaSource` created in `QUEUED` that never downloads | NFR-2: check `response.ok` in `add()`, and call it **before** any write |
| Unique constraint on a repeated hash | Raw Prisma P2002 surfaced to the user | Explicit `findUnique` first, branching into reuse / conflict / create. Also fixes the same latent bug on the pre-existing indexer path |

## Verification

```bash
bin/cli api npx --no tsc --noEmit
bin/npm api test -- magnet
bin/cli web npx --no tsc --noEmit
```

Then live, against the running stack — the error paths first, checking
`select count(*) from media_sources` is unchanged after each; then a successful add, comparing the
stored `infoHash` against `/api/v2/torrents/info` from the client itself (AC-5). Finally the UI on
`/movies/<id>`: the button opens the modal, an invalid magnet shows its error inline.

Test data goes in as throwaway movies and comes out again — delete the torrents from qBittorrent
with `deleteFiles: true` and the rows from the database, then confirm the real `movies` and
`media_sources` are exactly as they were.
