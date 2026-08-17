---
title: AV1 Transcode — web slice
service: web
last_updated: 2026-08-17
status: Implemented            # Draft | Approved | Implemented
---

# PLAN: AV1 Transcode — `web` (`web/plan.md`)

## Scope

This slice is three language pickers and the server actions behind them: one on `/settings` for the
signed-in user's global preference, one on `/movies/<id>` and one on `/shows/<id>` for that title.
Each picker shows the **calling user's own** selection and nothing else.

It does **not** display, explain or expose the merge across owners. That is an encode-time concept
that never crosses the GraphQL boundary — a user must not see another user's choices, and there is
no field to read them from. It does not touch the encode, the CRF, or anything about how the file is
produced.

Writes are confined to `services/web/` and this directory. Anything else is a stop-and-report (see
`.claude/agents/web.md`).

## Files

| File | New / Modified | What changes |
| :-- | :-- | :-- |
| `services/web/src/actions/languages.ts` | New | `getLanguages()`, `setPreferredLanguagesAction`, `setMoviePreferredLanguagesAction`, `setShowPreferredLanguagesAction` |
| `services/web/src/types/languages.ts` | New | `Language` (`id`, `iso2`, `iso3`, `name`) |
| `services/web/src/components/settings/PreferredLanguagesCard.tsx` | New | The global picker — its own card, its own action, **not** part of `SettingsForm` |
| `services/web/src/app/(dashboard)/settings/page.tsx` | Modified | Renders the new card beside `SettingsForm`; fetches `getLanguages()` and the user's current selection |
| `services/web/src/components/media/LanguagePicker.tsx` | New | The shared multi-select + save control used by all three call sites |
| `services/web/src/components/movies/Movie.tsx` | Modified | Renders `LanguagePicker` for the film |
| `services/web/src/components/shows/Show.tsx` | Modified | Renders `LanguagePicker` for the series |
| `services/web/src/actions/movies.ts` | Modified | `getMovieById`'s document selects `preferredLanguages { id iso2 name }` |
| `services/web/src/actions/shows.ts` | Modified | `getShowById`'s document selects the same |
| `services/web/src/actions/auth.ts` | Modified | `getCurrentUser`'s `me` document selects `preferredLanguages { id iso2 name }` |

## Existing code to reuse

- **The server-action pattern in `src/actions/media-server.ts`** — `'use server'` on line 1, the
  document as a module-level SCREAMING_SNAKE `const`, the shape as `fetchGraphQL<T>`'s type
  parameter, errors read from `errors[0].message` with a Spanish fallback. `src/actions/languages.ts`
  copies it; do not invent a variant (`services/web/CLAUDE.md`).
- **`redirectToClearSession` vs `redirectIfUnauthenticated`** (`src/lib/auth-session.ts`) — pick by
  *caller context*, not by resemblance. `getLanguages()` is awaited during a Server Component's
  render (the settings page, both detail pages), where cookie mutation is illegal, so it uses
  `redirectToClearSession`. The three save actions are form actions, so they use
  `redirectIfUnauthenticated`. `getSettings`/`updateSettingsAction` in `src/actions/settings.ts` is
  the pair to copy, one of each in the same file.
- **`useActionState` form actions** — `(prevState, formData) => { error?: string } | { success: true }`,
  exactly as `updateSettingsAction` does. Errors render inline, never through `alert()`.
- **A raw `<input>`, not `@/components/form/input/InputField`** for anything controlled — that
  shared component takes `defaultValue` and not `value`. `PathPicker.tsx` is the reference.
- **`Button`** (`src/components/ui/button/Button.tsx`) for the save control. Never a bare styled
  `<button>`, and never a `bg-primary` class — this service's Tailwind theme only defines
  `--color-brand-*`.
- **`Movie.tsx` and `Show.tsx`** — already the two detail bodies, already receiving the full record.
  The picker slots into each; do not create a fourth detail component.
- **`id` is a `string` in this service's types** even where the GraphQL argument is `Int!`. Wrap
  with `Number(...)` at the call site, as `SearchTorrent.tsx` and `importMagnetModal.tsx` do.

## Steps

1. **Types and actions.** `src/types/languages.ts` for the `Language` shape;
   `src/actions/languages.ts` with the read (`getLanguages`, `redirectToClearSession` on error) and
   the three writes (`redirectIfUnauthenticated`, returning `{ error }` / `{ success: true }`).
