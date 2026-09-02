---
title: User Preferences
spec_version: 0.2.0
author: Juan "Dientuki" Farias
created_at: 2026-08-19
last_updated: 2026-09-01
status: Approved
services: [api, web]
---

# SPEC: User Preferences (`spec.md`)

## Context & Goal

Perceptor has an installation-wide configuration screen and nothing per-user. `/settings` is six
tabs (`029-settings-screen-tabs`) writing rows of the global `Setting` table through
`updateSettings`, and every preference a person might reasonably want to hold on their own either
does not exist or was pushed into that global table because there was nowhere else to put it. The
clearest case is the download languages: `029` deliberately moved that level from per-user to
installation-wide (`default_languages`, read by `ProcessJobsService.resolveDefaultLanguages`),
which means two people sharing an install cannot want different audio. The second clearest is the
interface language: `User.uiLocale` exists, `setUiLocale` exists, and
`services/web/src/i18n/request.ts` already resolves *user → installation → `Accept-Language` → `en`*
— but no screen ever calls `setUiLocaleAction`, so the per-user step of that chain is unreachable
and the override is theoretical.

This feature creates the screen those preferences belong on. `/preferences`, titled *Preferencias*,
holds three groups. **Idiomas**: the language Perceptor's interface speaks for this user — which
overrides the installation default — plus, separately, the audio languages and the subtitle
languages to keep when downloading. **Películas**: whether releases recorded in a cinema (CAM/TS)
are acceptable, and the preferred torrent groups for films. **Series**: the preferred torrent groups
for series. `/settings` keeps everything installation-wide and loses the *Descarga* tab, whose only
control was the download-languages picker that this screen replaces.

Two boundaries define the size of this work. The first: **audio and subtitles are separated here,
and only here.** Today one list serves both — the encode payload carries a single
`allowedLanguagesIso3` that `services/worker/src/ffmpeg/buildCommand.ts` hands to `getAudioParams`
and `getSubtitleParams` alike. Splitting that contract is its own spec, with `worker` in its
`services:` list; this one stores the two lists and shows them. The second: **nothing consumes any
of these values yet.** The cinema flag is stored for a later automatic search that does not exist.
The torrent-group selection is stored while `services/web/src/lib/torrent-ranking.ts` keeps ranking
against its hardcoded `PREFERRED_GROUPS = ["ntb", "btm", "flux"]` (`036-torrent-ranking-heuristic`,
REQ-6); pointing that heuristic at the user's own list is a later spec too. What this feature buys
is the shape: a per-user home for preferences, and the audio/subtitle split existing as data before
the pipeline is asked to honour it.

No pipeline stage in the root `CLAUDE.md` changes status. Every encode after this ships selects
exactly the tracks it selected before it.

> **Supersedes `spec_version` 0.1.0 of this same directory.** That version was approved on
> 2026-08-19 and never implemented, and the repo moved underneath it: it planned to *move*
> `PreferredLanguagesCard` off `/settings`, a component `029-settings-screen-tabs` has since
> deleted, and it assumed a per-user global language level (`user_languages`) that the same feature
> dropped. Its `plan.md`, `tasks.md` and service plans were removed rather than left to look like
> pending work.

## Requirements

### Functional Requirements

- [ ] **REQ-1 (Two screens)**: There must be exactly two configuration screens with no overlap.
      `/preferences`, titled *Preferencias*, holds everything scoped to the signed-in user.
      `/settings`, titled *Ajustes*, holds installation-wide configuration only. A control appears
      on one or the other, never on both.

- [ ] **REQ-2 (Navigation)**: Both screens must be reachable. The sidebar
      (`services/web/src/layout/AppSidebar.tsx`) and the header user menu
      (`services/web/src/components/header/UserDropdown.tsx`) must each offer *Preferencias*
      alongside the existing *Ajustes* entry, and *Ajustes* must keep pointing at `/settings`.
      **`/preferences` is visible to every signed-in user, administrator or not.** `/settings` has
      been administrator-only since `029-settings-screen-tabs` — `AdminGuard` on the resolver, a
      `notFound()` on the page, and the sidebar entry rendered only when `isAdmin` — and none of
      that may leak onto the new screen: a preference is the one thing on either screen that a
      non-administrator must be able to edit.

