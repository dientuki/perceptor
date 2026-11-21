---
title: Grouped Provenance Tags — web slice
service: web
last_updated: 2026-11-20
status: Implemented
---

# PLAN: Grouped Provenance Tags — `web` (`web/plan.md`)

## Scope

`web` adds the library tag migration block to Settings → Environment (REQ-12, REQ-18, REQ-19):

- the explanation and the button, with a confirmation dialog;
- the running state, with `processed / total`, counts per outcome and a refresh control;
- the last result, with its failures listed;
- the two new keyed errors.

It also shows `error.libraryTags.busy` wherever it already shows `error.subtitleEmbed.busy`. That
needs only catalog entries, since the error display is keyed.

`web` does not poll (REQ-18). It never sees a container path, never reads a tag, and does nothing
for the encode or embed tag changes, which are invisible to the UI.

## Files

| File | New / Modified | What changes |
| :-- | :-- | :-- |
| `services/web/src/types/library-tags.ts` | New | hand-typed `LibraryTagMigration`, `LibraryTagMigrationFailure`, the two string unions |
| `services/web/src/actions/library-tags.ts` | New | `getLibraryTagMigration()` (query) and `startLibraryTagMigrationAction()` (mutation) |
| `services/web/src/components/settings/LibraryTagMigrationBlock.tsx` | New | the client block: explanation, button, confirm modal, running/finished views, refresh |
| `services/web/src/components/settings/EnvironmentPanel.tsx` | Modified | renders the block below the existing content, only when `isAdmin` |
| `services/web/src/components/settings/SettingsForm.tsx` | Modified | passes the migration and `isAdmin` through to `EnvironmentPanel` |
| `services/web/src/app/(dashboard)/settings/page.tsx` | Modified | fetches `getLibraryTagMigration()` beside `getEnvironmentInfo()` |
| `services/web/messages/en.json`, `es.json` | Modified | `settings.environment.libraryTags.*` copy; `errors.libraryTags.*` keys (`migration_running`, `busy`, `file_missing`, `write_failed`, `verify_failed`) |

## Existing code to reuse

- `src/actions/media-server.ts` `resyncMediaServerIndexAction`: the exact shape for a button-driven
  server function: `fetchGraphQL`, `redirectIfUnauthenticated`, `toActionError`, and a
  `{ status } | { error, errorKey }` result. Copy that shape; do not invent a second one.
- `src/components/settings/MediaServerFields.tsx`: a settings block that calls such an action and
  then `router.refresh()`.
- `src/components/ui/modal/index.tsx` and `src/components/lists/RemoveTmdbListModal.tsx`: the
  confirmation-modal pattern.
- `src/components/ui/badge/Badge.tsx`: outcome counts.
- `src/lib/format.ts` `formatDateTime(iso, monthFirst)`: `startedAt`/`finishedAt` in the user's date
  order (`096`). Settings stamps are always 24-hour.
- The settings page's existing admin gating: Settings is admin-only (`029`), so a non-admin never
  reaches the tab. Gate the block on the same `isAdmin` the page already has, rather than adding a
  new check.

## Steps

1. **Types and actions.**
   - `getLibraryTagMigration()` returns `LibraryTagMigration | null`. On error it logs and returns
     `null`, so the Environment tab renders without the block's history rather than failing the
     page.
   - `startLibraryTagMigrationAction()` returns `{ migration } | { error, errorKey }`.
2. **`LibraryTagMigrationBlock`:**
   - **Idle** (null, or the last run `COMPLETED`): explanation text and a "Migrar etiquetas de la
     biblioteca" button that opens a confirmation modal. Confirming calls the action. On success
     it runs `router.refresh()`. On `error.libraryTags.migration_running` it shows the translated
     message inline under the button and refreshes. Any other error shows its translated message.
   - **Running:** `processed / total`, the five counts, a "Actualizar" button (`router.refresh()`),
     `startedAt`. The start button is disabled.
   - **Finished:** the five totals, `finishedAt`, and the failures list (host path plus the
     translated `reasonKey`, falling back to a generic key for an unknown one). Shown until the
     next run starts.
3. **Wire into `EnvironmentPanel`** through `SettingsForm` and `page.tsx`.
4. **Catalogs**, `en` and `es` (Rioplatense register, as the rest of `es.json`). Spanish strings are
   exactly the spec's error table:
   - `Ya hay una migración de etiquetas en curso.`
   - `Se están reescribiendo las etiquetas de este archivo; probá de nuevo en un momento.`
   - `No se encontró el archivo.`
   - `No se pudo escribir el archivo.`
   - `El archivo reescrito no coincide con el original; se dejó sin cambios.`

## Contract obligations

Consumed from `../spec.md` (v0.3.1):

- `libraryTagMigration: LibraryTagMigration` (nullable). Select every field the block renders,
  including `failures { path reasonKey }`. A missing selection compiles fine and renders
  `undefined`.
- `startLibraryTagMigration: LibraryTagMigration!`.
- Errors, and what `web` does with each:
  - `error.auth.admin_required`: cannot normally happen, since Settings is admin-only. If it does,
    show the translated message.
  - `error.libraryTags.migration_running`: inline message plus refresh.
  - `error.libraryTags.busy`: may now come back from every acquisition entry point and embed
    action. The keyed error display already covers it once the catalog has the key. Verify the
    torrent, magnet and upload modals and the embed dialog render it rather than a generic error.
  - Per-file `reasonKey`s: translated in the failures list.

## Tests

`web` has no test runner and `services/web/CLAUDE.md` forbids adding one as a side effect of a feature
task, so no component test is owed. The block is verified by typecheck and by the live pass (AC-10).
Catalog parity: `node scripts/check-messages.mjs` (a plain script) must pass with the new keys.

## Done when

```bash
bin/cli web npx --no tsc --noEmit
bin/cli web node scripts/check-messages.mjs
bin/comments web
```

All pass. Do **not** run `bin/npm web run build` while the dev stack is up.
