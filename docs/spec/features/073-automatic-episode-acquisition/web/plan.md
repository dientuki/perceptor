---
title: Automatic Episode Acquisition — web slice
service: web
last_updated: 2026-09-26
status: Implemented
---

# PLAN: Automatic Episode Acquisition — `web` (`web/plan.md`)

## Scope

`web` stops computing the release ranking and starts reading it. That is nearly the whole slice:
`searchTorrents` now returns each row's `ranking`, `candidate` and `candidateRank`, so
`SearchTorrent.tsx` filters and sorts on those instead of importing a comparator, and
`src/lib/torrent-ranking.ts` is **deleted** (REQ-1, AC-10). Everything the user sees must stay
exactly as it is: the default list, the "Best candidates" toggle, the per-row chips, the promotion
arrow, the text filter, the add flow and the replace confirmation (NFR-6).

The second, much smaller half: the new `acquire_episodes` scheduled task has to be savable and
readable from Settings → Scheduling. That tab already renders any task the API reports, so this is
one boolean key and two message strings — no new component.

`web` is **not** implementing the sweep, the ranking algorithm or the cutoff. Those are `api`'s,
in this same feature. Writes are confined to `services/web/`; anything else is a stop-and-report.

## Files

| File | New / Modified | What changes |
| :-- | :-- | :-- |
| `src/lib/torrent-ranking.ts` | **Deleted** | The comparator now lives in `api`. |
| `src/types/indexer.ts` | Modified | `ReleaseRanking`; `ranking`, `candidate`, `candidateRank` on `TorrentResult`. |
| `src/actions/indexer.ts` | Modified | `searchTorrentsAction` takes the optional target and selects the new fields. |
| `src/components/search/SearchTorrent.tsx` | Modified | Drops the ranking import and the input assembly; derives the candidate view from the response; passes the target to the action. |
| `src/actions/settings.ts` | Modified | `schedule_acquire_episodes_enabled` added to `BOOLEAN_KEYS`. |
| `messages/en.json`, `messages/es.json` | Modified | `acquire_episodes` label/description; the Spanish copy for `error.search.target_ambiguous`. |
| `src/components/media/RankingDebugPanel.tsx` | Modified (comment only, optional) | Its header comment points at `torrent-ranking.ts`, which will no longer exist. The panel itself renders preference inputs and needs **no** behavioural change. |

## Existing code to reuse

- `src/actions/indexer.ts` — the server-action shape (`fetchGraphQL`, `redirectIfUnauthenticated`,
  `translateGraphQLError`) is already correct. Extend the query and the signature; do not write a
  second action.
- `src/components/search/SearchTorrent.tsx` — the target is already resolved in this component
  (`AcquisitionTarget`, kinds `movie`/`season`/`episode`) and already carries the ids the action
  now needs. The query prefill, the title cleaning and the `showBest` state all stay.
- `src/lib/graphql-error.ts` — `translateGraphQLError` already renders a keyed error with params
  correctly (fixed under `059`). The new key needs a translation, not new plumbing.
- `src/components/settings/SchedulingPanel.tsx` — renders every task the API lists and already
  falls back with `t.has(...)` when a label is missing. **No change**: the new task appears on its
  own once `api` registers it.
- `src/actions/settings.ts` — `BOOLEAN_KEYS` is the list that makes a switch save. The other three
  `schedule_*_enabled` keys are the pattern.

## Steps

1. **Types.** Mirror `../spec.md` § GraphQL Contract Delta into `src/types/indexer.ts`: a
   `ReleaseRanking` type with the fourteen fields, `ranking: ReleaseRanking` non-optional,
   `candidate: boolean`, `candidateRank: number | null`. Retype it by hand, field for field — there
   is no codegen, and a name that does not match the schema fails at runtime with `undefined`, not
   at build.
2. **Action.** `searchTorrentsAction(query, target)` — where `target` is the same
   `{ movieId } | { seasonId } | { episodeId } | null` shape the component already knows — sends at
   most one id and selects the new fields alongside the existing ones. Keep the empty-query
   short-circuit and the existing error handling.
3. **Component.** Delete the `torrent-ranking` import, the `titleAudio`/`languageRequirement`/
   `preferredGroups`/`allowCinemaReleases` assembly and the `rankTorrentResults` call. `showBest`
   now selects `results.filter(r => r.candidate).sort((a, b) => a.candidateRank - b.candidateRank)`
   and `showBest === false` keeps `results` untouched, in the order the action returned them — the
   list the user sees today (`036` REQ-16 depends on that order surviving). The chips block already
   reads `res.ranking.*`; it loses its `"ranking" in res` guard, since every row now carries one,
   but must still render only under `showBest`.
   The `getPreferences()` effect, its `preferences` state and the `UserPreferences` import go with
   them: the ranking assembly is their only consumer (verified — every other reference in the file
   is inside the block being deleted), so leaving them behind would be a round trip per modal mount
   that feeds nothing. `api` now reads those same preferences server-side.
4. **Settings.** Add `schedule_acquire_episodes_enabled` to `BOOLEAN_KEYS`, and the
   `settings.scheduling.tasks.acquire_episodes` label/description to both message files. Suggested
   copy — en: "Acquire episodes" / "Searches for and downloads a release for newly aired episodes.";
   es: "Bajar episodios nuevos" / "Busca y descarga un release para los episodios recién
   estrenados." Keep the Rioplatense register of the surrounding Spanish strings.
5. **Error copy.** Add the Spanish string for `error.search.target_ambiguous` — `Indicá un solo
   destino de búsqueda`, matching `../spec.md`'s error table — beside the other `error.*` keys.
6. Run `scripts/check-messages.mjs`: `en` and `es` must stay at the same key count.

## Contract obligations

`web` consumes `searchTorrents` as `../spec.md` freezes it, and must handle **every** error row in
that table, not just the happy path:

- `error.indexer.unavailable` — already handled: the search throws, `searchError` renders, the modal
  stays open. Unchanged.
- `error.movie.not_found` / `error.season.not_found` / `error.episode.not_found` — now reachable
  from a *search*, not only from an add, because the query carries a target. Same treatment as the
  indexer error: render the translated message in `searchError` and leave the modal open. Do not
  swallow it into an empty result list — "no results" and "that title is not yours" must not look
  the same.
- `error.search.target_ambiguous` — unreachable from this UI (the component always has exactly one
  target) but it must translate, because an untranslated key renders as raw English. It needs a
  Spanish string, not a code path.

`candidateRank: null` is normal data for a vetoed or lower-tier row and must never be treated as an
error or coerced to `0`.

The delta is read-only. If a field does not match what `api` produces, stop and report — do not
adapt the type locally.

## Tests

**None owed.** `web` has no test suite (`services/web/CLAUDE.md`), and this slice adds no logic to
test: the algorithm it used to own is moving to `api`, where it gains a real spec
(`../api/plan.md` § Tests). The silent-failure risk this slice does carry — a hand-retyped field
name that does not match the schema — is not covered by a unit test in any case; it is caught by
the manual pass in `../plan.md` § Verification, which is why step 1 of AC-9 is "open the modal and
compare against today's behaviour".

## Done when

```bash
bin/cli web npx --no tsc --noEmit
bin/npm web run build
bin/cli web node scripts/check-messages.mjs
```

0 typecheck errors, the build exits 0, no `en`/`es` drift. Plus, for AC-10:

```bash
grep -rn "rankTorrentResults" services/web/src
```

returns nothing, and `services/web/src/lib/torrent-ranking.ts` no longer exists.
