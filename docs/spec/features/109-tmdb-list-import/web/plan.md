---
title: TMDB List Import — web slice
service: web
last_updated: 2026-10-28
status: Implemented
---

# PLAN: TMDB List Import — `web` (`web/plan.md`)

## Scope

`web` adds the "Listas de TMDB" section to `/preferences` (REQ-13): attach by id or URL, the list of
attached lists with their last import and last error, detach behind a confirmation, and the notice
shown while the `import_lists` task is disabled. It also gives the new task a label and description
in the existing scheduler Settings and adds its enabled key to the settings action's boolean list.
It does **not** parse list references, talk to TMDB, or decide anything about importing — `api`
does all of that and answers with i18n keys.

Writes are confined to `services/web/` and this directory.

## Files

| File | New / Modified | What changes |
| :-- | :-- | :-- |
| `src/types/preferences.ts` | Modified | `TmdbList` type |
| `src/types/media.ts`, `src/actions/media.ts` | Modified | `listImportEnabled` on `MediaCapabilities` and in its query |
| `src/actions/tmdb-lists.ts` | New | `getTmdbLists`, `addTmdbListAction`, `removeTmdbListAction` |
| `src/components/preferences/TmdbListsSection.tsx` | New | the section |
| `src/components/preferences/RemoveTmdbListModal.tsx` | New | the confirmation |
| `src/app/(dashboard)/preferences/page.tsx` | Modified | fetch lists, render the section in its own card below the form |
| `src/actions/settings.ts` | Modified | `schedule_import_lists_enabled` in the boolean keys |
| `messages/en.json`, `messages/es.json` | Modified | section copy, the four new error keys, the task's label/description |

## Existing code to reuse

- `src/lib/graphql-client.ts` `fetchGraphQL` and `src/lib/graphql-error.ts` `translateGraphQLError`
  — the pattern in `src/actions/preferences.ts`, including `redirectToClearSession` on the read and
  `redirectIfUnauthenticated` on the mutations.
- `src/app/(dashboard)/preferences/page.tsx` already loads `getMediaCapabilities()` — read
  `listImportEnabled` from it; no new request.
- `src/context/DateFormatContext.tsx` + `formatDateTime` in `src/lib/format.ts` for
  `lastImportedAt` (`096`).
- `src/components/ui/modal/` and `src/components/media/RemoveTitleModal.tsx` as the confirmation
  pattern.
- The card wrapper markup already in `preferences/page.tsx`, so the section matches the form above.
- The scheduler task copy lives under the existing `tasks.<id>.label/description` keys beside
  `acquire_movies`; the scheduler UI is driven by `api`'s task list, so only copy is added.

## Steps

1. Types and the `listImportEnabled` field in the capabilities query.
2. `src/actions/tmdb-lists.ts`: the query and both mutations; actions return `{ ok, error }` with the
   translated message, and call `revalidatePath("/preferences")` on success.
3. `TmdbListsSection`: input + "Vincular" button (pending state, error inline under the input,
   input keeps its value on error, cleared on success); one row per list — name linking to
   `https://www.themoviedb.org/list/<tmdbListId>` (new tab), "Última importación" or "Todavía no se
   importó", translated `lastError` when present, "Desvincular" button; the disabled-task notice at
   the top when `listImportEnabled` is false.
4. `RemoveTmdbListModal`: states that titles already imported stay in the library; on
   `error.tmdbList.not_found` refresh and show the message as a toast.
5. Page wiring, settings boolean key, `en`/`es` messages (Rioplatense register; task label
   "Importar listas", matching the notice text).

## Contract obligations

Consumes exactly `../spec.md` § GraphQL Contract Delta:

- `tmdbLists { id tmdbListId name lastImportedAt lastError }`, `addTmdbList(reference)` returning
  the same shape, `removeTmdbList(id): Boolean!`, `mediaCapabilities { listImportEnabled }`.
- Errors on attach — `error.tmdbList.invalid_reference`, `error.tmdbList.unreadable`,
  `error.tmdbList.already_attached`, `error.media.catalog_unauthorized`,
  `error.media.catalog_unavailable`: shown inline under the input.
