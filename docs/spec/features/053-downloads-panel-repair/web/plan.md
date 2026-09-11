---
title: Downloads panel repair — web slice
service: web
last_updated: 2026-09-11
status: Implemented
---

# PLAN: Downloads panel repair — `web` (`web/plan.md`)

## Scope

This service owns the panel's structure and geometry (REQ-5, REQ-7) and the rendering of the new
encode speed (REQ-9). It **applies** the one-component-per-file rule; it does not write it down.

It is **not** doing: anything about the `infoHash` casing (REQ-1..REQ-4 are entirely `api`-side and
invisible from here — the panel simply starts receiving the live values it already asks for),
nothing about where the speed comes from, and **no part of REQ-6**. Both halves of that requirement
are prose — `services/web/CLAUDE.md` and `.claude/agents/web.md` — and are a single `[docs]` task
owned by the orchestrator, per the tag convention in `docs/spec/features/_templates/tasks.md`. The
split this slice performs is what that task will cite.

Writes are confined to `services/web/` and this directory. If a task cannot be finished without
editing `services/api/`, stop and report.

## Files

| File | New / Modified | What changes |
| :-- | :-- | :-- |
| `services/web/src/components/downloads/DownloadRow.tsx` | New | `DownloadRow`, moved verbatim out of `DownloadsPanel.tsx`, plus the speed cell |
| `services/web/src/components/downloads/DownloadProgressBar.tsx` | New | The bar markup the row draws twice, and the single home of REQ-7's geometry |
| `services/web/src/lib/format.ts` | New | `formatSpeed`, `formatProgress` (moved) and `formatEncodeSpeed` (new) |
| `services/web/src/components/downloads/DownloadsPanel.tsx` | Modified | Loses its second component and both helpers; the progress `<th>` gets a fixed width |
| `services/web/src/types/downloads.ts` | Modified | `encodeSpeed: number \| null` |
| `services/web/src/actions/downloads.ts` | Modified | `encodeSpeed` added to `DOWNLOAD_FIELDS` |

No `messages/{en,es}.json` change. See § Contract obligations for why.

## Existing code to reuse

- **`src/components/status/StatusBadge.tsx`** — the single status pill. The moved row keeps
  rendering it; do not inline a variant.
- **`src/components/ui/button/Button.tsx`** — the row's three action buttons already use it and
  `title={t(...)}`. Moved unchanged.
- **`src/actions/downloads.ts`'s `DOWNLOAD_FIELDS`** — one shared selection constant behind all four
  documents (`movieDownloads`, `showDownloads`, `downloadStart`, `downloadStop`). Adding
  `encodeSpeed` there is **one** edit, not four. This is the highest-risk step in the slice: an
  unselected field arrives `undefined`, renders `—` forever, and nothing fails to compile.
- **`src/types/downloads.ts`** — already a hand-copy of `Download` with a comment saying it is
  exactly as wide as the schema, not guessed from usage. Keep that property: add `encodeSpeed`
  immediately after `downloadSpeed`, typed `number | null`, with a one-line comment naming the unit.
- **The existing `formatSpeed`/`formatProgress` in `DownloadsPanel.tsx`** — moved to `src/lib/`
  unchanged in behaviour. `formatProgress`'s comment ("progress arrives 0..100 already — do not
  multiply by 100 again") moves with it; it is load-bearing.

## Steps

1. **`src/lib/format.ts`** — move `formatSpeed` and `formatProgress` out of the `.tsx` verbatim, and
   add `formatEncodeSpeed(speed: number | null): string`. The new one is **not** a variant of
   `formatSpeed`: its input is a dimensionless multiplier, not bytes per second, so it renders
   `1.23x` and must never reach the `B/s`/`KB/s` ladder. Same `—` for `null` as its sibling. `0` is a
   real multiplier at the start of an encode — render `0.00x`, never `—`; a falsy check here is the
   bug.
2. **`src/components/downloads/DownloadProgressBar.tsx`** — one component taking the 0..100 value (or
   `null`) and drawing the track, the fill and the percentage label. The row draws this twice today
   with duplicated markup, which is how the two bars came to disagree. REQ-7's geometry lives here
   and nowhere else: the bar and its label are a two-column grid (`grid grid-cols-[1fr_auto]`), so
   the label's own width can never shorten the track, and the two instances in a row are identical by
   construction. `null` renders an empty track and `—`, never a spinner — existing behaviour, keep it.
