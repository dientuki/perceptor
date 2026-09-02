---
title: User Preferences — web slice
service: web
last_updated: 2026-09-01
status: Implemented
---

# PLAN: User Preferences — `web` (`web/plan.md`)

Read `../spec.md` and `../plan.md` first, then `services/web/CLAUDE.md` and
`docs/constitution.md`. The GraphQL delta in `../spec.md` is read-only.

This is Next 16, not the Next.js in your training data — `middleware.ts` is `proxy.ts` here, and
the App Router conventions have moved. `018-ui-i18n` has landed: `next-intl` is installed,
`messages/en.json` and `messages/es.json` exist, and **no user-facing string in this slice is a
literal** — every label, heading, hint and message is a catalog entry in both files.

## Scope

`web` builds `/preferences` and its five cards, removes the *Descarga* tab from `/settings`, and
adds the navigation entries. It consumes the new contract; it defines none of it.

`web` does **not** touch `src/components/media/LanguagePicker.tsx` — it has three live call sites
and this slice makes it two more, all as a consumer. `web` does not change `SettingsForm`'s five
remaining panels, `EDITABLE_KEYS`, `BOOLEAN_KEYS`, or anything about how installation settings are
saved beyond deleting the download-languages path that no longer has a screen. `web` never touches
the database (Article II).

Writes are confined to `services/web/` and this directory. Anything else is a stop-and-report (see
`.claude/agents/web.md`).

## Files

| File | New / Modified | What changes |
| :-- | :-- | :-- |
| `services/web/src/types/preferences.ts` | New | `TorrentGroup`, `TorrentGroupScope`, `LanguageTrackKind`, `UserPreferences` — hand-typed from `../spec.md` |
| `services/web/src/actions/preferences.ts` | New | `getPreferences`, `getTorrentGroups`, `setAllowCinemaReleasesAction`, `setPreferredTrackLanguagesAction`, `setPreferredTorrentGroupsAction` |
| `services/web/src/app/(dashboard)/preferences/page.tsx` | New | Server Component, one `Promise.all`, three sections, five cards |
| `services/web/src/components/preferences/UiLocaleCard.tsx` | New | Single choice over `SUPPORTED_LOCALES`, names via `Intl.DisplayNames` |
| `services/web/src/components/preferences/DownloadLanguagesCard.tsx` | New | The audio and subtitle pickers, each bound to its own kind |
| `services/web/src/components/preferences/CinemaReleasesCard.tsx` | New | The yes/no control |
| `services/web/src/components/preferences/TorrentGroupsCard.tsx` | New | Owns the empty state; renders the picker only over a non-empty catalog |
| `services/web/src/components/preferences/TorrentGroupPicker.tsx` | New | Sibling of `LanguagePicker`, bound to one scope |
| `services/web/src/components/settings/SettingsForm.tsx` | Modified | Five tabs; the download tab, its panel and the `activeTab === "download"` hide/show branch all go |
| `services/web/src/components/settings/DownloadPanel.tsx` | Deleted | Its only content moves to `/preferences` as a per-user control |
| `services/web/src/actions/settings.ts` | Modified | `updateDefaultLanguagesAction` and `ALWAYS_SENT_STRING_KEYS` deleted — dead once the panel is gone |
| `services/web/src/app/(dashboard)/settings/page.tsx` | Modified | Drops `getLanguages()` and the `languages` prop |
| `services/web/src/layout/AppSidebar.tsx` | Modified | *Preferencias* in `baseNavItems` — **not** in the `isAdmin` branch |
| `services/web/src/components/header/UserDropdown.tsx` | Modified | A *Preferencias* item beside *Ajustes* |
| `services/web/messages/en.json`, `messages/es.json` | Modified | Every new string, plus `errors.torrent_group.*` |

## Existing code to reuse

- **`src/actions/locale.ts`'s `setUiLocaleAction` is used verbatim.** It already has the
  `(prevState, formData)` shape, already derives its error through `translateGraphQLError`, already
  calls `redirectIfUnauthenticated`, and its own comment says it exists for the picker
  `018-ui-i18n` chose not to build. Do not write a second one, and do not change it. Its only
  requirement on the card is a form field named `locale`.

- **`src/actions/media-server.ts`** is the server-action shape to copy for the new file
  (`services/web/CLAUDE.md` § "The server-action pattern"): `'use server'` first line, the document
  as a module-level SCREAMING_SNAKE const, the shape as `fetchGraphQL<T>`'s type parameter, errors
  through `src/lib/graphql-error.ts`. **Read functions use `redirectToClearSession`; form actions
  use `redirectIfUnauthenticated`** — `getPreferences` and `getTorrentGroups` are `await`ed during
  the page's render pass, where cookie mutation throws, so they take the first. Re-derive this from
  where the call happens rather than copying the nearest example; `services/web/CLAUDE.md` §
  "not interchangeable" explains why getting it backwards is a redirect loop and not a style bug.

