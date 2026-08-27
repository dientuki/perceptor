---
title: Settings Screen Tabs
spec_version: 0.1.0
author: Juan Farias
created_at: 2026-08-27
last_updated: 2026-08-27
status: Approved
services: [api, web]
---

# SPEC: Settings Screen Tabs (`spec.md`)

## Context & Goal

`/settings` is today a single scrolling column. `services/web/src/app/(dashboard)/settings/page.tsx`
renders one `SettingsForm` (four `<h3>` sections: torrent, indexer, movies/shows, media server) plus
a second, unrelated card — `PreferredLanguagesCard` — that saves on its own, through its own
mutation, with no Save button of its own in the form's sense. So the screen has two save paths, one
of which the user does not see coming, and the four sections inside the form are only visually
separated. The form also predates the shared TailAdmin input primitives: the two "enabled"
checkboxes in `SettingsForm.tsx` are hand-rolled `<input type="checkbox">` elements with inline
Tailwind rather than `components/form/input/Checkbox.tsx`, which exists and is unused here.

This feature re-cuts that screen into six tabs — **General, Media Manager, Media Server, Torrent
Manager, Descarga, Compresión** — using the "Tabs with underline and icon" pattern from TailAdmin,
and collapses every save path into a single Save button that posts one `updateSettings` call.

Two settings do not exist yet and are added by this feature, both installation-wide rows in
`Setting`. The first is the **default UI language**: `User.uiLocale` (added by `018-ui-i18n`)
already lets a user pick their own, and `services/web/src/i18n/request.ts` resolves
`uiLocale → Accept-Language → en`; the new `ui_locale` row becomes the step between the user's own
choice and `Accept-Language`, so an administrator can set the installation's language once and every
user who never chose one sees it. The second is the **default download languages**. Today the
"general" level of that preference is per-user (`user_languages`, written by `setPreferredLanguages`,
read by `ProcessJobsService.collectAllowedLanguages`). Per the decision recorded below it becomes
installation-wide: the merge at encode time is the title's original language ∪ the installation
default ∪ each owner's per-title preference. The per-title level
(`user_movie_languages` / `user_show_languages`, edited from a film's or series' detail page) is
untouched — that is the level a user still controls, and the merge logic that unions it stays exactly
as it is.

The **Compresión** tab is markup only in this feature: a yes/no `Checkbox` and a group of `Radio`
buttons, rendered, with no setting behind them, no key in the catalog, and no effect on the encode.
It exists so the layout is in place; what it controls is a later spec. No pipeline stage in the root
`CLAUDE.md` changes status — this is a UI re-cut plus two configuration rows.

## Requirements

### Functional Requirements

- [ ] **REQ-1 (Tabs)**: `/settings` must present its content as six tabs — General, Media Manager,
      Media Server, Torrent Manager, Descarga, Compresión — rendered in the TailAdmin "tabs with
      underline and icon" style. Every tab carries an icon; repeating the same icon across tabs is
      acceptable for now. Exactly one tab's panel is visible at a time and General is the one
      selected on load.
- [ ] **REQ-2 (Tab contents)**: The controls must be distributed as follows, and no control may
      appear in two tabs:
      - **General** — the installation's default UI language.
      - **Media Manager** — the movies folder, the series folder, and the movies-enabled and
        series-enabled toggles.
      - **Media Server** — the media server client selector, host, port and API key.
      - **Torrent Manager** — the downloads folder and the indexer API key.
      - **Descarga** — the installation's default download languages.
      - **Compresión** — one yes/no toggle and a group of radio buttons (markup only, REQ-9).
- [ ] **REQ-3 (One Save)**: The screen must have exactly one Save control. Activating it must submit
      the values of **every** tab in a single request, including tabs the user never opened, and
      must report one outcome — one success or one error — for the whole screen. No control on the
      screen may save on change.
- [ ] **REQ-4 (Shared input components)**: Every checkbox on the screen must be
      `components/form/input/Checkbox.tsx`, every radio `components/form/input/Radio.tsx`, and the
      download-languages control `components/form/MultiSelect.tsx`. The hand-rolled
      `<input type="checkbox">` markup currently in `SettingsForm.tsx` must be gone.
- [ ] **REQ-5 (Default UI language is a setting)**: The installation's default UI language must be
      an editable, persisted setting whose value is one of the supported locales. Submitting an
      unsupported value must be rejected with a message naming the accepted values, and must leave
      every other value on the screen unsaved.
- [ ] **REQ-6 (Locale resolution order)**: `web` must resolve the UI locale as
      **user's `uiLocale` → the installation default → `Accept-Language` → `en`**, for every
      request including an unauthenticated one (the login page). An installation default that is
      unset or unsupported must be skipped rather than break the page.
- [ ] **REQ-7 (Default download languages is a setting)**: The default download languages must be an
      editable, persisted, installation-wide setting holding an ordered list of language codes.
      Submitting an unknown or duplicated code must be rejected, naming the offending code, and must
      leave every other value on the screen unsaved. The empty list is a valid value.