3. **`src/components/downloads/DownloadRow.tsx`** — move `DownloadRow` out of `DownloadsPanel.tsx`
   into its own file (REQ-5). This is a **move**, not a rewrite (NFR-5). What must survive it,
   verbatim: the `isControllable = download.infoHash != null` gate and the comment explaining why it
   is not `kind`; the `rowError` state and its inline `text-error-500` rendering; the `line-clamp-1`
   on `releaseTitle`; the `startTransition` + `router.refresh()` shape of both handlers; the
   `compressionEnabled` gate on the second bar.
4. **`DownloadRow.tsx`, continued** — the Speed cell (REQ-9) picks by derived status, not by which
   value happens to be non-null: `download.status === "ENCODING"` renders
   `formatEncodeSpeed(download.encodeSpeed)`, anything else renders `formatSpeed(download.downloadSpeed)`.
   Branch on the status string because that is the value `api` derived deliberately; branching on
   `encodeSpeed != null` would work today and quietly change meaning the moment `api` has any reason
   to send both.
5. **`DownloadsPanel.tsx`** — now a single default export importing `DownloadRow`. Give the progress
   `<th>` a fixed width (`w-[14rem]`) so the column cannot be sized by the longest row's content —
   the other half of REQ-7. Keep the `<table>`: replacing it with a CSS grid was considered and
   rejected in `../plan.md` § Approach, and doing it here anyway is a stop-and-report.
6. **`src/types/downloads.ts`** and **`src/actions/downloads.ts`** — add `encodeSpeed` to the type and
   to `DOWNLOAD_FIELDS`. Both, or the field is `undefined` at runtime with a clean typecheck.
7. **Do not touch the other files that violate REQ-5** — `users/UsersManager.tsx`,
   `shows/SeasonAccordion.tsx`, `settings/SchedulingPanel.tsx`, `settings/MediaServerFields.tsx`,
   `app/perceptor/page.tsx`. They are explicitly out of scope (`../spec.md` § Out of Scope), and the
   `[docs]` task that writes REQ-6 down records them as outstanding. Splitting one here, however
   tempting while the rule is fresh, is scope this slice does not have.

## Contract obligations

This service **consumes** `Download` exactly as declared in `../spec.md` § GraphQL Contract Delta.
The only change from what it already selects is one field:

```graphql
encodeSpeed: Float   # FFmpeg's realtime multiplier; 1.23 means 1.23x
```

Nullable, and `null` is a **normal renderable state** — not a loading state, not an error — exactly
as this service already treats `downloadSpeed`, `torrentState` and `encodeProgress`. It is non-null
only while that source has a job encoding right now.

It is a **different unit** from `downloadSpeed` (bytes per second). Never format one through the
other's function; that is the entire reason they are two fields.

There is no codegen (`docs/spec/graphql-contract.md`): the `fetchGraphQL<T>` parameter and
`DOWNLOAD_FIELDS` are hand-copies and nothing checks them.

No new error condition reaches this service. This feature adds none to the delta's table, so the
existing `toActionError`/`translateGraphQLError` handling in `src/actions/downloads.ts` is complete
as-is and needs no new `errors.*` catalog key.

No `messages/{en,es}.json` change at all: the multiplier renders as a format identifier (`1.23x`),
the same string in every locale — the same treatment `src/lib/torrent-ranking.ts`'s criterion labels
already get, and deliberately not a catalog entry. The `speedHeader` key already exists and covers
both units. Leave `scripts/check-messages.mjs` with nothing to do.

The delta is read-only. If a field you need is not in it, it does not exist — report it, do not
query for it hopefully (Article VIII).

## Tests

**None, and that is this service's standing policy**, not an omission: `services/web` has no test
file, no runner and no `test` script, and `services/web/CLAUDE.md` is explicit that introducing
Vitest or Playwright here is its own decision with its own spec. Do not add one as a side effect of
this feature.

The quality gate is the typecheck, Biome on the files touched (never on the repo — `biome check`
reports ~1519 pre-existing errors across the template), and actually opening the panel. The two
failures this slice could produce are both visible there rather than silent: an unselected
`encodeSpeed` shows an empty Speed column during an encode (AC-6), and a lost piece of the moved row
shows as a missing button or a missing error line (NFR-5).

## Done when

```bash
bin/cli web npx --no tsc --noEmit
bin/npm web run build
```

0 typecheck errors and the build exiting 0 — report the before and after error counts, since the
"Current state" baseline in `services/web/CLAUDE.md` is 0 and any new error is yours.

Then actually exercise it, and say what you clicked and what you saw: open a `/movies/<id>` with a
live download and confirm the percentage, the speed and the status render; compare the bar widths
between a short-labelled row and a long-labelled one (AC-5); and watch the Speed column while an
encode runs and after it finishes (AC-6, AC-7).