- Error on detach — `error.tmdbList.not_found`: refetch and toast.
- `lastError` on a row is one of `error.tmdbList.unreadable`, `error.media.catalog_unauthorized`,
  `error.media.catalog_unavailable`, translated through the same catalog; an unknown key falls back
  the way `translateGraphQLError` already does.

The delta is read-only. If it is wrong, stop and report.

## Tests

None owed. Every behaviour in this slice is visible on the page: a wrong field name fails the
query loudly, a missing translation shows the raw key, and every error path is in the manual pass
(AC-8, AC-10, AC-12, AC-13). `web` has no test runner today and this slice is no reason to add one.

## Done when

```bash
bin/cli web npx --no tsc --noEmit
bin/npm web run lint
bin/comments web
```

All pass, and the manual pass in `../plan.md` § Verification renders every state on desktop and at
mobile width.

## Amendment 0.2.0

1. `TmdbList.itemCount: number | null`; `getTmdbList(id)` in `actions/tmdb-lists.ts` selecting
   `id tmdbListId name itemCount lastImportedAt lastError movies { id title overview posterUrl
   releaseDate isShort } shows { id title overview posterUrl releaseDate }`, `redirectToClearSession`
   (it runs during render).
2. `AppSidebar.tsx`: "Mis listas" (`ListVideo` from `lucide-react`), in `baseNavItems`, after the
   series entry, for every user.
3. `app/(dashboard)/lists/page.tsx`: breadcrumb title, the attach form, the disabled-task notice and
   the rows — move `TmdbListsSection`/`RemoveTmdbListModal` to `components/lists/`, the name links to
   `/lists/<id>`, a separate TMDB link, the item count (`—` when null). Remove the card from
   `/preferences/page.tsx`. `revalidatePath("/lists")` instead of `/preferences`.
4. `app/(dashboard)/lists/[id]/page.tsx` + segment `not-found.tsx` (copy `/movies/[id]`'s param
   validation, metadata and 404): the list name as the page title and a grid of films, shorts and
   series. Films and series are merged and sorted by title; each card renders through `MediaCard`
   with its own `mediaType` and the type badge (series), the short badge (short); no `MediaList`
   fork — a new `components/lists/ListTitles.tsx` maps items to `MediaCard` inside `MediaList`'s grid
   classes. Empty state when the list holds none of the caller's titles.
5. Copy in `en`/`es` (`nav.lists`, `pages.lists.*`, the moved section's keys); `check-messages`.

## Amendment 0.3.0

Reuse: the short switch in `components/movies/Movie.tsx` (`Switch` from `components/form/switch/`,
the `key`-remount-on-refusal trick, `useTransition`) and `setMovieShortAction`'s shape in
`actions/movies.ts`.

1. `autoAcquire` in `GET_MOVIE_QUERY` and `GET_SHOW_QUERY` (detail queries only — the listings must
   not select it, it is a field resolver), and on the `Movie`/`Show` types.
2. `setMovieAutoAcquireAction` in `actions/movies.ts`, `setShowAutoAcquireAction` in
   `actions/shows.ts`, returning `{ success: true } | { error, errorKey? }` through `toActionError`.
3. `components/media/AutoAcquireSwitch.tsx` (client): props `kind: "movie" | "show"`, `id`,
   `initial`; label "Descargar automáticamente"; reverts and shows the translated error inline on a
   refusal. Rendered under the poster in `Movie.tsx` and in `Show.tsx` (a Server Component — it just
   renders the client component), **only when `status !== "COMPLETED"`**.
4. Copy in `en`/`es` (`media.autoAcquire.label`, a one-line hint that manual search still works);
   `check-messages`.

Done when: tsc shows only the 7 known `Calendar.tsx` errors; Biome clean on new/changed files;
`check-messages` parity; `bin/comments web` PASS; the switch seen on a `MISSING` film and series and
absent on a `COMPLETED` one.