- [ ] **REQ-3 (Group: Idiomas)**: The *Idiomas* group must show three controls:

      1. **Idioma de Perceptor** — a single choice among `supportedLocales`, saved on the caller.
         Choosing one must take precedence over the installation's `ui_locale` setting; leaving it
         unset must fall back to it. This is the existing `setUiLocale` mutation, given the control
         that `018-ui-i18n` deliberately did not build.
      2. **Idiomas de audio** — a multi-select over the `languages` catalog.
      3. **Idiomas de subtítulos** — a second, independent multi-select over the same catalog.

      The two language lists are independent in both directions: saving one must leave the other
      exactly as it was. The copy must state that the title's original language and subtitles are
      always kept regardless, so that an empty selection reads as a deliberate answer rather than a
      missing one.

- [ ] **REQ-4 (Group: Películas)**: The *Películas* group must show a yes/no control for whether
      cinema-recorded releases are acceptable, and a multi-select of preferred torrent groups
      restricted to the film catalog.

- [ ] **REQ-5 (Group: Series)**: The *Series* group must show a multi-select of preferred torrent
      groups restricted to the series catalog. Changing the film selection must leave the series
      selection untouched, and the reverse.

- [ ] **REQ-6 (The Descarga tab goes away, and only the tab)**: `/settings` must stop rendering the
      *Descarga* tab and the `DownloadPanel` inside it. **The `default_languages` row itself
      survives, keeps its value, stays in `SETTINGS_CATALOG`, and keeps being merged into every
      encode by `ProcessJobsService` exactly as it is today.** Only its editor disappears — until
      the worker spec decides whether the per-user lists replace it or it is retired, the row is
      read-only in practice, and that is the intended state rather than an oversight. Removing the
      row here would silently narrow every encode's track selection in a feature that changes no
      encode.

- [ ] **REQ-7 (Empty is the shipping state)**: A newly created user must start with no audio
      languages, no subtitle languages, no torrent groups and *cinema not allowed* — with no rows
      written on their behalf, the boolean's default supplying the last one. The torrent-group
      catalog also ships empty, because the administrator screen that fills it does not exist yet:
      each group picker must then render an explanatory message saying no groups have been loaded,
      with nothing selectable, no mutation sent, and the rest of the screen working.

- [ ] **REQ-8 (Every control saves on its own)**: Each of the six controls must persist
      independently. A failure saving one must leave the other five untouched and must not stop the
      user from saving them. There is no single *Guardar* button spanning the screen.

- [ ] **REQ-9 (Self only)**: Every read and every write on this screen targets the authenticated
      caller. No query and no mutation accepts a user id, and none of this surface may be reachable
      from the admin `users` / `user(id)` queries — an administrator listing users must not be able
      to select another person's preferences at all.

- [ ] **REQ-10 (Kind and scope are enforced, not assumed)**: A torrent group belongs to exactly one
      scope, films or series. Saving a film selection that names a series group must be refused
      outright, never silently filtered down to the valid subset: a caller told "saved" about a set
      that is not what it sent is the failure this requirement exists to prevent. The same holds for
      an unknown or repeated language tag on either language list.

- [ ] **REQ-11 (Replace, never merge — and narrowly)**: Saving replaces the whole set for **one**
      kind or **one** scope; an empty list clears that one. The write must be validated in full
      before anything is persisted and applied atomically, matching the pattern
      `services/api/src/languages/languages.service.ts` documents in its file header. The delete
      half of each replace must be narrowed to the kind or scope being written — a delete keyed on
      the user alone would wipe the sibling list with no error anywhere.

- [ ] **REQ-12 (Deleting a user deletes their preferences)**: Removing a user must remove every
      preference row belonging to them, through the schema rather than through cleanup code in
      `UsersService.remove`.

### Non-Functional & Operational Requirements

- [ ] **NFR-1 (Persist and display only)**: Nothing may start reading these values in this feature.
      `services/web/src/lib/torrent-ranking.ts` keeps its hardcoded `PREFERRED_GROUPS`;
      `ProcessJobsService`'s merge, the `ProcessJobDetails` payload and every file under
      `services/worker/src/ffmpeg/` are untouched. `worker` is not in `services:` for exactly this
      reason.

- [ ] **NFR-2 (Additive migration, no backfill)**: The migration is one `ADD COLUMN` plus three new
      tables and two new enums. Every existing user reads as "cinema not allowed, nothing selected"
      from the column default and the absence of rows, with nothing written on their behalf.

