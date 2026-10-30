---
title: In-app indexer setup — web slice
service: web
last_updated: 2026-10-30
status: Approved
---

# PLAN: In-app indexer setup — `web` (`web/plan.md`)

## Scope

`web` renders the indexer list in Settings → Torrent manager and the "Add indexer" modal, reused on
`/first-step`, and calls `api`'s four operations through server actions. It does **not** filter,
rank or decide anything about which indexers exist — the catalog arrives already filtered and the
order is `api`'s (alphabetical); `web` renders it as given. It adds no sidebar entry and no Settings
tab (REQ-11), and leaves `IndexerSetupGuide` and its screenshots unchanged (REQ-13).

Writes are confined to `services/web/` and this directory.

## Files

| File | New / Modified | What changes |
| :-- | :-- | :-- |
| `services/web/src/types/indexer.ts` | Modified | `IndexerMediaCategory`, `IndexerDefinition`, `ConfiguredIndexer` |
| `services/web/src/actions/indexer.ts` | Modified | `getIndexerCatalogAction(search)`, `getConfiguredIndexersAction()`, `addIndexerAction(definitionName)`, `removeIndexerAction(id)` — all returning a result union, never throwing |
| `services/web/src/components/indexers/IndexerSection.tsx` | New | Client component: loads and lists configured indexers, remove per row, hosts `AddIndexerButton` |
| `services/web/src/components/indexers/AddIndexerButton.tsx` | New | Button + `AddIndexerModal`; `router.refresh()` after a successful add |
| `services/web/src/components/indexers/AddIndexerModal.tsx` | New | Search field (debounced), catalog list, per-row state |
| `services/web/src/components/indexers/IndexerCatalogRow.tsx` | New | One catalog entry: name, language, category chips, FlareSolverr note, Add control with idle / adding / added / failed |
| `services/web/src/components/indexers/RemoveIndexerModal.tsx` | New | Confirmation naming the indexer |
| `services/web/src/components/settings/TorrentManagerPanel.tsx` | Modified | Renders `IndexerSection` below the indexer API key field |
| `services/web/src/app/(dashboard)/first-step/page.tsx` | Modified | Renders `AddIndexerButton` above `IndexerSetupGuide` |
| `services/web/messages/en.json`, `es.json` | Modified | New `indexers` namespace; `errors.indexer.{definition_not_allowed,test_failed,flaresolverr_missing,not_found}` |

## Existing code to reuse

- `src/actions/indexer.ts` / `src/actions/tmdb-lists.ts` — server-action shape; `toActionError` (`src/lib/graphql-error.ts`) for the `{ ok: false, error }` branch, as `removeTmdbListAction` does. Copy that, not a new variant.
- `src/components/ui/modal` (`Modal`) — the shared modal; `src/components/lists/RemoveTmdbListModal.tsx` is the reference for a confirm-to-remove dialog with an inline error.
- `src/components/settings/TorrentManagerPanel.tsx` — its torrent-group section is the precedent for acting immediately outside the panel's Save button, with an inline `text-error-500` error.
- `src/components/ui/badge/Badge.tsx` — category chips.
- `router.refresh()` as in `SettingsForm.tsx` / `MediaServerFields.tsx` — re-runs `(dashboard)/layout.tsx`, which re-reads `indexerStatus` for the sidebar and `/first-step`'s notice (REQ-14).
- `services/web/CLAUDE.md` § Small conventions — raw `<input>` for the controlled search field; 44×44 hit areas below `md`; `text-base`/`text-theme-sm` only; ids are `string` in types, `Number(...)` at the call site for `removeIndexer(id: Int!)`.

## Steps

1. Types in `src/types/indexer.ts`, hand-copied from the spec's SDL.
2. The four actions in `src/actions/indexer.ts`. Reads return `{ ok: true, data } | { ok: false, error }`
   rather than throwing, because they are called from client components and an unreachable
   Prowlarr must render inline (NFR-6). `addIndexerAction` returns the `ConfiguredIndexer`;
   `removeIndexerAction` returns `{ ok: true }`.
3. `IndexerCatalogRow.tsx`, `AddIndexerModal.tsx`, `AddIndexerButton.tsx`. The modal fetches on
   open and on search (≈300 ms debounce, ignore out-of-order responses); an entry with
   `configured: true` renders as added with no Add control; per-row failure shows that row's
   translated error and leaves other rows usable; a load failure replaces the list with the error.
4. `RemoveIndexerModal.tsx` and `IndexerSection.tsx`. The section loads on mount; on
   `error.indexer.not_found` from remove it shows the message and reloads the list (AC-13); after
   any successful add (via `AddIndexerButton`'s callback) or remove it reloads and calls
   `router.refresh()`.
5. Mount `IndexerSection` in `TorrentManagerPanel` below the API key field, and `AddIndexerButton`
   on `/first-step` above `IndexerSetupGuide` (no change to the guide).
6. Messages in both catalogs (`es` in the Rioplatense register): section title, empty state, add
   button, modal title, search placeholder, category chip labels, FlareSolverr note, row states,
   remove confirmation, and the four error keys with the spec's copy. No tracker name anywhere,
   including placeholders and examples (NFR-1).

## Contract obligations

Consumes exactly `../spec.md` § GraphQL Contract Delta. Per error:

| Error | Where it can arrive | What `web` does |
| :-- | :-- | :-- |
| `error.auth.admin_required` | any | Not expected — both mount points are admin-only pages that 404 first; if it arrives, render it inline like any error |
| `error.indexer.unavailable` | all four | Inline in the section (list load / remove) or modal (catalog load / that row's add); page stays rendered |
| `error.indexer.definition_not_allowed` | `addIndexer` | That row → failed with the message |
| `error.indexer.test_failed` | `addIndexer` | That row → failed with the message; other rows usable |
| `error.indexer.flaresolverr_missing` | `addIndexer` | That row → failed with the message |
| `error.indexer.not_found` | `removeIndexer` | Message in the section, list reloaded |

The delta is read-only; if it is wrong, stop and report.

## Tests

None — `web` has no test toolchain and this slice must not add one (`services/web/CLAUDE.md`
§ Tests). The gate is the typecheck, Biome, the message parity script and the manual pass in
`../plan.md` § Verification.

## Done when

```bash
bin/cli web npx --no tsc --noEmit
bin/npm web run lint
bin/comments web
bin/cli web node scripts/check-messages.mjs
```

All pass, and the manual pass's Settings and `/first-step` steps render as described.
