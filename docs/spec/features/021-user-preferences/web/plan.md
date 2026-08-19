---
title: User Preferences — web slice
service: web
last_updated: 2026-08-19
status: Approved
---

# PLAN: User Preferences — `web` (`web/plan.md`)

Read `../spec.md` and `../plan.md` first, then `services/web/AGENTS.md`. The GraphQL delta in
`../spec.md` is read-only.

This is Next 16, not the Next.js in your training data — `middleware.ts` is `proxy.ts`, and the App
Router conventions have moved. `018-ui-i18n` has already landed by the time this slice starts, so
`next-intl` is installed, `messages/en.json` and `messages/es.json` exist, and **no user-facing
string in this slice is a literal** — every label, heading, hint and message is a catalog entry in
both files.

## Scope

`web` owns the split: a new `/preferences` screen holding everything scoped to the signed-in user,
and a `/settings` screen reduced to installation-wide configuration. It builds the new torrent-group
picker and the new cinema checkbox, wires the interface-language control on top of `018-ui-i18n`'s
`setUiLocale`, and adds the navigation entries.

`web` does **not** define any error key — that vocabulary is `api`'s and is frozen in `../spec.md`.
`web` does not change `LanguagePicker.tsx` or `PreferredLanguagesCard.tsx` beyond what relocating
them requires; they work today and their mutation is untouched by this feature. `web` does not touch
`SettingsForm.tsx`'s fields, `EDITABLE_KEYS`, or anything else about how installation settings are
saved. `web` never touches the database (Article II).

Writes are confined to `services/web/` and this directory. Anything else is a stop-and-report (see
`.claude/agents/web.md`).

## Files

| File | New / Modified | What changes |
| :-- | :-- | :-- |
| `services/web/src/types/torrent-groups.ts` | New | `TorrentGroup`, `TorrentGroupScope` — hand-typed from `../spec.md` |
| `services/web/src/actions/torrent-groups.ts` | New | `getTorrentGroups()`, `setPreferredTorrentGroupsAction` |
| `services/web/src/actions/preferences.ts` | New | `setAllowCinemaReleasesAction` |
| `services/web/src/actions/auth.ts` | Modified | `ME_QUERY` gains `allowCinemaReleases` and `preferredTorrentGroups { id name scope }` |
| `services/web/src/app/(dashboard)/preferences/page.tsx` | New | Server Component: one `Promise.all`, four independent cards |
| `services/web/src/components/preferences/LanguagesGroup.tsx` | New | Interface language + the relocated preferred-languages card |
| `services/web/src/components/preferences/UiLocaleCard.tsx` | New | Single-select over `supportedLocales`, names via `Intl.DisplayNames` |
| `services/web/src/components/preferences/CinemaReleasesCard.tsx` | New | The yes/no control |
| `services/web/src/components/preferences/TorrentGroupsCard.tsx` | New | Owns the empty state; renders the picker only when the catalog is non-empty |
| `services/web/src/components/preferences/TorrentGroupPicker.tsx` | New | `<select multiple>` + `useActionState`, bound to one scope |
| `services/web/src/app/(dashboard)/settings/page.tsx` | Modified | Drops `PreferredLanguagesCard`, `getLanguages()` and `getCurrentUser()` |
| `services/web/src/components/settings/PreferredLanguagesCard.tsx` | Moved | To `src/components/preferences/`; contents unchanged apart from its import path |
| `services/web/src/layout/AppSidebar.tsx` | Modified | A *Preferencias* entry beside *Ajustes* |
| `services/web/src/components/header/UserDropdown.tsx` | Modified | A *Preferencias* item beside `019-user-menu`'s *Ajustes* |
| `services/web/messages/en.json`, `messages/es.json` | Modified | Every new string, plus the three `error.torrent_group.*` keys |

## Existing code to reuse

- **The server-action shape** in `services/web/CLAUDE.md`. Copy `src/actions/languages.ts` — it is
  the closest analogue in the repo: a read function that `throw`s and calls `redirectToClearSession`
  because Server Components `await` it during render, plus form actions taking
  `(prevState, formData)` and returning `{ error?: string } | { success: true }` and calling
  `redirectIfUnauthenticated`. Do not invent a variant, and re-derive which of the two redirect
  helpers applies from the caller's context rather than copying whichever is nearest.

- **`LanguagePicker.tsx`** — the visual and behavioural template for `TorrentGroupPicker`:
  `<select multiple>` with `defaultValue` from the current selection, a `useActionState` form, an
  error paragraph, a success paragraph, and a submit button that disables while pending. Build a
  sibling; do **not** generalize `LanguagePicker` itself. It has three other call sites (the global
  card plus both per-title pickers) and `018-ui-i18n`'s `web` plan ring-fences it. The reasoning is
  in `../plan.md` § Approach.

- **`PreferredLanguagesCard.tsx`** — **move** it, do not copy it. Its header comment already explains
  why it is not part of `SettingsForm`; that comment now describes the whole screen it lives on and
  should be updated to say so, not deleted. Its props, its action and its behaviour do not change.

- **`src/lib/graphql-error.ts` (`018-ui-i18n`)** — turns `extensions.i18n` into a translated string
  with `message` as the fallback. Every new action derives its `error` through it. Never
  string-match on a message.

- **`Intl.DisplayNames` (`018-ui-i18n` REQ-13)** — the source of the language names in the interface
  picker. Locale display names are not catalog entries; duplicating them per locale is how a catalog
  rots.

- **`src/actions/auth.ts`'s `getCurrentUser()`** — extend `ME_QUERY` rather than adding a second
  round trip for the preference values. `018-ui-i18n` already splits out a `cache()`d
  `getCurrentUserOrNull()`; the additions ride along on the same query.