- [ ] **NFR-3 (Installation settings untouched)**: `updateSettings`, `SettingInput` and
      `SETTINGS_CATALOG` must not change — including `default_languages`, which keeps its catalog
      entry (REQ-6). Nothing here is a settings key and nothing may be added to `EDITABLE_KEYS` in
      `services/web/src/actions/settings.ts`.

- [ ] **NFR-4 (Catalog copy only)**: Every visible string on the new screen comes from
      `services/web/messages/{en,es}.json`. This feature introduces no Spanish literal in
      `services/web/src` and no rendered Spanish sentence on the API boundary — `api` ships an error
      key plus English `message`, per `docs/spec/graphql-contract.md` § UI internationalization.

- [ ] **NFR-5 (No regression)**: `bin/cli api npx --no tsc --noEmit` and
      `bin/cli web npx --no tsc --noEmit` must both report 0 errors, `bin/npm web run build` must
      exit 0, and `bin/npm api test` must report no failures — each measured before and after.

## GraphQL Contract Delta

Frozen once `status: Approved` (Constitution, Article VIII). `web` retypes all of this by hand and
no codegen checks it.

The interface-language control adds **nothing** here: `User.uiLocale`, `Query.supportedLocales` and
`Mutation.setUiLocale` are `018-ui-i18n`'s contract, already implemented, consumed as they stand.
`Query.languages` is likewise re-used unchanged as the source of both language pickers.

### Schema

```graphql
"""Which side of the encode a language preference applies to."""
enum LanguageTrackKind {
  AUDIO
  SUBTITLE
}

enum TorrentGroupScope {
  MOVIE
  SHOW
}

"""A release group, scoped to films or to series. The catalog is administrator-curated."""
type TorrentGroup {
  id: Int!
  name: String!
  scope: TorrentGroupScope!
}

"""The signed-in caller's own preferences. Never reachable from another user."""
type UserPreferences {
  """CAM/TS releases acceptable for this user. False for every user until they say otherwise."""
  allowCinemaReleases: Boolean!
  audioLanguages: [Language!]!
  subtitleLanguages: [Language!]!
  """The caller's selection, both scopes in one list — web splits it by `scope`."""
  torrentGroups: [TorrentGroup!]!
}

type Query {
  preferences: UserPreferences!

  """The full catalog the pickers read from. Empty until an administrator loads it."""
  torrentGroups(scope: TorrentGroupScope): [TorrentGroup!]!
}

type Mutation {
  setAllowCinemaReleases(allowed: Boolean!): UserPreferences!

  """Replaces the caller's list for one kind; [] clears it. The other kind is untouched."""
  setPreferredTrackLanguages(kind: LanguageTrackKind!, tags: [String!]!): [Language!]!

  """Replaces the caller's selection for one scope; [] clears it. The other scope is untouched."""
  setPreferredTorrentGroups(scope: TorrentGroupScope!, ids: [Int!]!): [TorrentGroup!]!
}
```

Notes the SDL cannot carry:

- **The preferences hang off `Query.preferences`, not off `User`.** `029-settings-screen-tabs`
  deleted the guarded `User.preferredLanguages` field resolver and the comment it left behind in
  `services/api/src/users/entities/user.entity.ts` records why it existed: a field resolver attaches
  per *type*, so anything added to `User` is selectable through the admin `users` / `user(id)`
  queries and has to be defended by a runtime identity check that returns `[]`. Re-adding that
  shape would re-add that leak and the check guarding it. A query rooted at the caller cannot be
  selected from another user's row at all, which is REQ-9 made structural instead of enforced.

- **`Query.torrentGroups` is the catalog; `UserPreferences.torrentGroups` is the selection.** Same
  word, two different things, deliberately: the picker renders the first and marks the second inside
  it. Neither is filtered by `web` beyond splitting on `scope`.

- **`preferences.torrentGroups` returns both scopes in one list**, and `web` splits it to fill the
  two pickers, so the *Películas* and *Series* cards can never disagree about what is saved — they
  read the same array. The two **language** lists are separate fields instead, because a `Language`
  row carries no kind of its own: one merged list would be unsplittable on the client.

- **Every write is scoped or kinded; every read is not.** `setPreferredTrackLanguages` replaces one
  kind and `setPreferredTorrentGroups` one scope, leaving the sibling rows in place (REQ-11). An
  implementation that deletes every row for the user before inserting passes a single-list test and
  silently wipes the other list.