- [ ] **REQ-8 (Encode merge)**: The set of languages an encode may keep must be the title's original
      language ∪ the installation default download languages ∪ every owner's per-title preference,
      deduplicated, original first. The per-user global level is removed from that union.
- [ ] **REQ-9 (Compresión is markup)**: The Compresión tab must render its toggle and radios and must
      persist nothing. Its controls send no value on Save, add no key to the settings catalog, and
      change no FFmpeg argument. A user toggling them and pressing Save sees the same success they
      would see without touching them.
- [ ] **REQ-10 (No orphan save path)**: The separate download-languages card and its own save action
      must no longer exist on this screen; the per-user global download-language preference must no
      longer be readable or writable through the API.
- [ ] **REQ-11 (Settings are administrator-only)**: Reading and writing installation-wide settings
      must require an administrator. A non-administrator calling the settings query or the update
      mutation must be refused with the same "administrator required" error the users module already
      returns, and must not see the `/settings` entry point in the sidebar. The refusal is enforced
      server-side; hiding the link is usability, not the control.

### Non-Functional & Operational Requirements

- [ ] **NFR-1 (No backfill)**: Dropping the per-user global download-language level discards what
      users had chosen there, and that is accepted: the project is in development and the database is
      disposable (`bin/dbreset`). The migration drops `user_languages` outright; `default_languages`
      is seeded empty and an administrator sets it from the Descarga tab. Nothing reads the old rows
      before they go.
- [ ] **NFR-2 (All-or-nothing save)**: A rejected value anywhere on the screen must leave the stored
      settings exactly as they were — the existing `updateSettings` guarantee (validate every entry
      before writing any) must continue to hold for the two new keys.
- [ ] **NFR-3 (No new anonymous surface beyond the locale)**: The installation default UI language
      must be readable without authentication, since it is needed to render `/login`. Nothing else
      in `Setting` may become readable anonymously — the `settings` query stays authenticated.
- [ ] **NFR-4 (Error copy is catalog-driven)**: Every new error crosses the boundary as English text
      plus an `extensions.i18n` key, resolved by `web` against `messages/{en,es}.json`
      (`018-ui-i18n`). No new hardcoded Spanish in `api`.

## GraphQL Contract Delta

```graphql
type Query {
  """
  The installation's default UI language, or null when unset. Public: `web`
  resolves the request locale before it knows who is asking.
  """
  defaultUiLocale: String

  """Administrator only."""
  settings: [Setting!]!
}

type Mutation {
  """Administrator only."""
  updateSettings(entries: [SettingInput!]!): [Setting!]!
}

type User {
  id: ID!
  username: String!
  name: String!
  isAdmin: Boolean!
  isEnabled: Boolean!
  uiLocale: String
}
```

**Removed from the contract**:

```graphql
# gone — the general level of this preference is now the `default_languages` setting
type Mutation {
  setPreferredLanguages(iso2: [String!]!): [Language!]!
}

# gone — same reason
type User {
  preferredLanguages: [Language!]!
}
```

`Movie.preferredLanguages`, `Show.preferredLanguages`, `setMoviePreferredLanguages` and
`setShowPreferredLanguages` are **unchanged** — those are the per-title level and this feature does
not touch them.

`updateSettings` keeps its shape. What changes is the set of keys it accepts, which is contract in
practice even though the schema cannot express it — the two new keys are `ui_locale` (one of the
supported locale tags) and `default_languages` (a comma-separated list of ISO-639-1 codes, ordered,
possibly empty).

`SettingInput.value` currently carries `@IsNotEmpty()`, which makes the empty string unrepresentable
on the wire. `default_languages` must be clearable (REQ-7), so that field-level rule is relaxed to
"must be a string" and the emptiness rule moves per-kind into the settings catalog, where every other
per-kind rule already lives: `path`, `enum` and `int` keys reject an empty value with the existing
`error.validation.setting_value_required`; a `languages` key accepts it and means the empty list.
This is strictly tighter than today, which blocked `""` but accepted `"   "`.

`ui_locale` is validated as an ordinary `enum` key whose options are the supported locales — the
catalog's existing `kind: 'enum'` machinery, not a new kind and not a new error key. One consequence,
accepted: once an installation default is set it can be changed but not cleared, since the empty
string is not one of the options. Nothing in this feature needs to clear it — `en` is already the
final fallback.

