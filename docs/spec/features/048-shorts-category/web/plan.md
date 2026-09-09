---
title: Shorts Category — web slice
service: web
last_updated: 2026-09-07
status: Approved
---

# PLAN: Shorts Category — `web` (`web/plan.md`)

## Scope

`web` renders the category: the third capability flag read once per request and threaded down, the
`/shorts` route and its sidebar entry, the `/movies` ↔ `/shorts` split, the shorts badge on search
results, the "add as short" affordance, the reclassification toggle on the film detail page, and the
two new controls in Settings → Media Manager.

It decides **nothing**. Whether shorts are available is one boolean `api` computes
(`capabilities.shortsEnabled` is already `movies_enabled && shorts_enabled` — never re-derive it
here); which films are shorts is a server-side filter argument, never a `.filter()` over a full
list; and where a file is written is not `web`'s business at all. Every refusal in
`../spec.md` § GraphQL Contract Delta must be handled, because the controls that would prevent it are
hidden, not absent — an administrator can flip a switch between render and submit.

Writes are confined to `services/web/` and this directory. Anything else is a stop-and-report.

## Files

| File | New / Modified | What changes |
| :-- | :-- | :-- |
| `src/types/media.ts` | Modified | `MediaCapabilities` gains `shortsEnabled: boolean` |
| `src/actions/media.ts` | Modified | `shortsEnabled` in the capabilities query; `addMedia` gains `asShort` |
| `src/actions/movies.ts` | Modified | `getMovies(isShort?)`, `isShort` on the `Movie` interface and the detail query |
| `src/actions/shorts.ts` *or* `src/actions/movies.ts` | Modified | `setMovieShortAction` — put it beside the movie actions, not in a new file |
| `src/actions/settings.ts` | Modified | `path_shorts` into `EDITABLE_KEYS`, `shorts_enabled` into `BOOLEAN_KEYS` |
| `src/app/(dashboard)/shorts/page.tsx` | New | Listing route, `notFound()` while shorts are off |
| `src/app/(dashboard)/movies/page.tsx` | Modified | Passes `isShort: false` while shorts are on |
| `src/components/movies/Shorts.tsx` | New | Twin of `Movies.tsx`, one argument different |
| `src/components/movies/Movies.tsx` | Modified | Takes the `isShort` argument from the page |
| `src/components/movies/Movie.tsx` | Modified | The reclassification toggle |
| `src/layout/AppSidebar.tsx` | Modified | **Shorts** entry between Movies and Series |
| `src/components/media/MediaCard.tsx` | Modified | Shorts badge |
| `src/components/media/MediaList.tsx` | Modified | Threads whatever the badge needs |
| `src/components/search/MediaResultAction.tsx` | Modified | "Add as short" affordance |
| `src/components/search/MultiSearchResults.tsx`, `SearchContainer.tsx` | Modified | Pass `shortsEnabled` + the `asShort` add path |
| `src/app/(dashboard)/search/page.tsx`, `movies/add`, `[id]/page.tsx` | Modified | Thread capabilities down |
| `src/components/settings/MediaManagerPanel.tsx` | Modified | Shorts switch + `path_shorts` picker, both gated on the movies switch |
| `src/components/settings/SettingsForm.tsx` | Modified | Two more props into the panel |
| `messages/en.json`, `messages/es.json` | Modified | Nav entry, badge, toggle, page copy, two error keys |

## Existing code to reuse

- `src/actions/media.ts::getMediaCapabilities` — already `cache()`-wrapped, already the NFR-5
  one-read-per-render answer, already refusing to fall back to "everything disabled" on failure.
  Add the field to its query; do not add a second capability fetch anywhere.
- `src/app/(dashboard)/shows/page.tsx` — the `capabilities.<x>Enabled → notFound()` gate, verbatim.
  `/shorts` is the same page with a different flag.
- `src/components/movies/Movies.tsx` + `MediaList`/`MediaCard` — the whole listing. `/shorts` passes
  `mediaType={MEDIA_TYPE.MOVIE}` so cards keep linking to `/movies/[id]` (spec REQ-9); there is no
  `/shorts/[id]` and none is to be added.
- `src/actions/languages.ts::setMovieAudioMandatoryAction` — the exact shape `setMovieShortAction`
  copies: a plain server function (not `useActionState`), `redirectIfUnauthenticated` then
  `translateGraphQLError`, returning `{ error } | { success: true }`.
- `src/components/movies/Movie.tsx`'s existing per-title switch wiring (`setMovieAudioMandatory`
  bound to the film id) — the toggle sits in the same panel and follows the same pattern.
- `src/components/settings/MediaManagerPanel.tsx` — the `Switch` + hidden-input pairing and the
  `disabled={!moviesOn}` `PathPicker` gate already used by the movies/series rows. The shorts row is
  a third instance, gated on `moviesOn && shortsOn`.
- `src/lib/graphql-error.ts::translateGraphQLError` — every error string. Never render `api`'s raw
  message; never invent a key.

## Steps

1. **Types + capability.** `shortsEnabled` on `MediaCapabilities` and in
   `MEDIA_CAPABILITIES_QUERY`. Nothing else in this slice may compute it.
