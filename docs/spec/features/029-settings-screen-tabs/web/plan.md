---
title: Settings Screen Tabs — web slice
service: web
last_updated: 2026-08-27
status: Approved
---

# PLAN: Settings Screen Tabs — `web` (`web/plan.md`)

## Scope

This slice owns the `/settings` screen: the tab strip, the redistribution of the existing controls
into six panels, the single Save, the admin gate on the page and the sidebar entry, and threading the
installation default locale into `src/i18n/request.ts`.

It does **not** define any setting's validation rules — `api` owns the catalog and every error
message. It does not invent a key for the Compresión controls: those render and persist nothing.
Writes are confined to `services/web/` and this directory; anything else is a stop-and-report
(`.claude/agents/web.md`).

## Files

| File | New / Modified | What changes |
| :-- | :-- | :-- |
| `services/web/src/components/ui/tabs/TabNav.tsx` | New | Presentational underline+icon tab strip: `items`, `active`, `onChange`. No settings knowledge. |
| `services/web/src/components/settings/SettingsForm.tsx` | Modified | Owns the active tab; renders one `<form>` with all six panels, inactive ones hidden. |
| `services/web/src/components/settings/GeneralPanel.tsx` | New | The app-language select. |
| `services/web/src/components/settings/MediaManagerPanel.tsx` | New | Movies/series folders + the two `Checkbox`es. |
| `services/web/src/components/settings/TorrentManagerPanel.tsx` | New | Downloads folder + indexer API key. |
| `services/web/src/components/settings/DownloadPanel.tsx` | New | The `MultiSelect` of default languages + its hidden input. |
| `services/web/src/components/settings/CompressionPanel.tsx` | New | One `Checkbox` + a `Radio` group. Markup only — no `name`, no hidden input, nothing reaches `FormData`. |
| `services/web/src/components/settings/MediaServerFields.tsx` | Modified | Becomes the Media Server panel; behaviour unchanged. |
| `services/web/src/components/settings/PreferredLanguagesCard.tsx` | **Deleted** | Its own save path is gone (REQ-10). |
| `services/web/src/app/(dashboard)/settings/page.tsx` | Modified | Admin check before fetching; drops `getCurrentUser().preferredLanguages`; passes `settings` + `languages` down. |
| `services/web/src/actions/settings.ts` | Modified | `EDITABLE_KEYS` gains `ui_locale` and `default_languages`; adds `getDefaultUiLocale()`. |
| `services/web/src/actions/languages.ts` | Modified | `setPreferredLanguagesAction` removed (the mutation no longer exists). |
| `services/web/src/actions/auth.ts` | Modified | `preferredLanguages` removed from the `me` document and from the `CurrentUser` type. |
| `services/web/src/i18n/request.ts` | Modified | Resolution order gains the installation default. |
| `services/web/src/layout/AppSidebar.tsx` | Modified | `/settings` moves into the `isAdmin`-only list. |
| `services/web/messages/en.json`, `messages/es.json` | Modified | Tab labels, the two new field labels, the Compresión copy. |

## Existing code to reuse

- `services/web/src/components/settings/PathPicker.tsx` — **the hidden-input idiom.** A controlled
  visible control plus one `<input type="hidden" name={key} value={…}>`. `Checkbox`, `Radio` and
  `MultiSelect` all render no `name`d input, so every one of them needs this. Do not invent a second
  way to get a controlled value into `FormData`.
- `services/web/src/components/form/input/Checkbox.tsx`, `input/Radio.tsx`, `MultiSelect.tsx` — the
  components REQ-4 mandates. They are controlled (`checked`/`selected` + `onChange`); wrap each in a
  small stateful holder that owns the `useState` and renders the hidden input.
- `services/web/src/app/(dashboard)/users/page.tsx` — the admin-gated page pattern: `getCurrentUser()`
  first, `notFound()` if not admin, **then** the guarded fetch, **sequentially, never `Promise.all`**.
  Racing them turns `api`'s `AdminGuard` refusal into a 500 instead of a clean 404. `getSettings()` is
  now admin-only, so this applies here exactly as it does there.
- `services/web/src/layout/AppSidebar.tsx` — the `isAdmin ? [...base, entry] : base` list is already
  there for `/users`; `/settings` joins it. Cosmetic only; `api`'s guard is the control.
- `services/web/src/lib/auth-session.ts` — `redirectToClearSession` in read functions a Server
  Component awaits (`getSettings` already uses it; `getDefaultUiLocale` must too, and it is called
  from `i18n/request.ts` during render). `redirectIfUnauthenticated` stays in the form action. These
  are not interchangeable — see `services/web/CLAUDE.md`.