2. **`LanguagePicker.tsx`.** One client component taking `options: Language[]`,
   `selected: Language[]` and an action, rendering a multi-select of `name` values and a save
   button, with inline error and a saved confirmation. All three call sites use it — the only thing
   that differs is which action is bound and whether an id is passed.
3. **The global card.** `PreferredLanguagesCard.tsx` wraps `LanguagePicker` with
   `setPreferredLanguagesAction`. Render it on `/settings` **as its own card**, not inside
   `SettingsForm`: that form posts through `updateSettings`/`EDITABLE_KEYS`, which is
   installation-wide key/value config, and this is a per-user preference. Do not add a key to
   `EDITABLE_KEYS` — there is no setting behind it.
4. **The settings page.** `page.tsx` already `Promise.all`s three reads; add `getLanguages()` and
   the user's own selection. The selection comes from `getCurrentUser()`'s `me` query, whose
   document gains `preferredLanguages { id iso2 name }` — one extra field on a call the dashboard
   layout already makes, not a second round trip.
5. **The two detail pages.** Add `preferredLanguages { id iso2 name }` to `getMovieById`'s and
   `getShowById`'s documents, extend the local `Movie`/`Show` types with the field, and render
   `LanguagePicker` in `Movie.tsx` and `Show.tsx` bound to the per-title action. `Show.tsx` is a
   Server Component today and the picker is a client component — the picker is a child, so the page
   stays a Server Component; do not add `"use client"` to `Show.tsx`.
6. **Do not touch the listings.** `getMovies()` and `getShows()` must **not** select
   `preferredLanguages`. It is a field resolver in `api`, so selecting it in a listing turns one
   query into one-per-row. Nothing about the `/movies` and `/shows` screens changes in this feature.

## Contract obligations

Consumed from `../spec.md` § GraphQL Contract Delta — read-only:

- `Query.languages: [Language!]!` — the only source for the picker options. Never hard-code a
  language list in this service, the same rule `mediaServerClients` established.
- `User.preferredLanguages` on the `me` query; `Movie.preferredLanguages`, `Show.preferredLanguages`
  on the two detail queries. Each is the **caller's own** list.
- `setPreferredLanguages(iso2: [String!]!)`, `setMoviePreferredLanguages(movieId: Int!, iso2: [String!]!)`,
  `setShowPreferredLanguages(showId: Int!, iso2: [String!]!)`. All three **replace** the whole list;
  an empty array clears it. There is no add/remove pair — the picker submits the full selection
  every time, including when it is empty.

Every error condition, all five from the spec's table, must be handled — there is no codegen, so an
action that only knows the happy path compiles fine and fails at runtime:

| Error | What this service does |
| :-- | :-- |
| `El idioma <iso2> no está disponible` | Render inline; leave the previous selection in place. Unreachable through the UI since options come from `languages`, handled anyway |
| `El idioma <iso2> está repetido` | Same. Unreachable through a `<select multiple>`, handled anyway |
| `La película <id> no existe` | Render inline on the film's picker |
| `Recurso no disponible para este usuario` | Render inline on the series' picker |
| `No autenticado` | `redirectIfUnauthenticated` already routes this to `/login` — do not also render it |

If the contract is wrong, stop and report (Article VIII).

## Tests

**None, and the reason is standing policy**: this service has no test file, no test runner and no
`test` script, and `services/web/CLAUDE.md` is explicit that adding Vitest or Playwright as a side
effect of a feature task is forbidden — it is its own decision and deserves its own spec.

Nothing in this slice can fail silently in the Article IX sense in any case: a picker bound to the
wrong action, a missing field in a document, or an unhandled error all surface immediately on
screen as a GraphQL error or an empty control. The quality gate here is the typecheck, Biome on the
files actually touched, and opening all three pages.

## Done when

```bash
bin/cli web npx --no tsc --noEmit
bin/npm web run lint
```

Expected: **exactly 11 errors across the 4 known pre-GraphQL files** and not one more
(`services/web/CLAUDE.md` § Current state lists them) — report the count before and after. Biome
over the repo is not a usable gate (~1598 pre-existing errors); run it on the new files only, which
must come back clean.

Then, with the stack up: `/settings` saves and reloads with the selection intact; `/movies/<id>` and
`/shows/<id>` each show only the signed-in user's own selection, verified by signing in as a second
user who owns the same title (AC-9, AC-10).
