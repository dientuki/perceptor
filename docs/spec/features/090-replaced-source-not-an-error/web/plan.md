---
title: A Replaced Source Is Not An Error — web slice
service: web
last_updated: 2026-10-08
status: Implemented
---

# PLAN: A Replaced Source Is Not An Error — `web` (`web/plan.md`)

## Scope

`web` consumes one new field and changes what a row looks like and offers. That is the entire
slice: select `retiredAt`, render a neutral "replaced" mark when it is set, and withhold the start
and stop controls for that row.

`web` decides **nothing** about retirement. It does not infer a replaced row from `lastError`, from
`errorKey`, or from a status string — `api` answers `retiredAt` and that is the only signal.
Critically, it also does not need to touch status handling at all: a retired row arrives with
`status: "COMPLETED"`, so `lib/status-tone.ts`, `StatusBadge.tsx` and `DownloadsPanel.tsx`'s filter
bucketing already place it in `Completed` and paint it green. REQ-8 is satisfied by *not* editing
them. If you find yourself adding a case to `statusTone` or to the panel's `TONE_BUCKET`, stop —
that is the ninth-status-value mistake `../plan.md` § Contract Freeze forbids.

Writes are confined to `services/web/` and this directory. Anything else is a stop-and-report.

## Files

| File | New / Modified | What changes |
| :-- | :-- | :-- |
| `src/types/downloads.ts` | Modified | `retiredAt: string \| null` on the `Download` interface |
| `src/actions/downloads.ts` | Modified | `retiredAt` in the `DOWNLOAD_FIELDS` fragment |
| `src/components/downloads/DownloadRow.tsx` | Modified | The mark, and the two withheld controls |
| `messages/en.json`, `messages/es.json` | Modified | One new key under `downloads.panel` |

No new component. The mark is a few elements inside the row's existing target cell, not a file of
its own — `053-downloads-panel-repair`'s one-renderable-component-per-file rule is about splitting
components that exist, not about manufacturing one for a chip.

## Existing code to reuse

- **`src/actions/downloads.ts`'s `DOWNLOAD_FIELDS`** — the single fragment behind all five download
  queries and mutations (`movieDownloads`, `showDownloads`, `downloads`, `downloadStart`,
  `downloadStop`). Adding the field once there is the whole data change; there is no second
  selection set to find.
- **`src/components/ui/badge/Badge.tsx`** — already used by `DownloadsPanel.tsx` for the filter
  chips. Use it for the mark with a neutral colour (`light` or `info`), never `error` and never
  `warning`: the entire point of the feature is that this is not a failure. Do not hand-roll a
  `<span>` with Tailwind colour classes beside a component that exists.
- **`src/components/downloads/DownloadRow.tsx`'s existing `canStart` / `isControllable`** — the two
  conditions that already gate the start and stop buttons. Extend them; do not add a third
  parallel flag.
- **`messages/{en,es}.json` under `downloads.panel`** — display copy for this panel lives here, not
  under `errors`, which is for keyed errors from `api` (`services/web/CLAUDE.md`). `es` keeps the
  Rioplatense register of its neighbours.

## Steps

1. **Type and fragment.** `retiredAt: string | null` on the `Download` interface — the file's
   header says it is exactly as wide as the schema, so keep the comment convention of its
   neighbours — and `retiredAt` in `DOWNLOAD_FIELDS`.
2. **Copy.** One key under `downloads.panel`, `en` → `Replaced`, `es` → `Reemplazada`. One key, not
   one per surface: the same mark serves `/downloads` and a title's own list, which are the same
   component.
3. **The mark.** In `DownloadRow.tsx`, when `download.retiredAt != null`, render the badge in the
   target cell alongside the release title. A retired row has no `lastError`, so
   `DownloadErrorLine` stops being mounted on its own — do not add a condition to suppress it, and
   do not touch `DownloadErrorLine.tsx`.
4. **The controls.** `canStart` and `isControllable` must both be false for a retired row (REQ-5).
   The delete button is gated on `download.owned` alone and stays exactly as it is — it is the only
   way left to remove the row and whatever the torrent client still holds for it.

## Contract obligations

Consumed from `../spec.md` § GraphQL Contract Delta, read-only:

- `Download.retiredAt: DateTime` — arrives as an ISO string or `null`. Non-null means the source
  was replaced after delivering its file.
- A retired row arrives with `status: "COMPLETED"`, `lastError: null`, `retryable: false`. Render
  accordingly; do not defend against other combinations.
- **The error condition this slice owes a path for:** `downloadStart` on a retired source answers
  `409` with `extensions.i18n.key = error.download.retry_replaced`. `web` already handles it —
  `translateErrorKey` resolves the key (`errors.download.retry_replaced`, present in both
  catalogs), and `DownloadRow`'s `REFRESH_ON_KEYS` already lists it, so a stale row that is clicked
  before a refresh shows the message and re-renders itself. Verify both still hold once the button
  is hidden; the hiding is the first line of defence, not the only one.

## Tests

**Nothing in this slice is owed a test under Article IX, and the reason is specific rather than
convenience.** Every failure mode here is loud or visible:

- A missing or misspelled field in `DOWNLOAD_FIELDS` fails the GraphQL query outright, and the
  interface change fails `tsc`.
- A missing catalog key renders as the raw key path on screen — `web`'s existing next-intl
  behaviour, immediately visible in the manual pass.
- A control rendered when it should not be is caught by AC-4's UI half, and is backed server-side
  by `api`'s refusal regardless, which **is** tested.

There is no derivation, no state machine and no silent wrong answer in this slice. If the
implementation grows one, that is the signal that logic landed on the wrong side of the boundary —
stop and report rather than writing a test to cover it here.

## Done when

```bash
bin/cli web npx --no tsc --noEmit
bin/npm web run test
bin/comments web
```

Do **not** run `bin/npm web run build` while the dev stack is up — it overwrites the dev server's
`.next` and un-hydrates every page.