- **Languages are addressed by BCP-47 `tag`, not by id** — the same argument shape
  `setMoviePreferredLanguages` / `setShowPreferredLanguages` already take, and the reason
  `030-language-regional-variants` gives for it: `iso2` stopped being unique the moment `es-419` and
  `es-ES` were seeded. Torrent groups are addressed by `Int!` id, since a group name is only unique
  within its scope.

- **Validation precedes every write** (REQ-10, REQ-11). Unknown, duplicated and wrong-scope entries
  are all checked against the catalog before a row is touched.
  `LanguagesService.validateAndResolveLanguageIds` is already public and already throws the two
  language keys below; the torrent-group checks are new and mirror it.

- **No operation here takes a user id, and none carries `@AllowService()`** (REQ-9). The target is
  always `@CurrentUser()`, and a service principal authenticated with `SERVICE_TOKEN` has no
  preferences — the same stance `me` and `setUiLocale` already take.

- **`Query.torrentGroups` is readable by any authenticated user**, not admin-only. It is a catalog
  of names, and every user needs it to render their own pickers; that the catalog is
  administrator-*written* is not a reason to make it administrator-*readable*.

### Error table

Five-column form, per `docs/spec/graphql-contract.md` § UI internationalization: `api` returns an
English `message` plus `extensions.i18n = { key, params }` and `web` translates.

| Condition | Exception | Key | Params | English `message` |
| :-- | :-- | :-- | :-- | :-- |
| A tag in `tags` matches no `languages` row | `BadRequestException` | `error.language.unavailable` | `tag` | *(existing key, unchanged)* |
| A tag appears twice in `tags` | `BadRequestException` | `error.language.duplicate` | `tag` | *(existing key, unchanged)* |
| An id in `ids` matches no `torrent_groups` row | `BadRequestException` | `error.torrent_group.not_found` | `id` | `Torrent group {id} does not exist` |
| An id appears twice in `ids` | `BadRequestException` | `error.torrent_group.duplicated` | `id` | `Torrent group {id} is repeated` |
| An id's row has a different `scope` than the argument | `BadRequestException` | `error.torrent_group.wrong_scope` | `id`, `scope` | `Torrent group {id} does not belong to {scope}` |
| Unsupported locale on `setUiLocale` | `BadRequestException` | `error.user.unsupported_locale` | — | *(existing key, unchanged)* |
| No credential, expired session, or a service principal | `UnauthorizedException` | `error.auth.unauthenticated` | — | `Not authenticated` |

The two `error.language.*` keys and `error.auth.unauthenticated` already exist in
`services/api/src/i18n/error-keys.ts` and in both message catalogs; re-using them is the point.
The three `error.torrent_group.*` keys are new and need an entry per locale.

**What `web` does with each.** The five `BadRequestException` rows surface as an inline message on
the card that failed, leaving the other cards alone (REQ-8), **with that card's selection reverted
to what the server still holds** — a picker left showing a set the API refused is a UI that
disagrees with the database until the next reload, which is worse than the refusal it is reporting.
`error.auth.unauthenticated` never reaches a card: `redirectIfUnauthenticated` intercepts it in the
server action, clears the cookie and sends the browser to `/login`, as every action under
`services/web/src/actions/` already does. `setAllowCinemaReleases` has no failure of its own — a
boolean cannot be invalid — so the unauthenticated path is its only one.

## Data Model Changes

Owned by `api` (Constitution, Article III). One migration, additive.

| Model | Change | Nullable / default | Backfill needed? |
| :-- | :-- | :-- | :-- |
| `User` | `+ allowCinemaReleases Boolean @default(false)` | non-null, defaults `false` | **No** — the default is the right answer for every existing row, and for every future one (REQ-7) |
| `User` | `+ languages UserLanguagePreference[]`, `+ torrentGroups UserTorrentGroup[]` (back-relations) | — | — |
| `Language` | `+ userPreferences UserLanguagePreference[]` (back-relation) | — | — |
| `UserLanguagePreference` *(new)* | `userId String`, `languageId Int`, `kind LanguageTrackKind`; `@@id([userId, languageId, kind])`, `@@index([languageId])`, `@@map("user_language_preferences")`; both relations `onDelete: Cascade` | — | **No** |
| `TorrentGroup` *(new)* | `id Int @id @default(autoincrement())`, `name String`, `scope TorrentGroupScope`; `@@unique([name, scope])`, `@@map("torrent_groups")` | — | **No** — ships empty by design (REQ-7) |
| `UserTorrentGroup` *(new)* | `userId String`, `torrentGroupId Int`; `@@id([userId, torrentGroupId])`, `@@index([torrentGroupId])`, `@@map("user_torrent_groups")`; both relations `onDelete: Cascade` | — | **No** |
| `LanguageTrackKind` *(new enum)* | `AUDIO`, `SUBTITLE` | — | — |
| `TorrentGroupScope` *(new enum)* | `MOVIE`, `SHOW` | — | — |

