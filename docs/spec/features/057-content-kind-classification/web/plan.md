---
title: Content kind classification — web slice
service: web
last_updated: 2026-09-14
status: Implemented
---

# PLAN: Content kind classification — `web` (`web/plan.md`)

## Scope

This slice makes a title's content kind visible and correctable: one control on `/movies/[id]` and
the same control on `/shows/[id]`, two server actions behind it, and the catalog copy for the three
values. It also has a hard obligation it cannot skip — `isLiveAction` is being **removed** from the
schema by the `api` slice, and both existing detail queries select it today
(`src/actions/movies.ts:76`, `src/actions/shows.ts:92`). Leaving either in place makes the whole
query fail at runtime with no compile error anywhere (`../spec.md` NFR-6).

Not this slice: the derivation, the enum, the mutations' guards (`api`), and anything about how the
value changes an encode (`worker`). Writes are confined to `services/web/` and this directory
(`.claude/agents/web.md`).

## Files

| File | New / Modified | What changes |
| :-- | :-- | :-- |
| `src/actions/movies.ts` | Modified | `Movie` type + `GET_MOVIE_QUERY`: `isLiveAction` → `contentKind`; new `setMovieContentKindAction` |
| `src/actions/shows.ts` | Modified | `Show` type + query: `isLiveAction` → `contentKind`; new `setShowContentKindAction` |
| `src/types/media.ts` | Modified | the `ContentKind` union (`"LIVE_ACTION" \| "ANIME" \| "CGI"`) and its ordered value list, beside the existing `MEDIA_TYPE` |
| `src/components/media/ContentKindSelect.tsx` | New | the one control, used by both detail pages |
| `src/components/movies/Movie.tsx` | Modified | renders `ContentKindSelect` beside the existing short `Switch` |
| `src/components/shows/Show.tsx` | Modified | renders the same control |
| `messages/en.json`, `messages/es.json` | Modified | a `contentKind` namespace with the three labels, plus the control's label under `movies.detail`/`shows.detail` |

## Existing code to reuse

- `src/components/form/Select.tsx` — the project's `<select>`, already used by
  `settings/GeneralPanel.tsx` and `settings/MediaServerFields.tsx`. It takes `options`, `value` or
  `defaultValue`, `onChange` and `disabled`. Do not hand-roll a dropdown and do not reach for
  `MultiSelect.tsx` (one value, not a set).
- `Movie.tsx`'s short-toggle block (`src/components/movies/Movie.tsx:92-166`) — the exact pattern
  for a per-title write from a client component: local state seeded from the prop,
  `useTransition`, an error string rendered in `text-error-500` beside the control, and the stored
  value restored on refusal. The `key`-remount trick exists only because `Switch` owns its display
  state internally; `Select` accepts a controlled `value`, so this control reverts by setting state
  back — **do not copy `shortSwitchKey`** where a controlled value does the job (Article X).
- `setMovieShortAction` (`src/actions/movies.ts:117-145`) — the shape both new actions copy: a plain
  async server function returning `{ error } | { success: true }`, `fetchGraphQL` in a `try` with
  `errors.network.connectionFailed` as the transport fallback, then `translateGraphQLError` for the
  server's refusals. Not `useActionState` — there is no form.
- `src/components/status/StatusBadge.tsx` — the precedent for "a small shared display mapping from
  an api enum to translated copy, in one component both detail pages render", including keeping the
  labels in their own top-level catalog namespace rather than under `errors`.
- `src/components/media/` — where a component both detail pages use belongs (`MediaCard.tsx`'s
  neighbourhood), not inside `movies/` or `shows/`.

## Steps

1. `src/types/media.ts`: add the `ContentKind` union and the ordered list of its three values
   (`LIVE_ACTION`, `ANIME`, `CGI`) that the control maps over — one source for the option order, so
   the two pages cannot drift.
2. `src/actions/movies.ts` / `src/actions/shows.ts`: rename the selected field in both queries and
   both local types. **Verify by grep that no other query still names `isLiveAction`.**
3. `messages/en.json` + `messages/es.json`: a top-level `contentKind` namespace with the three
   labels (`es`: `Live action`, `Anime`, `CGI / Animación 3D` — keep the existing Rioplatense
   register), plus `contentKindLabel` under both `movies.detail` and `shows.detail`. Both catalogs in
   the same commit — `scripts/check-messages.mjs` is the gate.
4. `src/components/media/ContentKindSelect.tsx`: props `value: ContentKind` and an
   `onSave(kind): Promise<{ error: string } | { success: true }>`; renders `Label` + `Select`,
   disabled while a transition is pending, showing the refusal message beside itself and restoring
   the previous value on failure. Exactly one renderable export (web CLAUDE.md § "One renderable
   component per file").
5. `src/actions/movies.ts`: `setMovieContentKindAction(movieId, contentKind)`; `src/actions/shows.ts`:
   `setShowContentKindAction(showId, contentKind)`. Each selects only `{ id }` back.
6. Wire the control into `Movie.tsx` (beside the short toggle) and `Show.tsx` (the same block; a
   series has no short toggle to sit beside).

## Contract obligations

Consumed from `../spec.md` § GraphQL Contract Delta, hand-retyped with no codegen:

- `Movie.contentKind` / `Show.contentKind` — `ContentKind!`, one of three literal strings. Both
  detail queries select it; neither selects `isLiveAction` any more.
- `setMovieContentKind(movieId: Int!, contentKind: ContentKind!): Movie!` and
  `setShowContentKind(showId: Int!, contentKind: ContentKind!): Show!` — the enum argument is sent as
  an **unquoted GraphQL enum value**, i.e. as a variable typed `ContentKind!`, never as a `String`
  (a quoted string is rejected by the server's own argument validation).

Every refusal in that table must reach the screen, not just the happy path:

| Refusal | What this slice does |
| :-- | :-- |
| `error.media.type_disabled` (403) | render the translated message beside the control, restore the stored value |
| `error.movie.not_found` / `error.show.not_available` (404) | same — the title may have been removed from the caller's library in another tab |
| `error.auth.unauthenticated` (401) | the existing `redirectToClearSession` path in `fetchGraphQL`'s callers, unchanged |
| transport failure | `errors.network.connectionFailed`, the fallback `setMovieShortAction` already uses |

The delta is read-only. If it is wrong, stop and report — do not adapt it here.

## Tests

This service has no test suite (`services/web/CLAUDE.md`), so nothing is owed under Article IX here
and none is added. The two gates that stand in for it are `bin/npm web run build` (which typechecks
the whole App Router graph) and `scripts/check-messages.mjs` for catalog drift. The one failure this
slice *can* produce silently — a query still selecting the removed `isLiveAction` — is covered by the
repository-wide grep in `../plan.md` § Verification, not by a test file.

## Done when

```bash
bin/cli web npx --no tsc --noEmit
bin/npm web run build
bin/cli web node scripts/check-messages.mjs
grep -rn "isLiveAction" services/web/src
```

0 typecheck errors, the build exiting 0, no `en`/`es` drift, and the grep printing nothing. Then, on
a running stack: open a film and a series detail page, change the control, reload, and see the new
value hold; and confirm the control renders the derived value for a title registered after the `api`
slice landed.
