---
title: Source deletion — web slice
service: web
last_updated: 2026-09-05
status: Approved
---

# PLAN: Source deletion — `web` (`web/plan.md`)

## Scope

Two changes, both in the downloads panel. The delete button becomes available on **every** row
instead of torrent rows only, and the confirmation modal says what will actually be removed for
the row it was opened on — a torrent and its files, or an uploaded file — plus a warning when an
encode is currently running and will be stopped.

Explicitly **not** this slice: anything about what deletion does (the api owns all of it), the
mutation's shape (`downloadDelete` is unchanged, so `src/actions/downloads.ts` needs no edit), and
any new refresh or polling behaviour — `router.refresh()` after a successful delete is already
there and stays.

Writes are confined to `services/web/` and this directory.

## Files

| File | New / Modified | What changes |
| :-- | :-- | :-- |
| `services/web/src/components/downloads/DownloadsPanel.tsx` | Modified | Splits the single `isControllable` gate: start/stop stay behind it, delete moves outside it. |
| `services/web/src/components/downloads/DeleteDownloadModal.tsx` | Modified | Kind-dependent message, plus the encode-in-progress warning. |
| `services/web/messages/en.json` | Modified | New keys under `downloads.deleteModal`. |
| `services/web/messages/es.json` | Modified | The same keys, Rioplatense register. |

## Existing code to reuse

- **`src/actions/downloads.ts` — `deleteDownloadAction`.** Unchanged. It already calls the
  mutation, runs `redirectIfUnauthenticated` on an auth error and resolves everything else through
  `toActionError`, which is what turns `extensions.i18n.key` into translated copy. It now gets
  called for rows with no `infoHash`; nothing about the function has to change for that.
- **`DownloadsPanel.tsx`'s `isControllable` comment.** It states the house rule for this panel:
  the test is `download.infoHash != null` — **not** `kind` (`SourceKind` has two torrent values and
  there is no codegen to catch a wrong literal) and not `progress`. Keep that rule and keep that
  reasoning when the gate is split: `isControllable` keeps its meaning and keeps guarding
  start/stop, and the modal's own torrent-vs-upload branch uses the same `infoHash != null` test.
  Do not start branching on `kind`.
- **`DeleteDownloadModal.tsx`'s existing structure** — `useTranslations("downloads.deleteModal")`,
  the `t.rich("message", { target, b })` call with its bold chunk renderer, the `ERROR_CLASS`
  banner, the `useEffect` that clears a stale error on reopen, and the `isPending` button state.
  All of it stays; only the message selection changes.
- **`messages/{en,es}.json` and `scripts/check-messages.mjs`.** Every key must exist in both files
  — that script fails non-zero on drift, and it is the only gate this service has for the catalog.

## Steps

1. **`DownloadsPanel.tsx`** — in `DownloadRow`, keep `isControllable` guarding the Play and Square
   buttons, and render the Trash button unconditionally. The simplest shape is the existing
   `<div className="flex items-center gap-2">` always rendered, with the two control buttons inside
   a `{isControllable && (<>…</>)}`. Do not duplicate the button markup into two branches.
2. **`DeleteDownloadModal.tsx`** — choose the message key from `download.infoHash != null`:
   `messageTorrent` or `messageUpload`. Keep `t.rich` and the `target`/`b` arguments identical for
   both. When `download.status === "ENCODING"`, render an additional line
   (`encodingWarning`) below the message telling the user the transcode in progress will be
   stopped. `status` is already on the `Download` type and already carries the normalized
   eight-value vocabulary (`043-pipeline-status-normalization`), so compare the literal string —
   there is no enum to import.
3. **`messages/en.json` / `messages/es.json`** — under `downloads.deleteModal`, replace `message`
   with `messageTorrent` and `messageUpload`, and add `encodingWarning`. Suggested Spanish, keeping
   the existing register verbatim where it already exists:
   - `messageTorrent`: `¿Estás seguro de que querés eliminar <b>{target}</b>? El torrent y sus
     archivos se van a eliminar permanentemente.` *(today's `message`, unchanged)*
   - `messageUpload`: `¿Estás seguro de que querés eliminar <b>{target}</b>? El archivo que subiste
     se va a eliminar permanentemente.`
   - `encodingWarning`: `La compresión en curso se va a detener.`
   English is the implementer's to write in the same register as the neighbouring keys. Delete the
   old `message` key from **both** files — a key left in one and not the other is exactly what
   `check-messages.mjs` exists to catch.

## Contract obligations

From `../spec.md` § GraphQL Contract Delta, read-only:

- `downloadDelete(mediaSourceId: Int!): Boolean!` — **unchanged**. The GraphQL document in
  `src/actions/downloads.ts` does not move.
- Two errors can come back, and both must already be handled — confirm, do not assume:
  - `error.source.not_found` → the row is gone or is not the caller's. Rendered in the modal's
    error banner through `toActionError`; the panel is refreshed by the user, not automatically.
  - `error.download.torrent_client_rejected` (with a `{status}` param) → shown in the same banner.
    The modal stays open and the row stays in the table, because nothing was deleted (AC-9).
- **`error.download.not_a_torrent` can no longer come back from this mutation.** Its catalog entry
  stays — `downloadStart`/`downloadStop` still raise it, and those are still gated behind
  `isControllable`.
- The mutation returning `false` (rather than erroring) keeps its existing fallback,
  `downloads.panel.deleteErrorDefault`.

## Tests

**None owed.** This service has no test runner and adding one is explicitly out of bounds for a
feature task (`services/web/CLAUDE.md`: "Do not add Vitest or Playwright as a side effect of a
feature task"). Nothing in this slice can fail silently in the Article IX sense: a missing button,
the wrong confirmation sentence or an untranslated key are all visible on the screen the moment the
modal opens, and `scripts/check-messages.mjs` fails non-zero on catalog drift between the two
files. AC-7 covers the button's presence from outside.

## Done when

```bash
bin/npm web run build
bin/cli web node scripts/check-messages.mjs
```

The build exits 0 (it typechecks) and the catalog check exits 0. Then, by eye: an uploaded-file row
in a film's downloads panel shows the trash button and no play/stop buttons, and its confirmation
dialog talks about a file rather than a torrent.
