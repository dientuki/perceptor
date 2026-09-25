---
title: Title Refresh — web slice
service: web
last_updated: 2026-09-25
status: Implemented
---

# PLAN: Title Refresh — `web` (`web/plan.md`)

## Scope

`web` adds a Refresh button to the film and series detail pages, two server actions that call
`refreshMovie`/`refreshShow`, and the `en`/`es` copy for the button, its result and the new error key.
It does **not** decide anything about what gets refreshed or how status changes — that is all `api`.
No status is recomputed client-side; after a refresh the page reloads its own data.

Writes are confined to `services/web/` and this directory.

## Files

| File | New / Modified | What changes |
| :-- | :-- | :-- |
| `src/components/media/RefreshTitleButton.tsx` | New | Client component: button, pending state, inline result/error, `router.refresh()` on completion |
| `src/actions/movies.ts` | Modified | `REFRESH_MOVIE_MUTATION` + `refreshMovieAction(id)` |
| `src/actions/shows.ts` | Modified | `REFRESH_SHOW_MUTATION` + `refreshShowAction(id)` |
| `src/types/media.ts` | Modified | `TitleRefreshResult` union, beside `TitleRemovalResult` |
| `src/components/movies/Movie.tsx` | Modified | Mount the button in the actions row, next to `RemoveTitleButton` |
| `src/components/shows/Show.tsx` | Modified | Same, in the series actions row |
| `messages/en.json`, `messages/es.json` | Modified | `errors.media.refresh_in_progress`; `media.refreshTitle.*` |

## Existing code to reuse

- `src/actions/movies.ts` `removeMovieAction` — the exact template for the action: `fetchGraphQL`
  in try/catch → `errors.network.connectionFailed`; `redirectIfUnauthenticated(errors)`;
  `translateGraphQLError(errors[0])`; missing `data` → connection-failed. Return
  `{ success: true, catalog, mediaServer, promoted, demoted } | { error }`. `revalidatePath` the
  listing paths the title appears in (`/movies`, `/shorts` for a film; `/shows` for a series) — the
  listings show status too.
- `src/components/media/RemoveTitleButton.tsx` — sibling shape: a client component the
  server-rendered `Show` page can mount, taking the bound action as a prop
  (`onRefresh={refreshMovieAction.bind(null, movie.id)}`).
- `src/components/ui/button/Button.tsx` — `size="sm" variant="outline"`, a `lucide-react` icon
  (`RefreshCw`) as the other action buttons do.
- `src/lib/graphql-error.ts` `translateGraphQLError` — the only error path; no hand-mapping of keys.
- `useTransition` + `useRouter().refresh()` — the pending/reload pattern already used by the
  detail-page toggles (`Movie.tsx`'s short/contentKind handlers).
- Errors and results render **inline** under the actions row (web `CLAUDE.md`: never `alert()`).

## Steps

1. Add `TitleRefreshResult` to `src/types/media.ts`, with `catalog: "DONE" | "FAILED"` and
   `mediaServer: "DONE" | "SKIPPED" | "FAILED"` typed as string unions.
2. Add `refreshMovieAction`/`refreshShowAction` with their mutation documents selecting all four
   fields.
3. Build `RefreshTitleButton`: disabled + spinning icon while pending; on `{ error }` show the
   translated error in the error colour and re-enable; on success call `router.refresh()` and show one
   line composed from the result:
   - both `DONE`: "Actualizado" plus, when non-zero, promoted/demoted counts (ICU plural);
   - `mediaServer: SKIPPED`: the catalog line only — not a warning (AC-9);
   - any `FAILED`: a warning naming which step failed (catalog / media server), alongside whatever the
     other step reported (AC-7, AC-8).
4. Mount it in `Movie.tsx` and `Show.tsx`, before `RemoveTitleButton`.
5. Messages, `en` and `es` in lockstep (`es` in the existing Rioplatense register):
   `errors.media.refresh_in_progress` = "Ya se está actualizando este título, probá de nuevo en un
   momento" (spec copy); `media.refreshTitle.{button, done, promoted, demoted, catalogFailed,
   mediaServerFailed}`.

## Contract obligations

Consumes `refreshMovie(id: Int!)`/`refreshShow(id: Int!)` → `TitleRefresh { catalog mediaServer
promoted demoted }` exactly as in `../spec.md`; `id` is a `string` in `web`, wrapped with `Number()`.
Every error row in the spec is handled through `translateGraphQLError`:

- `error.movie.not_found` / `error.show.not_available` — shown inline (both catalog entries exist).
- `error.media.type_disabled` — shown inline (entry exists).
- `error.media.refresh_in_progress` — **new catalog entry**; shown inline, button re-enabled.
- `error.auth.unauthenticated` — `redirectIfUnauthenticated`.

`FAILED` outcomes are not errors: the mutation succeeded, and the page still reloads.

## Tests

None — `web` has no test toolchain and this feature does not introduce one (web `CLAUDE.md` § Tests).
The gate is the typecheck, the build, the messages parity script, and the manual pass in `../plan.md`.

## Done when

```bash
bin/cli web npx --no tsc --noEmit
bin/npm web run build
bin/cli web node scripts/check-messages.mjs
bin/cli web npx --no biome check src/components/media/RefreshTitleButton.tsx src/actions/movies.ts src/actions/shows.ts
```