| Condition | HTTP / GraphQL error | i18n key | Message the user sees |
| :-- | :-- | :-- | :-- |
| `ui_locale` is not a supported locale | `BadRequestException` | `error.setting.expected_enum` | existing copy — `La configuración "ui_locale" espera uno de: en, es` |
| `default_languages` contains an unknown ISO-639-1 code | `BadRequestException` | `error.language.unavailable` | `El idioma "zz" no está disponible` |
| `default_languages` repeats a code | `BadRequestException` | `error.language.duplicate` | `El idioma "es" está repetido` |
| A submitted key is not in the settings catalog | `BadRequestException` | `error.setting.not_editable` | `La configuración "x" no se puede editar` (existing) |
| A path value escapes its media root | `BadRequestException` | existing media-roots key | existing copy |
| Session expired while the form was open | `UnauthorizedException` | existing | existing — `web` clears the session and redirects to `/login` |
| A non-administrator calls `settings` or `updateSettings` | `ForbiddenException` | `error.auth.admin_required` | existing copy — the same one `users` returns |

What `web` does with each: the Save action surfaces the translated message in the single error slot
above the Save button, leaves every field's entered value in place, and does not switch tabs. An
`UnauthorizedException` goes through `redirectIfUnauthenticated` as it does today. A network failure
that never reaches `api` shows `errors.network.connectionFailed`.

`defaultUiLocale` returning `null` is not an error — it means unset, and `web` falls through to
`Accept-Language`.

## Data Model Changes

| Model | Change | Nullable / default | Backfill needed? |
| :-- | :-- | :-- | :-- |
| `Setting` | new row, key `ui_locale` | seeded `''`; `defaultUiLocale` reports `null` until an admin sets one | no |
| `Setting` | new row, key `default_languages` | seeded with `''` (empty list) | no — NFR-1, the old rows are discarded |
| `UserLanguage` (`user_languages`) | dropped | — | no |
| `User.languages` | relation removed | — | no |

No column on `User` changes: `uiLocale` already exists and keeps its meaning.

## Acceptance Criteria

- [ ] **AC-1**: `/settings` renders six underlined tabs with icons; clicking **Media Server** shows
      the client/host/port/API-key fields and hides the folder pickers, and General is the panel
      shown on first load.
- [ ] **AC-2**: With General set to a new language, Media Manager's movies folder changed, and
      Compresión's radios moved, pressing Save once produces one success message; reloading the page
      shows the new language and the new folder, and the Compresión radios back at their default.
- [ ] **AC-3**: `bin/mysql -e "select \`key\`, value from settings where \`key\` in ('ui_locale','default_languages')"`
      returns both rows after a save, with `default_languages` holding the codes chosen in Descarga
      in the order they were chosen.
- [ ] **AC-4 (failure path)**: With Media Manager's movies folder set to `../etc` **and** Descarga
      set to a valid language list, pressing Save shows the media-roots error, and
      `bin/mysql -e "select value from settings where \`key\`='default_languages'"` still returns the
      **previous** value — nothing on the screen was written.
- [ ] **AC-5 (failure path)**: A `updateSettings` call carrying `{ key: "ui_locale", value: "de" }`
      is rejected with `error.setting.expected_enum`, and `settings` still reports the previous
      `ui_locale`. A call carrying `{ key: "default_languages", value: "" }` is **accepted** and
      clears the list.
- [ ] **AC-6**: With `ui_locale` set to `es` and the browser sending `Accept-Language: en-US`, a
      logged-out visit to `/login` renders in Spanish. Setting the logged-in user's own `uiLocale`
      to `en` makes `/settings` render in English for that user while `/login` stays Spanish.
- [ ] **AC-7**: After the migration, `bin/mysql -e 'show tables like "user_languages"'` returns
      nothing and `default_languages` holds the empty string until an administrator saves the
      Descarga tab.
- [ ] **AC-8**: A film whose owner has a per-title preference of `fr` is queued for encode while
      `default_languages` is `es`; the `ProcessJob` details report `allowedLanguagesIso3` containing
      the original language, `spa` and `fra`, with the original first and no duplicates.
- [ ] **AC-9 (failure path)**: Signed in as a non-administrator, `/settings` is absent from the
      sidebar, and an `updateSettings` call made with that user's token is refused with
      `error.auth.admin_required` — `bin/mysql` shows the settings rows unchanged.
- [ ] **AC-10**: `bin/npm web run build` exits 0 and `bin/npm api run test` is green.

## Out of Scope

- **What Compresión actually controls.** The toggle and the radios are rendered and wired to
  nothing (REQ-9). Giving them meaning — a transcode on/off switch, a quality preset, a codec
  choice — changes `getVideoParams` in `services/worker/src/ffmpeg/params.ts` and the case corpus
  under `services/worker/ffmpeg/`, which is a `worker` feature with its own spec. That is why
  `worker` is not in `services:` here.
- **Per-user UI language editing.** `User.uiLocale` already exists and `setUiLocale` already works;
  this feature adds only the installation default beneath it. Where a user picks their own language
  is `020-profile-edit`'s screen, not this one.
- **The per-title download-language pickers.** `Movie.preferredLanguages` / `Show.preferredLanguages`
  and their two mutations keep working exactly as they do, from the film and series detail pages.
- **`torrent_port` and the other non-editable settings.** Still seeded, still read by the clients,
  still absent from the screen — the internal qBittorrent port is not a user-facing value.
