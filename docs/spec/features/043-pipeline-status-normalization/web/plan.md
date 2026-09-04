---
title: Pipeline Status Normalization — web slice
service: web
last_updated: 2026-09-03
status: Implemented
---

# PLAN: Pipeline Status Normalization — `web` (`web/plan.md`)

## Scope

This service owns everything a user reads. It retypes the widened `Download`, gives the eight
normalized values their first translations, collapses the two duplicated status pills into one
component, and draws the download and compression bars in the downloads panel.

It is **not** doing: any decision about *which* status a title is in — `api` derives all eight
values and this slice only renders what arrives; and it is **not** building the `/downloads` screen,
which stays the stub it is today (`src/app/(dashboard)/downloads/page.tsx` returning `null`) and is
its own spec. The panel this slice touches is the one already mounted on the film and series detail
pages.

Read `../spec.md` and `../plan.md` first. The GraphQL delta in `../spec.md` is read-only — there is
no codegen across this boundary, so the hand-retyped shape is the only thing standing between a
renamed field and a silent blank column.

Writes are confined to `services/web/` and this directory. Anything else is a stop-and-report.

## Files

| File | New / Modified | What changes |
| :-- | :-- | :-- |
| `src/types/downloads.ts` | Modified | `progress` → `downloadProgress`; add `encodeProgress: number \| null`, `compressionEnabled: boolean` |
| `src/actions/downloads.ts` | Modified | `DOWNLOAD_FIELDS` selects the renamed and the two new fields |
| `src/components/status/StatusBadge.tsx` | New | The one status pill: value → color, value → translated label |
| `src/components/downloads/DownloadsPanel.tsx` | Modified | Uses `StatusBadge`; deletes its local `statusBadgeClass`; renders the two bars |
| `src/components/shows/SeasonAccordion.tsx` | Modified | Uses `StatusBadge`; deletes its local `statusBadgeClass` |
| `src/components/movies/Movie.tsx` | Modified | The bare `{movie.status}` in the meta line becomes a translated status |
| `src/components/shows/Show.tsx` | Modified | Same, for `{show.status}` |
| `messages/en.json`, `messages/es.json` | Modified | A new top-level `status` namespace, eight keys |

`src/components/status/` is a new top-level component folder, deliberately not
`src/components/ui/status/`: `services/web/CLAUDE.md` records that everything under
`components/ui/` is TailAdmin template scaffolding, and putting project code there breaks the
heuristic a future reader uses to tell the two apart.

## Existing code to reuse

- **`src/components/downloads/DownloadsPanel.tsx`'s `statusBadgeClass`** and
  **`src/components/shows/SeasonAccordion.tsx`'s `statusBadgeClass`** — byte-identical duplicates,
  and the panel's copy already carries a comment admitting it. `StatusBadge` is their single
  replacement (REQ-10), not a third variant: keep the existing pill markup
  (`inline-flex items-center rounded-full px-2 py-1 text-xs font-bold uppercase tracking-wider`) and
  the `animate-pulse` on in-progress states.
- **`src/components/import/importFileModal.tsx`'s progress bar** — the only bar in the codebase:
  an `h-2 w-full overflow-hidden rounded-full bg-gray-200 dark:bg-gray-700` track with an
  `h-full rounded-full bg-brand-500 transition-all` fill driven by `style={{ width }}`. Reuse that
  markup for both new bars rather than inventing a second visual language. Do **not** refactor the
  upload modal to share a component — its bar is driven by local byte counts, not by a `Download`,
  and merging them is a change to a file this feature otherwise does not touch.
- **`src/components/downloads/DownloadsPanel.tsx`'s `formatProgress`** — already handles the
  `null` case as `—` and already carries the "arrives 0..100, do not multiply again" comment. It
  serves both percentages unchanged.
- **`useTranslations` / the `messages/{en,es}.json` pair** — the established i18n path
  (`018-ui-i18n`). The status strings are ordinary UI copy in a new `status` namespace, **not**
  error keys: nothing under `errors` and no `translateGraphQLError` involvement.
- **`src/components/ui/badge/Badge.tsx`** — considered and **not** used; `../plan.md` § Approach
  records why (no `className` passthrough, and its `size="md"` renders the banned `text-sm`). Do not
  widen it.

## Steps

1. **`src/types/downloads.ts`** — rename `progress` to `downloadProgress`, add `encodeProgress`
   (`number | null`) and `compressionEnabled` (`boolean`). The file's header comment already states
   this type is hand-copied from the spec and is exactly as wide as the schema; keep that true and
   point it at `043`.