- **`src/components/media/LanguagePicker.tsx`** is used **as is** for both language cards, as its
  fourth and fifth call sites. It renders its own `<form>`, emits one hidden input named by its
  `name` prop carrying a comma-separated list of BCP-47 tags, and defaults that name to `"tags"` —
  which is what `setPreferredTrackLanguages` expects, so neither card needs to pass `name`. Each
  card binds it to an action already bound to its `kind`, the same way `Movie.tsx` binds it to an
  action already bound to a title id. Do not add a `kind` prop to the component.

- **`src/i18n/locales.ts`'s `SUPPORTED_LOCALES`** is the list `UiLocaleCard` renders. `web` cannot
  render a locale it has no `messages/*.json` for, so this list — not a round trip to
  `Query.supportedLocales` — is the truthful set for a picker; the API's copy stays what validates
  the write on the other side. `services/web/CLAUDE.md` § i18n names this file as the one list every
  consumer of the supported set reads.

- **`Intl.DisplayNames`** supplies the locale names, exactly as `LanguagePicker` already does for
  language names. Locale display names are never catalog entries — duplicating them per locale is
  how a catalog rots (`services/web/CLAUDE.md` § "Language names are not a catalog entry").

- **`src/components/form/input/Checkbox.tsx` + the hidden-input idiom** in `MediaManagerPanel` /
  `SettingsForm` — the visual template for the cinema control. Reuse the markup; do **not** reuse the
  mechanism, which posts a settings key. This one calls its own mutation.

- **`src/app/(dashboard)/users/page.tsx`** — the precedent for a dashboard Server Component that
  fetches server-side and hands data to client children. Copy the data flow and **not** the admin
  gate: both it and `settings/page.tsx` open with a sequential `getCurrentUser()` and a
  `notFound()` for a non-administrator, which on this screen would 404 every user who most needs it
  (REQ-2, AC-2b). `/preferences` has no gate, so its reads may all go in one `Promise.all`.

- **`src/lib/graphql-error.ts`** — every action derives its error text through
  `translateGraphQLError`. Never string-match a message; never render a bare key.

**Article XI applies to every new file.** The components and actions named above predate it and
carry explanatory comments; that is legacy, not a pattern. Copy their structure and write no
comments. This slice owes no test header either, because it owes no tests (§ Tests).

## Steps

1. Add `src/types/preferences.ts`, hand-typed from `../spec.md`'s SDL. `TorrentGroupScope` and
   `LanguageTrackKind` are string unions (`'MOVIE' | 'SHOW'`, `'AUDIO' | 'SUBTITLE'`), matching how
   the other enums are retyped in this service.

2. Write `src/actions/preferences.ts`. `setPreferredTrackLanguagesAction` is bound per `kind` and
   `setPreferredTorrentGroupsAction` per `scope` at the call site, the way the per-title language
   actions are bound to a title id. Torrent-group ids arrive from the form as strings and must be
   converted with `Number` — `[Int!]!` rejects strings at runtime with no compile error here
   (`services/web/CLAUDE.md` § "id is a string in this service's types").

3. Build the five cards under `src/components/preferences/`, plus `TorrentGroupPicker`.
   `TorrentGroupsCard` decides between the empty state and the picker on `options.length === 0`:
   the picker must never render over an empty catalog, because an empty submission is a valid
   "clear my selection" write (REQ-7, `../plan.md` § Risks). `UiLocaleCard` must leave the page
   rendering in the newly chosen language without the user reloading by hand — the locale is
   resolved server-side per request, so the card refreshes the route after a successful save.

4. Write `src/app/(dashboard)/preferences/page.tsx`: one
   `Promise.all([getPreferences(), getLanguages(), getTorrentGroups()])`, then the three sections in
   the order the spec lists them — *Idiomas*, *Películas*, *Series* — with `PageBreadcrumb` and
   `generateMetadata` from the catalog, like every other dashboard page. No `isAdmin` check.

5. Strip `/settings`: delete `DownloadPanel.tsx`, remove the download tab from `SettingsForm`'s
   `TABS`/`tabItems` and remove the `activeTab === "download"` hide/show wrapper that existed only
   to keep `LanguagePicker`'s own `<form>` out of the main one, delete `updateDefaultLanguagesAction`
   and `ALWAYS_SENT_STRING_KEYS` from `src/actions/settings.ts`, and drop `getLanguages()` and the
   `languages` prop from `settings/page.tsx`. **Nothing about the `default_languages` key itself
   changes on the `api` side** — it stays in `SETTINGS_CATALOG` with its row intact (REQ-6). Confirm
   with `grep -rn "DownloadPanel\|updateDefaultLanguagesAction" services/web/src` returning nothing.

