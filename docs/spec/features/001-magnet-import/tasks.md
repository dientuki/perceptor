---
title: Manual Magnet Import — Tasks
last_updated: 2026-08-09
status: Done
---

# TASKS: Manual Magnet Import (`tasks.md`)

## Legend

| Marker | Meaning |
| :-- | :-- |
| `[api]` `[web]` | Which subagent owns the task |
| `[docs]` | Documentation, owned by the orchestrator |
| `→ Tnnn` | Blocked by that task |

No task in this feature is `[P]`. It is small and strictly sequential — every step consumes the one
before it, and marking anything parallel would have been decoration.

## Tasks

### Group 1 — the parser

- [x] **T001** `[api]` Write `src/clients/torrent/magnet.ts`: `parseMagnet` returning
      `{ infoHash, displayName }`, normalising hex and base32, preferring `btih` over `btmh`.
      *Done when:* the function exists and is pure — no Nest, no imports from `@/`.
- [x] **T002** `[api]` Write `src/clients/torrent/magnet.spec.ts` covering both encodings, the
      hybrid case, the v2 rejection, `dn` decoding and malformed input, using a hex↔base32 pair
      verified before the test was written. → T001
      *Done when:* `bin/npm api test -- magnet` is green.

### Group 2 — the mutation

- [x] **T003** `[api]` Harden `QbittorrentClient.add()` with a `response.ok` check that throws.
      *Done when:* a magnet qBittorrent rejects surfaces its status and body to the caller.
- [x] **T004** `[api]` Extract `attachTorrentSource` from `addTorrentToMovie` and add the
      duplicate-`infoHash` branch (conflict / reuse / create). → T003
      *Done when:* `addTorrentToMovie` still behaves identically and a repeated hash no longer
      raises a raw P2002.
- [x] **T005** `[api]` Add `addMagnetToMovie` to the service and the resolver. → T001, T004
      *Done when:* `bin/cli api cat src/schema.gql` shows the mutation exactly as
      `spec.md` § GraphQL Contract Delta declares it.

### Group 3 — the consumer

- [x] **T006** `[web]` Write `src/actions/imports.ts` with `importMagnetAction`. → T005
      *Done when:* it follows the house action pattern and throws `errors[0].message`.
- [x] **T007** `[web]` Rename `ImportMagnetModal.tsx` → `importMagnetModal.tsx` and rewrite it
      against the action, with inline errors and the confirm/"Reemplazar" flow. → T006
      *Done when:* it imports nothing from `@/actions/jobs` or `@prisma/client`.
- [x] **T008** `[web]` Fix `Movie.tsx`: `MEDIA_TYPE.MOVIE`, and call `openMagnetModal` directly.
      → T007
      *Done when:* `bin/cli web npx --no tsc --noEmit` reports **fewer** errors than before.

### Group 4 — verification and docs

- [x] **T009** `[docs]` Root `CLAUDE.md`: the "Find release (indexer)" pipeline row now names both
      paths.
- [x] **T010** `[docs]` Walk every acceptance criterion in `spec.md` against the running stack,
      tick each box, clean up the test data, and set `status: Implemented`.

## Blocked

Nothing. One condition was found during verification and accepted rather than fixed:
re-submitting the **identical** magnet against the same movie with `force: true` returns
`qBittorrent rechazó el torrent (409): Conflict`, because the client already holds that hash. The
realistic "replace a stuck download" flow uses a different magnet and works; smoothing over
qBittorrent's 409 was never in the plan. Recorded here rather than silently absorbed.
