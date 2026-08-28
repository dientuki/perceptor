---
title: Download Status and Torrent Tags — web slice
service: web
last_updated: 2026-08-27
status: Implemented            # Draft | Approved | Implemented
---

# PLAN: Download Status and Torrent Tags — `web` (`web/plan.md`)

Read `../spec.md` and `../plan.md` first. The GraphQL delta in `../spec.md` is **read-only** — if
it is wrong, stop and report (Constitution, Article VIII). This slice runs **after** the `api`
slice is merged; starting earlier means sending `force` to a mutation that no longer accepts it,
which fails every acquisition at runtime.

## Scope

This slice owns the downloads panel on `/movies/<id>` and `/shows/<id>`, its refresh control, its
three per-row actions (start, stop, delete — **no force-start**, see `../spec.md` § Out of Scope)
with a delete confirmation, and the actions that back them. It also removes the three
`…_DOWNLOAD_IN_PROGRESS` keys, which no longer have a producer.

It does **not** touch `force`, the `…_ALREADY_COMPLETED` keys, or the "Reemplazar" flow those drive:
that is `027-replace-completed-media`'s completed-title replacement and it stays. The two components
that list both key families keep the completed half and drop the downloading half.

A row whose `kind` is `LOCAL_FILE` is an upload competing in the same race (REQ-19). It is listed
like any other row, with its `status` and `label`, and it gets **no** action buttons — there is no
torrent behind it to start, stop or delete.

It is **not** deciding tags, race behaviour, cleanup or scoping — all of that is server-side and
already settled by the time this slice starts. It never calls qBittorrent: every value on screen
came from `api`, which read it (REQ-9). There is no polling (REQ-10).

**`018-ui-i18n` is implemented**, so every string this slice adds is a catalog key with an entry in
both `services/web/messages/en.json` and `es.json`, read through `useTranslations`, and every error
is resolved by `extensions.i18n.key` — never by matching message text. An earlier revision of this
plan said the opposite and instructed Spanish literals at the render site; that was wrong
(`../spec.md` NFR-3). The `es` register stays Rioplatense, matching the entries already there.

Writes are confined to `services/web/` and this directory.

## Files

| File | New / Modified | What changes |
| :-- | :-- | :-- |
| `src/actions/downloads.ts` | New | `getMovieDownloads`, `getShowDownloads`, `startDownloadAction`, `stopDownloadAction`, `deleteDownloadAction` |
| `src/types/downloads.ts` | New | The hand-retyped `Download` shape |
| `src/components/downloads/DownloadsPanel.tsx` | New | Client component: the list, the refresh control, the row actions |
| `src/components/downloads/DeleteDownloadModal.tsx` | New | REQ-11's confirmation, on the existing `Modal` |
| `src/app/(dashboard)/movies/[id]/page.tsx` | Modified | Fetch the film's downloads, render the panel |
| `src/app/(dashboard)/shows/[id]/page.tsx` | Modified | Same for the show |
| `messages/en.json`, `messages/es.json` (service root, not `src/`) | Modified | Add the panel's keys and the two new error keys; **delete** the three `…_DOWNLOAD_IN_PROGRESS` entries |
| `src/components/import/importMagnetModal.tsx` | Modified | Drop the three `…_DOWNLOAD_IN_PROGRESS` entries from its key array (lines 30-32); keep `…_ALREADY_COMPLETED`, `needsConfirm` and the "Reemplazar" relabel |
| `src/components/search/SearchTorrent.tsx` | Modified | Same narrowing of its key array (lines 31-33); keep its confirm banner for the completed case |

`src/actions/imports.ts`, `indexer.ts`, `shows.ts` and `uploads.ts` are **not** in this list: they
keep their `force` argument, which is `027`'s and unrelated to what this feature removes.
`src/components/import/importFileModal.tsx` is also absent — its missing confirm button for a
downloading target stops mattering once `api` stops raising the message, and its `isCompleted`
branch is the one that already works.

## Existing code to reuse

- **`src/actions/media-server.ts`** — the canonical server-action shape (`services/web/CLAUDE.md`
  says copy this one and do not invent a variant). `'use server'` on line 1, a module-level
  SCREAMING_SNAKE query const, the shape as `fetchGraphQL<T>`, errors from `errors[0].message` with
  a Spanish fallback.
- **`src/lib/auth-session.ts` — and the choice between its two helpers is not cosmetic.** The two
  page reads happen during a Server Component render pass, so they use
  `redirectToClearSession(errors)`, exactly as `getMovieById`/`getShowById` already do. The three
  mutations are called from a client component and use `redirectIfUnauthenticated(errors)`, like
  every other form action. Re-derive this per call site rather than copying the nearest example —
  cookie mutation throws during a render pass.
- **`src/components/ui/modal/index.tsx` + `src/hooks/useModal.ts`** — the delete confirmation is
  built on these. There is no shared confirm dialog in this codebase; do not add one as a side
  effect of this feature, and do not reach for a third-party dialog.