Notes:

- **`user_language_preferences`, not `user_languages`.** The latter name belonged to the per-user
  global language table that `029-settings-screen-tabs` dropped; a table with the old name and a
  different shape would read, in a migration history and in a `show tables`, as that one coming
  back. `kind` in the primary key is what lets the same language be chosen for audio and for
  subtitles independently.

- **`@@unique([name, scope])` rather than `@@unique([name])`** on `TorrentGroup`: the same release
  group can plausibly appear in both catalogs, and the two lists are curated independently.

- **`onDelete: Cascade` on every user-side relation** is REQ-12. `UserMovie` / `UserShow` already
  establish this pattern in `schema.prisma`; the deletion path stays in the schema so no future
  caller of `prisma.user.delete` has to remember it.

- **`allowCinemaReleases` sits on `User`, not in `Setting`** (NFR-3). It is per-user — two people on
  one install can disagree — and `Setting` is a single global key/value table with no user
  dimension.

## Acceptance Criteria

- [ ] **AC-1**: `/preferences` renders three groups — *Idiomas*, *Películas*, *Series* — with the
      six controls REQ-3 to REQ-5 list, and `/settings` shows five tabs with no *Descarga* among
      them. `grep -rn "DownloadPanel" services/web/src` returns nothing.

- [ ] **AC-2**: Signed in as an administrator, the sidebar and the header user menu both show
      *Preferencias* and *Ajustes*, landing on `/preferences` and `/settings` respectively.

- [ ] **AC-2b**: Signed in as a **non-administrator**, the sidebar shows *Preferencias* and not
      *Ajustes*, and `/preferences` renders in full — the six controls all present and all
      writable.

- [ ] **AC-3**: With the installation's `ui_locale` set to `es`, a user who picks English on
      `/preferences` and reloads sees Perceptor in English, `me { uiLocale }` returns `en`, and a
      second user who never picked one still sees Spanish — the override applies to its owner only.

- [ ] **AC-4**: Selecting two audio languages and one subtitle language, then reloading, shows
      exactly that;
      `bin/mysql -e 'select kind, count(*) from user_language_preferences group by kind'` prints
      `AUDIO 2` and `SUBTITLE 1`.

- [ ] **AC-5** *(failure path — the silent one)*: With both lists populated, saving the audio list
      alone leaves the subtitle list intact, and the reverse. Verified on the row count above before
      and after each save, not only in the UI.

- [ ] **AC-6**: Ticking *Permitir películas de cine* and reloading keeps it ticked, and
      `bin/mysql -e 'select allowCinemaReleases from users where username = "<username>"'` prints
      `1`; unticking and reloading prints `0`. A user created afterwards through `/users` prints `0`
      with no row written for them anywhere.

- [ ] **AC-7**: On a freshly migrated install, `torrentGroups` returns `[]` and both group pickers
      render the "no groups loaded" message, with nothing selectable and no mutation sent.

- [ ] **AC-8**: After inserting one `MOVIE` row and one `SHOW` row by hand
      (`bin/mysql -e "insert into torrent_groups (name, scope) values ('GRUPO-A','MOVIE'),('GRUPO-B','SHOW')"`),
      selecting the film group and reloading keeps it selected with the series selection still
      empty; selecting the series group afterwards leaves the film selection in place.

- [ ] **AC-9** *(failure path)*: `setPreferredTorrentGroups(scope: MOVIE, ids: [<the SHOW row's id>])`
      is refused with `error.torrent_group.wrong_scope`, and `preferences { torrentGroups { id } }`
      afterwards shows the previously saved set unchanged.