- `services/web/src/components/media/LanguagePicker.tsx` — renders language names through
  `Intl.DisplayNames(activeLocale)` and sorts with `localeCompare`. The Descarga panel's
  `MultiSelect` options must be built the same way; `api`'s `languages` query returns English names
  and display authority lives here.
- `services/web/src/actions/settings.ts` — `updateSettingsAction`'s existing shape
  (`(prevState, formData)` → `{ error } | { success: true }`, `useActionState`), its `EDITABLE_KEYS`
  filter and its `BOOLEAN_KEYS` always-explicit push. Extend those lists; do not restructure.

## Steps

1. `TabNav.tsx`: the presentational strip. Icons from `lucide-react` (already a dependency); repeating
   an icon across tabs is acceptable for now.
2. `actions/settings.ts`: add `getDefaultUiLocale()` (query `defaultUiLocale`, `redirectToClearSession`
   on error, return `string | null`). Add `ui_locale` and `default_languages` to `EDITABLE_KEYS`.
   `default_languages` must **not** be dropped by the blank filter — the empty string is a valid
   value meaning "no default languages", so it needs the `BOOLEAN_KEYS` treatment: pushed explicitly,
   always, never filtered.
3. `i18n/request.ts`: insert the installation default between the user's `uiLocale` and
   `Accept-Language`, guarded by `isSupportedLocale`. It runs for anonymous requests, so it must not
   assume a session.
4. Split `SettingsForm.tsx` into the six panels. Keep one `<form action={formAction}>`; render every
   panel, hiding the inactive ones with a class — **never conditionally render them**, or the settings
   on unvisited tabs vanish from `FormData` and the save silently persists a subset.
5. `CompressionPanel.tsx`: `Checkbox` + `Radio` group, local state only, no `name`, no hidden input.
6. Replace the two hand-rolled checkboxes with `Checkbox` + hidden input in the Media Manager panel.
7. `page.tsx`: admin check → `notFound()`, then fetch. Delete `PreferredLanguagesCard` and its import.
8. Delete `setPreferredLanguagesAction`; remove `preferredLanguages` from `actions/auth.ts`'s `me`
   document and `CurrentUser` type. Run `grep -rn "preferredLanguages" services/web/src` and confirm
   **only** the `Movie`/`Show` occurrences remain (`actions/movies.ts`, `actions/shows.ts`,
   `components/movies/Movie.tsx`, `components/shows/Show.tsx`) — those are the per-title level and
   stay.
9. `AppSidebar.tsx`: move the `/settings` entry into the admin-only branch.
10. Both catalogs, then `node scripts/check-messages.mjs` for drift. `es` keeps the Rioplatense
    register.

## Contract obligations

Read `../spec.md` § GraphQL Contract Delta. It is read-only; there is no codegen, so every type here
is a hand-copy that nothing checks.

- `defaultUiLocale: String` — **nullable**. `null` means no installation default; fall through to
  `Accept-Language`. Do not type it `string`.
- `updateSettings(entries: [SettingInput!]!)` — unchanged. The two new keys are `ui_locale` and
  `default_languages` (comma-separated ISO-639-1, ordered, possibly empty).
- `setPreferredLanguages` and `User.preferredLanguages` no longer exist. A leftover selection of
  `preferredLanguages` in the `me` document fails GraphQL validation and takes the whole dashboard
  down — loud, but only once `api` has shipped.

Errors the Save action must handle, all through `translateGraphQLError`:

| Condition | What `web` does |
| :-- | :-- |
| `error.setting.expected_enum` (bad `ui_locale`) | Show the translated message in the single error slot; keep entered values; do not switch tabs. |
| `error.language.unavailable` / `error.language.duplicate` | Same. |
| `error.mediaRoot.*` (a folder escaping its root) | Same. |
| `error.validation.setting_value_required` | Same. |
| `error.auth.admin_required` | Same — a non-admin should never reach the screen, but the action must not treat a refusal as success. |
| `UnauthorizedException` | `redirectIfUnauthenticated`, as today. |
| Network failure | `errors.network.connectionFailed`, as today. |

There is exactly one error slot and one success message for the whole screen (REQ-3) — not one per
tab.

## Tests

**None owed.** This service has no test runner by design (`services/web/CLAUDE.md`), and nothing in
this slice fails silently in the Article IX sense: the panel-mounting rule is the one real silent
failure and it is a structural invariant a test here could not observe better than AC-2 does. The
checks that stand in for tests are `bin/npm web run lint`, `bin/npm web run build` (which typechecks)
and `scripts/check-messages.mjs` for catalog drift — all three are in Done when.

## Done when

```bash
bin/npm web run lint
bin/npm web run build
bin/cli web node scripts/check-messages.mjs
```

Lint clean, build exits 0, no catalog drift. Then the manual pass in `../plan.md` § Verification.