- **`src/app/(dashboard)/users/page.tsx`** — the precedent for a dashboard Server Component that
  fetches on the server and hands data to client components. `/preferences` has no admin gate, so
  its fetches may all go in one `Promise.all` (the sequential pattern there exists only because of
  the `isAdmin` check, and copying it here would be cargo cult).

- **`src/components/settings/SettingsForm.tsx`** — the checkbox markup for `movies_enabled` is the
  visual template for the cinema control. Reuse the markup; do **not** reuse the mechanism — that
  checkbox posts a settings key through `updateSettings`, and this one calls its own mutation.

## Steps

1. Add `src/types/torrent-groups.ts`, hand-typed from `../spec.md`'s SDL. `TorrentGroupScope` is a
   string union (`'MOVIE' | 'SHOW'`), matching how the other enums are retyped in this service.

2. Write `src/actions/torrent-groups.ts` and `src/actions/preferences.ts`. `setPreferredTorrentGroupsAction`
   is bound per scope at the call site, the same way `setMoviePreferredLanguagesAction` is bound to a
   movie id. `ids` arrive from `formData.getAll('ids')` and must be converted with `Number` — form
   values are always strings, and `Int!` will reject them otherwise, at runtime, with no compile
   error.

3. Extend `ME_QUERY` in `src/actions/auth.ts` and the `CurrentUser` type with `allowCinemaReleases`
   and `preferredTorrentGroups`.

4. Build the four cards and the picker under `src/components/preferences/`. `TorrentGroupsCard`
   decides between the empty state and the picker on `options.length === 0` — the picker must never
   render over an empty catalog, because an empty `<select multiple>` submits `ids: []`, which is a
   valid "clear my selection" write (see `../plan.md` § Risks).

5. Move `PreferredLanguagesCard.tsx` from `src/components/settings/` to `src/components/preferences/`
   and update its import.

6. Write `src/app/(dashboard)/preferences/page.tsx`: `Promise.all([getCurrentUser(), getLanguages(),
   getTorrentGroups(), getSupportedLocales()])`, then the three groups in the order the spec lists
   them — *Idiomas*, *Películas*, *Series* — with `PageBreadcrumb` and `metadata.title` from the
   catalog like every other dashboard page.

7. Strip `/settings`: remove `PreferredLanguagesCard`, and with it the now-unused `getLanguages()`
   and `getCurrentUser()` calls from `settings/page.tsx`. Confirm with
   `grep -rn "PreferredLanguagesCard" "services/web/src/app/(dashboard)/settings"` returning nothing
   (AC-12).

8. Add the *Preferencias* entry to `AppSidebar.tsx`'s `navItems` and to `UserDropdown.tsx` beside
   `019-user-menu`'s *Ajustes*. Both labels come from the catalog.

9. Add every new string to `messages/en.json` and `messages/es.json`, including translations for the
   three `error.torrent_group.*` keys, and run the catalog parity check `018-ui-i18n` installs
   (`scripts/check-messages.mjs`).

## Contract obligations

`web` consumes exactly what `../spec.md` § GraphQL Contract Delta defines. There is no codegen, so
every one of these is a runtime failure if retyped wrong:

- `torrentGroups` is called **without** `scope`; the whole catalog comes back and `web` splits it by
  `group.scope` to fill the two pickers.
- `preferredTorrentGroups` on `me` is likewise unfiltered and unscoped — split it the same way. The
  two pickers read the same array, which is what keeps them from disagreeing.
- `setPreferredTorrentGroups(scope:, ids:)` takes `Int!` ids, not strings, and **replaces** the
  selection for that scope. The other scope's card must not be re-submitted alongside it.
- `setAllowCinemaReleases(allowed: Boolean!)` returns the whole `User`.
- `allowCinemaReleases` is non-null; there is no "unset" state to render.

Every error condition, and what this slice does with it:

| Key | What `web` does |
| :-- | :-- |
| `error.torrent_group.not_found` | Inline error on the failing card only; revert its selection to what the server still holds |
| `error.torrent_group.duplicated` | Same |
| `error.torrent_group.wrong_scope` | Same |
| `error.auth.unauthenticated` | Never reaches the card — `redirectIfUnauthenticated` intercepts it in the action, clears the cookie, redirects to `/login` |

Reverting the selection on failure is not cosmetic: a picker left showing what the user chose after
the server refused it is a UI that disagrees with the database until the next reload. A card that
only handles the happy path compiles fine and is wrong.

`setAllowCinemaReleases` has no failure of its own — a boolean cannot be invalid — so its only error
path is the unauthenticated one.

## Tests

**None owed.** `services/web` has no test runner: no Vitest, no Playwright, no `test` script in
`package.json`, and introducing one is its own decision (`services/web/CLAUDE.md`), not something to
smuggle in with a preferences screen.

Nothing in this slice fails silently in the Article IX sense either. Every failure mode here is
visible on the screen the moment it happens: a mis-typed field name yields a GraphQL error the card
renders, a wrong scope split shows the wrong groups in the wrong picker, and the empty-state bug is
what AC-6 looks at directly. The one genuinely silent failure in this feature — a scope-blind write
wiping the other scope — lives in `api` and is covered by `api/plan.md`'s spec file.

The typecheck and the production build are the safety net for this slice, and both are in § Done
when.

## Done when

```bash
bin/cli web npx --no tsc --noEmit
bin/npm web run build
bin/npm web run lint
```

Typecheck reports **0 errors** and `next build` exits **0** — the baseline in the root `CLAUDE.md`
after `016-web-build-errors`, which must not regress. Report both counts before and after. Biome
reports no new findings.

Then, with the stack up, walk AC-1 through AC-7 and AC-12 from `../spec.md` in the browser; the
playground-only criteria (AC-8 through AC-11) belong to the `api` slice.