- **`src/components/shows/SeasonAccordion.tsx:13-24`** — `statusBadgeClass`, the existing
  status-pill treatment (green `COMPLETED`, red `ERROR`, grey `MISSING`, pulsing blue default). The
  panel's status column follows it so the two screens do not grow two visual vocabularies.
- **`router.refresh()`** — how every existing mutation in this codebase re-reads server state after
  a write (`importMagnetModal.tsx` does exactly this on success). REQ-10's refresh control is the
  same call, not a bespoke fetch.
- **`src/app/(dashboard)/movies/[id]/page.tsx`'s `Promise.all` + `cache()` pattern** — the downloads
  read joins the existing parallel fetch rather than adding a waterfall.

## Steps

1. **Types and actions first.** `src/types/downloads.ts` with the `Download` shape hand-copied from
   `../spec.md`; `src/actions/downloads.ts` with the two reads and three mutations. Every field
   name comes from the spec, not from guessing at `api`'s source.
2. **Retire the downloading-conflict keys.** Drop the three `…_DOWNLOAD_IN_PROGRESS` entries from
   `importMagnetModal.tsx`'s and `SearchTorrent.tsx`'s key arrays and from both JSON catalogs.
   **Leave `…_ALREADY_COMPLETED`, `needsConfirm`, the "Reemplazar" relabel and every `force`
   argument alone** — that is `027`'s completed-title flow and it must still work (AC-23). Do this
   before building the panel: it shrinks the diff the panel lands on top of.
3. **`DownloadsPanel.tsx`.** Rows from the action's result; percent and speed columns; the status
   pill; the refresh control calling `router.refresh()`; start and stop buttons; delete opening the
   confirmation. Gate the three buttons on **`infoHash != null`**. Not on `kind` — `SourceKind` has
   two torrent values and there is no codegen to catch a wrong literal — and not on `progress`: a
   torrent that vanished from qBittorrent has a null `progress` and still needs its delete button.
   `kind` is for the row's label, not for the branch.
4. **`DeleteDownloadModal.tsx`** on `Modal` + `useModal`, naming what is about to be deleted and
   stating that the files go too.
5. **Wire both pages**, joining the existing `Promise.all`.
6. Typecheck, build, and the `force` grep.

## Contract obligations

`web` is a consumer of `../spec.md` § GraphQL Contract Delta, hand-retyped with **no codegen** —
the `<T>` on every `fetchGraphQL` is a human copy and nothing checks it
(`docs/spec/graphql-contract.md` § The gap).

Fields that will arrive `null` in normal operation, and must render as information rather than as a
loading or error state:

- `torrentState`, `progress`, `downloadSpeed` — all three when the torrent is not in the client
  (removed by hand, or qBittorrent unreachable). The row still renders, with `status`, `label` and
  the ids from the database. **AC-14** is exactly this case with the container stopped.
- `releaseTitle` — nullable as it already is elsewhere.

`progress` arrives **0..100**. Multiplying by 100 again renders 1%; this is called out in the spec
because there is no compiler across the seam.

Error conditions this slice must handle, not just the happy path:

All of these arrive as `extensions.i18n.key` and are rendered from the catalogs — never matched as
text.

| From | Key | What `web` does |
| :-- | :-- | :-- |
| `movieDownloads` / `showDownloads` on an unowned title | `MOVIE_NOT_FOUND` / the show key | The page already handles the same answer from `getMovieById`/`getShowById`; do not add a second treatment |
| `downloadStart` on a non-torrent source | `DOWNLOAD_NOT_A_TORRENT` | Surface in the panel; the button should not have been offered (REQ-18) |
| Any control while qBittorrent is down | `TORRENT_CLIENT_REJECTED` | Surface it and leave the row unchanged — do not optimistically update |
| Absent/expired credential | the existing auth key | The existing `auth-session.ts` helpers, per § Existing code to reuse |

The three `…_DOWNLOAD_IN_PROGRESS` keys must not survive anywhere under `services/web` — not in a
component array, not in either JSON catalog.

## Tests

**None, and this is not an omission.** `services/web` has no test runner and `018-ui-i18n`'s NFR-6
explicitly forbids adding one; this feature is not the place to reverse that. Nothing in this slice
fails silently in the Article IX sense — the panel either renders values or renders blanks, and both
are visible on screen. The two genuinely silent failure classes in this feature (a second source
reaching `ENCODING`, a sweep selecting by tag) are both server-side and are covered in
`../api/plan.md` § Tests.

The gates below, plus the manual pass in `../plan.md` § Verification, are what stands in for a suite
here — same arrangement as every previous `web` slice.

## Done when

```bash
bin/cli web npx --no tsc --noEmit
bin/npm web run build
grep -rn "download_in_progress" services/web/src services/web/messages
grep -rn "already_completed" services/web/src services/web/messages
grep -rn "@prisma/client" services/web/src
```

The first grep must be **empty**; the second must still hit, unchanged — it is `027`'s and this
slice does not touch it.

Typecheck reports no more than the baseline measured before the change — and none of the remaining
errors in a file this slice touched. `build` exits 0. The last three greps come back empty. Biome
(`bin/npm web run lint`) is clean **on the touched files only**; the ~1598 pre-existing template
errors are not this slice's to fix.