- [ ] **AC-10** *(failure path)*: `setPreferredTorrentGroups` with an id matching no row is refused
      with `error.torrent_group.not_found`, and with the same id twice with
      `error.torrent_group.duplicated`. In both cases
      `bin/mysql -e 'select count(*) from user_torrent_groups'` prints the same number before and
      after.

- [ ] **AC-11** *(failure path)*: `setPreferredTrackLanguages(kind: AUDIO, tags: ["zz"])` is refused
      with `error.language.unavailable` and `setPreferredTrackLanguages(kind: AUDIO, tags: ["en","en"])`
      with `error.language.duplicate`; `user_language_preferences` is unchanged after each.

- [ ] **AC-12** *(failure path)*: `preferences`, `setPreferredTrackLanguages`,
      `setPreferredTorrentGroups` and `setAllowCinemaReleases` called with `SERVICE_TOKEN` as the
      bearer are all refused with `error.auth.unauthenticated`.

- [ ] **AC-13** *(failure path)*: `users { id preferences { allowCinemaReleases } }` fails to
      validate — there is no such field on `User`, and no query in the schema accepts a user id and
      returns preferences.

- [ ] **AC-14**: Deleting a user through `removeUser` leaves no row of theirs behind:
      `bin/mysql -e 'select count(*) from user_language_preferences where userId = "<id>"'` and the
      same against `user_torrent_groups` both print `0`.

- [ ] **AC-15**: `bin/mysql -e "select value from settings where \`key\` = 'default_languages'"`
      prints the same value before and after this feature ships, and an encode started afterwards
      logs the same `allowedLanguagesIso3` it logged before — the Descarga tab is gone, its data is
      not (REQ-6, NFR-1).

- [ ] **AC-16**: `bin/cli api npx --no tsc --noEmit` and `bin/cli web npx --no tsc --noEmit` report
      0 errors, `bin/npm web run build` exits 0, and `bin/npm api test` reports no failures.

## Out of Scope

- **Splitting audio and subtitle languages in the encode.** The single `allowedLanguagesIso3` list
  in the `ProcessJobDetails` payload, `ProcessJobsService.collectAllowedLanguages`, and the
  `getAudioParams` / `getSubtitleParams` call pair in
  `services/worker/src/ffmpeg/buildCommand.ts` are all untouched. That is its own spec, with
  `worker` in its `services:` list, and it is the one that will decide what happens to
  `default_languages` and to the per-title pickers. This feature exists partly so that spec has
  data to read when it lands.

- **Retiring the `default_languages` setting.** Its row, its `SETTINGS_CATALOG` entry and its
  contribution to every encode all survive (REQ-6). Only its editor is removed.

- **Splitting the per-title language pickers.** `user_movie_languages` and `user_show_languages`,
  edited from a film's or series' detail page, stay one list each. Same reason as above.

- **Making `036-torrent-ranking-heuristic` read the user's groups.** `PREFERRED_GROUPS` stays a
  hardcoded constant in `services/web/src/lib/torrent-ranking.ts`. Wiring the preference in means
  deciding whether an unmatched group is a demotion or an exclusion, and whether the ranking runs
  per-user at all — a question this spec does not answer.

- **The administrator CRUD that fills the torrent-group catalog.** Named by the user as separate
  from the start. This feature creates the tables, the query and the pickers; until that screen
  exists the catalog is filled by hand or not at all, which is why REQ-7 makes the empty state a
  requirement rather than leaving it to whoever writes the picker.

- **The automatic search `allowCinemaReleases` is being stored for**, and any parsing of a release
  title to decide whether it is CAM/TS. The flag is recorded now so the preference is already there
  when that feature arrives; interpreting it belongs with whoever consumes it.

- **Per-title torrent-group overrides.** Languages have them; groups deliberately do not. Adding
  them later is one more table in the same shape, with no change to what this feature builds.

- **Anything about how `/settings` is guarded.** It is already administrator-only
  (`029-settings-screen-tabs`) and stays exactly as guarded as it is. One pre-existing rough edge is
  deliberately left alone: the header menu's *Ajustes* item is rendered for everyone, so a
  non-administrator who clicks it lands on a 404. Fixing that is a one-line change in
  `UserDropdown.tsx` that has nothing to do with this feature, and doing it here would hide a
  behaviour change inside a screen split.

- **Moving any other control off `/settings`.** The paths, the API keys, the enabled toggles, the
  media-server block and the compression settings are installation-wide and stay where they are
  (NFR-3).