2. **`src/actions/downloads.ts`** — update `DOWNLOAD_FIELDS`: `progress` becomes `downloadProgress`,
   and `encodeProgress`/`compressionEnabled` join the selection. One constant feeds both
   `MovieDownloads` and `ShowDownloads`, so this is a single edit. Selecting the old `progress`
   against the new schema is a GraphQL validation error, not a silent null — the failure is loud,
   but it happens at runtime, not at build.

3. **`messages/en.json` and `messages/es.json`** — add the `status` namespace with the eight keys
   and the exact strings tabled in `../spec.md` § Status keys. Both catalogs, same keys, or
   `scripts/check-messages.mjs` fails.

4. **`src/components/status/StatusBadge.tsx`** — a client component taking the raw status string.
   It maps the value to a color (`COMPLETED` green, `ERROR` red, `MISSING` gray, everything else the
   pulsing blue in-progress treatment) and to its translated label via
   `useTranslations("status")`. An unrecognised value must render the raw string rather than a
   missing-key crash or an empty pill — `api` should never send one, and a blank badge would hide
   the fact if it did.

5. **`src/components/downloads/DownloadsPanel.tsx`** — delete the local `statusBadgeClass`, render
   `StatusBadge`. Then replace the plain progress cell with the bars: the download bar always, the
   compression bar **only when `download.compressionEnabled` is true** (REQ-6/AC-4), each with its
   percentage beside it via the existing `formatProgress`. A `null` percentage renders the bar's
   track with no fill and `—` as the text — a torrent absent from the client is a renderable row,
   never a spinner (NFR-4).

6. **`src/components/shows/SeasonAccordion.tsx`** — delete its `statusBadgeClass`, render
   `StatusBadge` for `episode.status`. The episode's value now arrives already normalized; the
   component makes no judgement about it.

7. **`src/components/movies/Movie.tsx` and `src/components/shows/Show.tsx`** — the meta line
   currently concatenates the raw `{movie.status}` / `{show.status}` beside the year and language.
   Render the translated label there (REQ-9). Whether it becomes a `StatusBadge` or stays inline
   text is a visual call; the requirement is only that it is translated and drawn from the same
   catalog. **`Show.status` will read *Falta* for every series** — that is `api`'s known gap, out of
   scope by explicit request, and not something to work around here.

## Contract obligations

Consumed from `../spec.md` § GraphQL Contract Delta, read-only:

```graphql
status: String!             # one of the eight normalized values
downloadProgress: Float     # RENAMED from `progress`. 0..100, null when unknown
encodeProgress: Float       # NEW. 0..100, null when the source has no ProcessJob
compressionEnabled: Boolean!# NEW
```

The eight values and what each means are tabled in `../spec.md`; that table is the authority for
which color and which label each gets. `Movie.status` and `Episode.status` now carry the same eight.
`Show.status` does not change behaviour.

**Error conditions: none are added by this feature.** The existing ones on this surface stay exactly
as they are and this slice keeps handling them as it does today —
`errors.download.not_a_torrent` and `errors.download.torrent_client_rejected` through
`translateGraphQLError`, with the panel's per-row `startErrorDefault`/`stopErrorDefault`/
`deleteErrorDefault` fallbacks. Do not route status *values* through the error catalog; they are
display copy, not keyed errors.

The one failure mode this slice must actively handle is the non-error one: `downloadProgress`,
`encodeProgress`, `downloadSpeed` and `torrentState` arriving `null` is a **normal, renderable
state** (`022` REQ-9/REQ-10), not a loading state and not an error.

## Tests

**No tests, and the reason is structural**: this service has no test file, no runner and no `test`
script, and `services/web/CLAUDE.md` is explicit that introducing one is its own decision deserving
its own spec — not a side effect of a feature task. Do not add Vitest or Playwright here.

The gates that do apply: the typecheck, Biome **on the files touched only** (the repo carries
~1519 pre-existing errors, so a repo-wide `biome check` proves nothing), the production build, and
`scripts/check-messages.mjs` for catalog parity. The real verification for this slice is the manual
pass in `../plan.md` § Verification, steps 2-6 — AC-1, AC-2, AC-4, AC-6 and AC-10 are all things a
person opens a page and sees.

`scripts/check-messages.mjs` is the one automated check that will catch the most likely mistake in
this slice: eight keys added to `en.json` and seven to `es.json`.

## Done when

```bash
bin/cli web npx --no tsc --noEmit
bin/npm web run build
bin/cli web node scripts/check-messages.mjs
```

0 typecheck errors, build exits 0, catalog parity clean. Then the manual pass in `../plan.md`,
which is the only place AC-1 and AC-2 — the two bugs that produced this spec — are actually proven.
