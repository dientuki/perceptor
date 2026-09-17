---
title: Season Pack Acquisition UI — web slice
service: web
last_updated: 2026-09-17
status: Implemented
---

# PLAN: Season Pack Acquisition UI — `web` (`web/plan.md`)

## Scope

`web` puts search / import-file (disabled) / magnet buttons on each season accordion header, opens
the existing search and magnet modals against a whole season, calls `addTorrentToSeason` /
`addMagnetToSeason`, handles every refusal in the spec's error table, and adds the missing
translations. It does **not** derive any status — the episode `QUEUED` lift (REQ-7) is computed by
`api` and simply arrives in `show(id)`; `StatusBadge` already renders `QUEUED`. It does not wire
file import for a season (REQ-2, next spec) and does not touch the downloads panel.

Writes are confined to `services/web/` and this directory.

## Files

| File | New / Modified | What changes |
| :-- | :-- | :-- |
| `services/web/src/types/media.ts` | Modified | `AcquisitionTarget` gains a `"season"` branch; a file-import target type that excludes it; `AcquisitionResult` success branch narrowed (see step 2) |
| `services/web/src/lib/acquisition-target.ts` | New | the shared target label and "is completed" helpers |
| `services/web/src/actions/shows.ts` | Modified | `addTorrentToSeasonAction`, `addMagnetToSeasonAction` |
| `services/web/src/components/shows/SeasonAcquisitionButtons.tsx` | New | the three header buttons, one component |
| `services/web/src/components/shows/SeasonAccordion.tsx` | Modified | header restructure; one `activeTarget` for both episode and season |
| `services/web/src/components/search/SearchTorrent.tsx` | Modified | season query prefill, submit branch, helpers |
| `services/web/src/components/search/SearchTorrentModal.tsx` | Modified | label via helper |
| `services/web/src/components/import/importMagnetModal.tsx` | Modified | season submit branch, helpers |
| `services/web/src/components/import/importFileModal.tsx` | Modified | narrowed target type, label/completed via helpers |
| `services/web/src/actions/uploads.ts` | Modified | `createUploadTicketAction` takes the narrowed type |
| `services/web/messages/en.json`, `es.json` | Modified | missing error keys |

## Existing code to reuse

- `src/actions/shows.ts` `addTorrentToEpisodeAction` / `addMagnetToEpisodeAction` — the exact
  action shape to twin (`fetchGraphQL`, `redirectIfUnauthenticated`, `toActionError`), mutation
  documents selecting only `id`.
- `src/types/media.ts` episode branch — carries `showTitle`, `audioMandatory`, `audioLanguages`; the
  season branch carries the same three plus `season: Season` (import `Season` from
  `@/actions/shows`, never redeclare it).
- `SeasonAccordion.tsx` — already receives `showTitle`, `audioMandatory`, `audioLanguages` and
  already owns the three `useModal` pairs and the three modal instances; reuse them for the season
  target rather than rendering a second set.
- `SeasonAccordion.tsx` `EpisodeRow` — button sizes, variants, icons (`Search`, `FileVideo`,
  `Magnet` with `text-red-500`) and `t("searchButtonTitle")`/`importFileButtonTitle`/
  `addTorrentButtonTitle` titles: the season buttons use the same keys, no new UI copy.
- `src/components/ui/button/Button.tsx` — has `disabled`.
- `ReplaceWarning.tsx` and the `ALREADY_COMPLETED_KEYS` arrays — already contain
  `error.season.already_completed`; no change to the replace flow beyond feeding it a season.
- `shows.seasonAccordion.seasonLabel` (`Temporada {number}`) — the season half of the target label.

## Steps

1. **Types** (`src/types/media.ts`): add
   `{ kind: "season"; season: Season; showTitle: string; audioMandatory: boolean; audioLanguages: Language[] }`
   to `AcquisitionTarget`; export a `FileAcquisitionTarget = Exclude<AcquisitionTarget, { kind: "season" }>`.
2. **`AcquisitionResult`**: nothing reads `id`/`status` off a success today (verify with grep before
   changing). Narrow the success branch to `{ success: true }` so the season actions — whose
   `Season` has no status — return the same type without inventing a value. Existing actions keep
   compiling (spreading extra fields is allowed).
3. **Helpers** (`src/lib/acquisition-target.ts`): `isAcquisitionTargetCompleted(target)` — film/
   episode `status === "COMPLETED"`, season `season.episodes.some(e => e.status === "COMPLETED")`;
   and a label builder — film title; episode `Show S01E02` (current format, unchanged); season
   `Show` + the translated `seasonLabel`, received as an argument since `src/lib` cannot call hooks.
   Exhaustive `switch` on `kind` with no `default`, so a fourth kind fails to compile.
