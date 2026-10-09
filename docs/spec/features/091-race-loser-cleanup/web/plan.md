---
title: The Race Loser Sweep Actually Sweeps — web slice
service: web
last_updated: 2026-10-08
status: Approved
---

# PLAN: The Race Loser Sweep Actually Sweeps — `web` (`web/plan.md`)

## Scope

`web` consumes one new field. It selects `lostRace`, hides the **start** control for a row that has
it, keeps the **stop** control, and renders a neutral "Descartada" mark on that row. Three
components already share `DownloadRow`/`DownloadsPanel` — `/downloads`, a film's detail page and a
series' detail page — so this lands in one place and shows up in all three.

It is **not** changing the panel's filter buckets or `statusTone`: a loser reports `PAUSED`, which
already tones as `progress` and counts under `working`, and `statusTone` backs every status badge in
the application. It is not adding an error line — `lostRace` is not an error and `lastError` stays
null for these rows. It is not deciding when a loser disappears; `api` deletes the row and the
existing `router.refresh()` is what makes it vanish.

Writes are confined to `services/web/` and this directory.

## Files

| File | New / Modified | What changes |
| :-- | :-- | :-- |
| `services/web/src/types/downloads.ts` | Modified | `lostRace: boolean` on the hand-retyped `Download` |
| `services/web/src/actions/downloads.ts` | Modified | `lostRace` added to the selection set |
| `services/web/src/components/downloads/DownloadRow.tsx` | Modified | `canStart` gains `&& !download.lostRace`; the "Descartada" mark |
| `services/web/messages/en.json` | Modified | `Discarded` |
| `services/web/messages/es.json` | Modified | `Descartada` |

## Existing code to reuse

- `components/downloads/DownloadRow.tsx`'s `canStart` / `isControllable` pair — `canStart` is the
  Play gate and the only one that changes; `isControllable` is the Stop gate and must be left
  exactly as it is (REQ-6: a loser whose stop call failed is still downloading and stopping it by
  hand is the user's only remedy).
- `components/downloads/DownloadErrorLine.tsx` — the precedent for a per-row line under the title,
  and the thing the mark must **not** be: that component renders an error with error styling. The
  mark is its neutral sibling, rendered in the same slot in the first `<td>`, in the muted
  `text-gray-500 dark:text-gray-400` register the `releaseTitle` line already uses.
- `components/status/StatusBadge.tsx` and `lib/status-tone.ts` — untouched. The row keeps its
  `PAUSED` badge.
- `DownloadRow`'s `REFRESH_ON_KEYS`, which already lists `error.download.retry_superseded` — the
  fallback if Play is ever rendered when it should not be: the action's refusal triggers
  `router.refresh()` and the row corrects itself. Nothing to add.
- `actions/downloads.ts`'s existing selection set — one more field in the same block as `retryable`.
  There is no codegen, so an omission here is a silent `undefined` at runtime, not a type error.

## Steps

1. Add `lostRace: boolean` to the `Download` type in `types/downloads.ts`, beside `retryable`.
2. Add `lostRace` to the GraphQL selection set in `actions/downloads.ts`, beside `retryable`.
3. In `DownloadRow.tsx`, change `canStart` so a `lostRace` row never offers Play, for both arms of
   the existing conditional (an `ERROR` row that also lost is still not startable). Leave
   `isControllable` and the Stop button untouched.
4. In the same component's first `<td>`, render the mark when `download.lostRace` is true, in the
   muted register, beside where `lastError` would render.
5. Add the catalog entry under the existing `downloads.panel` namespace in both `messages/en.json`
   and `messages/es.json` — `Discarded` / `Descartada`. Keep the key ordering the files already use;
   `bin/cli web node scripts/check-messages.mjs` is the gate.

## Contract obligations

From `../spec.md` § GraphQL Contract Delta, read-only:

- `Download.lostRace: Boolean!` — non-null on every `Download`, including the ones returned by
  `downloadStart` and `downloadStop`. True means another source of that target has already won, so
  this row will never be processed. It is **not** an error: `lastError` is null and `status` is
  `PAUSED`.
- `downloadStart` on such a row answers `409` with `error.download.retry_superseded`, message
  `Otra fuente de este título ya se está procesando`. The key is already in both catalogs and
  already in `REFRESH_ON_KEYS`; `startDownloadAction`'s existing error handling covers it with no
  change. The happy path is not the only path this component must handle, but in this case the
  failure path already works — verify it, do not rebuild it.
- `lostRace` can flip back to false without any user action (REQ-8, when the winner's own encode
  fails). The component must therefore read it per render and must not cache it, memoize it into
  state, or derive a sticky "discarded" flag of its own.

## Tests

Nothing in this slice fails silently. `canStart` is a boolean gate on a visible button, the mark is
visible text, and the refusal path already has its `REFRESH_ON_KEYS` safety net exercised by the
existing rows. Under Article IX none of that is owed a test, and this service's suite has no
component-rendering precedent to extend.

The slice is verified by the manual pass in `../plan.md` § Verification, steps 2 and 4 — Play absent
and Stop working on a loser, then Play back once its winner fails. That reversal is the part worth
clicking rather than asserting.

## Done when

```bash
bin/cli web npx tsc --noEmit
bin/cli web node scripts/check-messages.mjs
bin/comments web
```

`bin/npm web run build` only with the dev stack down (root `CLAUDE.md`).