6. Add *Preferencias* to `AppSidebar.tsx`'s `baseNavItems` — the array every user gets, not the
   `isAdmin` spread beneath it — and to `UserDropdown.tsx` beside the existing *Ajustes* item. Both
   labels come from the `nav` and `userMenu` catalog namespaces. Leave the *Ajustes* item's own
   (missing) admin gating alone; it is named in `../spec.md` § Out of Scope.

7. Add every new string to both catalogs, including `errors.torrent_group.not_found`,
   `errors.torrent_group.duplicated` and `errors.torrent_group.wrong_scope` (the `error.` prefix is
   stripped and the rest lands under the `errors` namespace), and run
   `bin/cli web node scripts/check-messages.mjs`. `es` keeps the existing Rioplatense register.

## Contract obligations

`web` consumes exactly what `../spec.md` § GraphQL Contract Delta defines. There is no codegen, so
every one of these is a runtime failure if retyped wrong:

- `preferences` is a **root query**, not a field on `me`. Do not try to select it inside
  `ME_QUERY` — it does not exist there, and `me` needs no change in this feature.
- `torrentGroups` is called **without** `scope`; the whole catalog comes back and `web` splits it by
  `group.scope` to fill the two pickers.
- `preferences.torrentGroups` is likewise unfiltered — split it the same way. Both pickers read the
  same array, which is what keeps them from disagreeing.
- `setPreferredTrackLanguages(kind:, tags:)` takes BCP-47 tag strings, not ids, and **replaces** the
  list for that kind. The other kind's card must not be re-submitted alongside it.
- `setPreferredTorrentGroups(scope:, ids:)` takes `Int!` ids and replaces one scope. Same rule.
- `setAllowCinemaReleases(allowed: Boolean!)` returns the whole `UserPreferences`.
- `allowCinemaReleases` is non-null; there is no "unset" state to render.

Every error condition, and what this slice does with it:

| Key | What `web` does |
| :-- | :-- |
| `error.torrent_group.not_found` | Inline error on the failing card only; revert its selection to what the server still holds |
| `error.torrent_group.duplicated` | Same |
| `error.torrent_group.wrong_scope` | Same |
| `error.language.unavailable` | Same, on the failing language card. Existing key, already in both catalogs |
| `error.language.duplicate` | Same. Existing key |
| `error.user.unsupported_locale` | Inline error on the locale card. Existing key |
| `error.auth.unauthenticated` | Never reaches a card — `redirectIfUnauthenticated` intercepts it in the action, clears the cookie, redirects to `/login` |

Reverting the selection on a refusal is not cosmetic: a picker left showing what the user chose
after the server refused it is a UI that disagrees with the database until the next reload. A card
that only handles the happy path compiles fine and is wrong.

`setAllowCinemaReleases` has no failure of its own — a boolean cannot be invalid — so the
unauthenticated path is its only one.

## Tests

**None owed.** `services/web` has no test runner: no Vitest, no Playwright, no `test` script, and
introducing one is its own decision with its own spec (`services/web/CLAUDE.md` § "Tests: there are
none"). Do not add one as a side effect of this feature.

Nothing here fails silently in the Article IX sense either. Every failure mode in this slice is
visible on the screen the moment it happens: a mis-typed field name yields a GraphQL error the card
renders, a wrong split shows the wrong groups in the wrong picker, the empty-state bug is what AC-7
looks at directly, and the admin-gate hazard is what AC-2b looks at. The one genuinely silent
failure in this feature — a scope- or kind-blind write wiping the sibling list — lives in `api` and
is covered by that slice's spec files.

The typecheck, the production build, Biome and the catalog parity check are the safety net here,
and all four are in § Done when.

## Done when

```bash
bin/cli web npx --no tsc --noEmit
bin/npm web run build
bin/npm web run lint
bin/cli web node scripts/check-messages.mjs
```

Typecheck reports **0 errors** and `next build` exits **0** — the baseline from
`016-web-build-errors` that must not regress; report both before and after. Biome reports no new
findings and the catalog check exits 0.

Then, with the stack up, walk AC-1, AC-2, AC-2b, AC-3, AC-4, AC-5, AC-6, AC-7, AC-8 and AC-15 from
`../spec.md` in the browser — **AC-2b signed in as a non-administrator**, not as the seeded admin.
The playground-only criteria (AC-9 through AC-14) belong to the `api` slice.