4. **Actions** (`src/actions/shows.ts`): `addTorrentToSeasonAction(seasonId, infoHash, urls,
   releaseTitle, force)` — `infoHash` sent as `string | null`, no `?? ''` — and
   `addMagnetToSeasonAction(seasonId, magnet, force)`. Both return `AcquisitionResult`.
5. **`importFileModal.tsx` / `createUploadTicketAction`**: take `FileAcquisitionTarget`; replace the
   local label and completed ternaries with the helpers.
6. **`SearchTorrentModal.tsx`**: label via the helper.
7. **`SearchTorrent.tsx`**: season prefill `${cleanShowTitle} S${pad(seasonNumber)}` using the same
   cleaning as the episode branch; `titleAudio` and `preferredGroups` treat `"season"` like
   `"episode"` (series preferences, `showTorrentGroups`); `submitTorrent` calls
   `addTorrentToSeasonAction` for a season; `isCompleted`/`targetLabel` via the helpers. Success
   keeps the modal open and calls `router.refresh()`, as for an episode (REQ-9).
8. **`importMagnetModal.tsx`**: season branch calls `addMagnetToSeasonAction`; `isCompleted`/label
   via the helpers. Success closes and refreshes, as today.
9. **`SeasonAcquisitionButtons.tsx`** (new, one exported component): props `onSearch`, `onMagnet`;
   renders search, a **disabled** import-file button (no handler), magnet — same order and styling
   as `EpisodeRow`.
10. **`SeasonAccordion.tsx`**: replace `activeEpisode` with `activeTarget: AcquisitionTarget | null`
    built by the episode handlers (as today) and by two new season handlers. Pass
    `activeTarget?.kind === "season" ? null : activeTarget` to `ImportFileModal`. Restructure the
    header so the toggle `<button>` (label + chevron) and `<SeasonAcquisitionButtons>` are
    **siblings** in a flex container — never buttons nested inside the toggle button (AC-1). Do not
    add any other component to this file.
11. **Messages**: add under `errors` in both `en.json` and `es.json`:
    `season.not_found` (`La temporada {id} no existe` / `Season {id} does not exist`),
    `magnet.already_attached`, `magnet.not_a_magnet`, `magnet.invalid_infohash`,
    `magnet.v2_unsupported` — English copied from `services/api/src/i18n/messages.en.ts` (read it,
    keep the same `{param}` names), Spanish in the existing Rioplatense register.

## Contract obligations

Consumes, per `../spec.md` § GraphQL Contract Delta:

- `addTorrentToSeason(seasonId: Int!, infoHash: String, urls: [String!]!, releaseTitle: String, force: Boolean): Season!` — select `id`.
- `addMagnetToSeason(seasonId: Int!, magnet: String!, force: Boolean): Season!` — select `id`.
- `Episode.status` may now read `QUEUED` for an episode with no source of its own; render it as is.

Errors, all through `toActionError` → `AcquisitionResult.error`/`errorKey`:

| Key | What `web` does |
| :-- | :-- |
| `error.season.already_completed` | show message inline, switch to replace, resend with `force: true` (already in `ALREADY_COMPLETED_KEYS`) |
| `error.season.not_found` | show translated message inline |
| `error.magnet.already_attached` | show translated message (with `{title}`) inline |
| `error.magnet.not_a_magnet` / `invalid_infohash` / `v2_unsupported` | show translated message inline (magnet modal) |
| `error.download.torrent_client_rejected` | show translated message inline |
| `error.indexer.no_infohash` | show translated message inline (search modal) |
| unauthenticated | `redirectIfUnauthenticated` |

The delta is read-only. If something is missing on the `api` side, stop and report.

## Tests

None owed: `web` has no test runner and adding one is out of scope (`services/web/CLAUDE.md` § Tests).
The silent failures here are covered by the type system instead — the `FileAcquisitionTarget`
narrowing (a season can never reach an upload) and the exhaustive `switch` in the helpers — plus
`check-messages.mjs` for translation parity and the manual pass in `../plan.md`.

## Done when

```bash
bin/cli web npx --no tsc --noEmit             # 0 errors
bin/npm web run lint                          # clean on touched files
bin/cli web node scripts/check-messages.mjs   # no en/es drift
bin/npm web run build                         # exits 0
grep -cE "^(export default )?function [A-Z]" services/web/src/components/shows/SeasonAcquisitionButtons.tsx   # 1
```