2. **Sidebar.** A third conditional entry in `AppSidebar`'s `baseNavItems`, between Movies and
   Series, gated on `capabilities.shortsEnabled`, with a `nav.shorts` catalog key and a distinct
   `lucide-react` icon.
3. **Listing split.** `getMovies(isShort?: boolean)` adds the argument to `GetStoredMovies` only when
   given (keep its existing "log and return `[]`" failure behaviour — there is no
   `app/(dashboard)/error.tsx`). `/movies` passes `false` while shorts are enabled and nothing while
   they are not; `/shorts` passes `true` behind the same `notFound()` gate `/shows` uses.
   `Shorts.tsx` is a thin twin of `Movies.tsx` with its own empty-state copy.
4. **The badge.** `MediaCard` renders a shorts badge when the item is flagged and the surrounding
   grid says shorts are enabled — beside the existing type badge on a mixed grid, and on its own in
   the `/movies/add` grid, which has no type badge today. Add `isShort` to the search-result type in
   `src/types/search.ts` and select it in the two search queries in `src/actions/media.ts`.
5. **Add as short.** `addMedia(tmdbId, type, asShort?)` in the action; `MediaResultAction` gains an
   optional secondary affordance rendered only when shorts are enabled **and** the row is a film and
   not owned. Both `MultiSearchResults` and `SearchContainer` render this component, so the change
   lands once and both screens get it — thread `shortsEnabled` from their pages rather than fetching
   it in the client component.
6. **The toggle.** `setMovieShortAction(movieId, isShort)` beside the other per-title actions;
   `Movie.tsx` renders a `Switch` for it only while shorts are enabled, reverting its optimistic
   state and showing the translated error on `{ error }`. The film detail page reads
   `getMediaCapabilities()` alongside its existing `Promise.all` and passes the flag down.
7. **Settings.** `MediaManagerPanel` gains the shorts `Switch` + hidden input and a `path_shorts`
   `PathPicker`, both non-interactive while the movies switch is off (`disabled={!moviesOn}` on the
   switch, `disabled={!moviesOn || !shortsOn}` on the picker). `SettingsForm` passes
   `shortsEnabled`/`shortsFolder` from `getSettingValue`. Register `path_shorts` in `EDITABLE_KEYS`
   and `shorts_enabled` in `BOOLEAN_KEYS` — a boolean omitted from the latter is never submitted,
   which is a switch that silently does nothing.
8. **Catalogs.** Add every new string to **both** `messages/en.json` and `messages/es.json`,
   including `errors.media.shorts_disabled` and `errors.media.shorts_not_a_movie`. `es` keeps the
   Rioplatense register.

## Contract obligations

`web` consumes `../spec.md` § GraphQL Contract Delta as-is. What it owes beyond the happy path:

- **`error.media.shorts_disabled`** — reachable from both "add as short" and the detail toggle when
  an administrator flips the switch between render and submit. Add: surface it in the same inline
  error slot the failed-add message already uses, and do **not** silently retry as a plain add — the
  user asked for a short. Toggle: revert the switch and show the message.
- **`error.media.shorts_not_a_movie`** — unreachable by construction, since the affordance is only
  rendered on film rows. Handle it as a plain translated error rather than a special case; if it
  ever appears, the affordance leaked onto a series card and the generic path makes that visible.
- **`error.media.type_disabled`** — already handled by the `045` movies-disabled path; `/shorts` and
  the toggle inherit it.
- **`error.movie.not_found`** — `setMovieShort` on a film the caller does not own. Same "not
  available to you" wording already used across the detail screens; do not add a second string.
- **`MediaCapabilities.shortsEnabled`** is read, never computed. **`movies(isShort:)`** is sent as
  `false`/`true`/omitted; a client-side `.filter()` over a full list is a contract violation
  (spec REQ-8) even though it would look identical on screen.

The delta is read-only. If it is wrong, stop and report — do not adapt it locally.

## Tests

**None, and the reason is structural: this service has no test runner** (`services/web/CLAUDE.md` —
`018-ui-i18n` deliberately kept one out; `scripts/check-messages.mjs` is a plain script, not a
suite). Nothing in this slice can fail silently in a way a `web` test would catch anyway: a missing
catalog key is caught by `check-messages.mjs`, a wrong query shape fails loudly at request time, and
the two behaviours that *could* be silently wrong — the capability `&&` and the listing filter —
are owned by `api` and tested there.

Run `bin/cli web node scripts/check-messages.mjs` after touching the catalogs; a key added to `en`
and forgotten in `es` is exactly the drift it exists to catch.

## Done when

```bash
bin/npm web run lint
bin/npm web run build
bin/cli web node scripts/check-messages.mjs
```

`biome check` clean, `next build` exits 0, and the catalog check exits 0. Then, by hand: `/shorts`
404s with shorts off and lists with them on; `/movies` stops showing flagged films only while shorts
are on; the badge, the "add as short" button and the detail toggle all appear and disappear with the
flag; and Settings → Media Manager greys the shorts row while Movies is off.
