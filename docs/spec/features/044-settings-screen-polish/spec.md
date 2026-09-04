---
title: Settings Screen Polish
spec_version: 0.1.0
author: Juan "Dientuki" Farias
created_at: 2026-09-04
last_updated: 2026-09-04
status: Implemented
services: [api, web]
---

# SPEC: Settings Screen Polish (`spec.md`)

## Context & Goal

`029-settings-screen-tabs` split the administrator's Settings screen into six tabs
(`services/web/src/components/settings/`), and every tab since has been extended by whichever
feature needed it — `032` added the compression switch, `034` the media-server index panel, `035`
the scheduling panel. What none of them did was go back over the result as a whole. The screen now
carries a set of small inconsistencies that are individually trivial and collectively make it read
as unfinished: three tab icons that do not describe their tab, two bare `<select>` elements whose
native chevron does not match the rest of the design system, checkboxes where the neighbouring tab
uses switches, folder inputs that stay editable after their own enable toggle is turned off, a
"Settings saved." confirmation that survives a tab change and appears to confirm work the user has
not done, and a compression "Preset" radio group that is pure decoration — `CompressionPanel.tsx`
holds it in local state with a deliberately empty `name`, so nothing about it ever reaches the
database.

The larger of the two functional gaps is in the Torrent Manager tab. `021-user-preferences` shipped
the release-group machinery in full: `TorrentGroup` and `UserTorrentGroup` in the Prisma schema, a
`torrentGroups` catalog query, `setPreferredTorrentGroups`, and a picker per scope in
`/preferences`. What it never shipped is any way to put a group *into* that catalog — there is no
seed and no mutation, so `torrent_groups` is empty on every installation and `PreferencesForm.tsx`
renders "noneLoaded" on both its Movies and Series tabs for every user. The whole feature is
unreachable. This spec adds the administrator's side of it, in the Torrent Manager tab, using the
same badge-with-an-X presentation the language picker already uses for its chosen items.

Adding that ABM forces a modelling decision that `021` got the wrong way round. Today `scope` is a
column on `TorrentGroup` and the pair `(name, scope)` is unique, so an administrator wanting a group
usable for both films and series has to create it twice, and each user then picks between two rows
that mean the same thing. The intent is the opposite: the administrator curates one flat list of
permitted group names, and each user decides, per group, whether it applies to their films, to their
series, to both, or to neither. So `scope` moves off `TorrentGroup` and onto `UserTorrentGroup`,
where the per-user, per-scope choice actually lives. That is a Prisma migration and a GraphQL
contract change, which is what makes this a spec rather than a batch of small fixes.

No pipeline stage in the root `CLAUDE.md` changes status. `compression_resolution` becomes a stored,
validated setting and nothing more — the worker's downscale logic is untouched and still hardcoded,
so the Transcode row's description remains accurate.

## Requirements

### Functional Requirements

- [ ] **REQ-1 (Tab icons)**: The Media Server tab must use the `cast` icon, Compression the
      `file-video-camera` icon, and Media Manager the `library` icon. The other three tabs keep the
      icons they have.
- [ ] **REQ-2 (Select presentation)**: The single-choice dropdowns on the General tab (app language)
      and the Media Server tab (media server client) must render with the project's own chevron
      affordance rather than the browser's native `<select>` arrow, matching the pattern in the
      uncommitted `form/form-elements/SelectInputs.tsx` sample: a positioned chevron over an
      `appearance-none` control. The chevron comes from `lucide-react`, the icon source the rest of
      the codebase already uses. Every existing behaviour of those two dropdowns — `name`, submitted
      value, `disabled` state — must survive unchanged.
- [ ] **REQ-3 (Media Manager switches)**: "Enable movies" and "Enable series" must be rendered with
      the same `Switch` control the Compression tab uses, not a checkbox.
- [ ] **REQ-4 (Disabled gating)**: While "Enable movies" is off, the movies folder input must be
      non-editable; while "Enable series" is off, the series folder input must be non-editable. The
      stored value of a gated input must not be cleared or altered by the gating — turning the switch
      back on must reveal the value that was there before.
- [ ] **REQ-5 (Enablement persists)**: `movies_enabled` and `shows_enabled` must survive a save and a
      page reload, for both the on and the off transition, with the value visible in the
      `settings` table.
- [ ] **REQ-6 (Resolution setting)**: The Compression tab's "Preset" control must be relabelled
      "Resolution" and offer exactly `4k`, `1080p`, `720p` and `360p`. The chosen value must be
      persisted as the `compression_resolution` setting and re-read on the next render. Like the
      switch above it, it must be non-editable while compression is disabled.
- [ ] **REQ-7 (Save confirmation is transient)**: The "Settings saved." confirmation must disappear
      when the user switches to another tab. An error message follows the same rule.
- [ ] **REQ-8 (Group ABM)**: The Torrent Manager tab must offer an administrator a text input that
      adds a torrent group by name. Added groups appear below the input as badges carrying a remove
      (X) control, visually the same as the "chosen languages" badges in
      `preferences/LanguagePickerField.tsx`. Adding and removing must be persisted in the
      `torrent_groups` table.
- [ ] **REQ-9 (Groups are scope-free)**: A torrent group in the administrator's catalog carries no
      scope. The scope is the user's choice: in `/preferences`, a user may select any catalog group
      for their films, for their series, for both, or for neither, independently.
- [ ] **REQ-10 (Duplicate rejected)**: Adding a group whose name already exists in the catalog must
      be rejected with a message the user can read, and must not create a second row.
- [ ] **REQ-11 (Admin only)**: The two catalog mutations must be reachable only by an administrator.
      Reading the catalog stays available to any signed-in user, since `/preferences` needs it.

### Non-Functional & Operational Requirements

- [ ] **NFR-1 (Group migration)**: Dropping `TorrentGroup.scope` must not lose an existing user's
      selection. Two catalog rows sharing a name across the two scopes collapse into one, and every
      `user_torrent_groups` row is rewritten to carry the scope its group used to have, repointed at
      the surviving group row. In practice the table is empty on every installation today — the
      migration must still be correct if it is not.
- [ ] **NFR-2 (Seeded default)**: `compression_resolution` ships seeded at `1080p`, matching the
      behaviour the worker already implements. An installation upgrading into this feature must not
      find the key missing.
- [ ] **NFR-3 (Contract retype)**: `web` retypes the GraphQL surface by hand. Every consumer of
      `TorrentGroup.scope` and of `torrentGroups(scope:)` in `services/web/src` — `types/preferences.ts`,
      `actions/preferences.ts`, `PreferencesForm.tsx`, `TorrentGroupPickerField.tsx` — must be
      updated in the same feature, since the removal produces no compile error in `api`.
- [ ] **NFR-4 (No sample files shipped)**: `services/web/src/components/form/form-elements/` is an
      uncommitted TailAdmin sample gallery importing from a `@/icons` alias this project does not
      have; it does not compile. It is reference material for REQ-2 only and must not be committed.
- [ ] **NFR-5 (Copy is catalog-driven)**: Every new or changed user-facing string lands in both
      `services/web/messages/en.json` and `es.json`, and every new api error carries an
      `extensions.i18n` key (`018-ui-i18n`).

## GraphQL Contract Delta

```graphql
type TorrentGroup {
  id: Int!
  name: String!
}

enum TorrentGroupScope {
  MOVIE
  SHOW
}

type UserPreferences {
  allowCinemaReleases: Boolean!
  audioMandatory: Boolean!
  audioLanguages: [Language!]!
  subtitleLanguages: [Language!]!
  movieTorrentGroups: [TorrentGroup!]!
  showTorrentGroups: [TorrentGroup!]!
}

type Query {
  torrentGroups: [TorrentGroup!]!
}

type Mutation {
  createTorrentGroup(name: String!): TorrentGroup!
  deleteTorrentGroup(id: Int!): Boolean!
  setPreferredTorrentGroups(scope: TorrentGroupScope!, ids: [Int!]!): [TorrentGroup!]!
}
```

Removed, and therefore breaking for `web`:

- `TorrentGroup.scope` — the field no longer exists.
- `torrentGroups(scope: TorrentGroupScope)` — the argument is gone; the query returns the whole
  catalog. A caller that still passes `scope` gets a GraphQL validation error, not an ignored
  argument.
- `UserPreferences.torrentGroups` — replaced by the two scope-specific fields above, mirroring the
  `audioLanguages`/`subtitleLanguages` split already on this type. `web` no longer filters one list
  by `scope` client-side.

Unchanged: `setPreferredTorrentGroups` keeps its signature and still returns the caller's selection
for the scope it was given. What changes underneath is that any catalog id is now valid for either
scope, so the "group belongs to another scope" rejection disappears.

| Condition | HTTP / GraphQL error | Message the user sees |
| :-- | :-- | :-- |
| `createTorrentGroup` with a name already in the catalog (compared trimmed, case-insensitively) | `BadRequestException`, `error.torrent_group.name_taken` | `Ya existe un grupo llamado {name}` |
| `createTorrentGroup` with an empty or whitespace-only name | `BadRequestException`, `error.validation.torrent_group_name_required` | `El nombre del grupo no puede estar vacío` |
| `deleteTorrentGroup` with an id no row has | `NotFoundException`, `error.torrent_group.not_found` | `El grupo de torrents {id} no existe` (existing key and copy) |
| Either mutation called by a non-administrator | `ForbiddenException`, `error.auth.admin_required` | existing `AdminGuard` behaviour, untranslated today — falls back to the api's English message |
| `updateSettings` with `compression_resolution` outside `4k`/`1080p`/`720p`/`360p` | `BadRequestException`, `error.setting.expected_enum` | existing enum message, listing the four values |

`error.torrent_group.name_taken` is a **new** key. The existing `error.torrent_group.duplicated`
(`El grupo de torrents {id} está repetido`) means something else — a repeated id inside a
`setPreferredTorrentGroups` list — and must not be reused for the name collision.

What `web` does with each: the Torrent Manager panel renders the duplicate, empty-name and not-found
messages inline next to the group input and leaves the badge list as it was — it must not
optimistically add or remove a badge before the mutation resolves. The forbidden case cannot be
reached from this screen (`/settings` is admin-only already) and falls through to the generic error
banner. The enum rejection surfaces in the main form's existing error paragraph.

`error.torrent_group.wrong_scope` becomes unreachable once scope leaves the group; it is removed
from `error-keys.ts` and from both message catalogs.

## Data Model Changes

| Model | Change | Nullable / default | Backfill needed? |
| :-- | :-- | :-- | :-- |
| `TorrentGroup` | Drop column `scope` | — | Yes — collapse rows sharing a `name` across scopes into one before dropping |
| `TorrentGroup` | `@@unique([name, scope])` → `name String @unique` | — | Depends on the collapse above |
| `UserTorrentGroup` | Add column `scope TorrentGroupScope` | Non-null, no default | Yes — from the group's old `scope` |
| `UserTorrentGroup` | `@@id([userId, torrentGroupId])` → `@@id([userId, torrentGroupId, scope])` | — | Follows the backfill |
| `Setting` | New row `compression_resolution` | Seeded `'1080p'` | No — create-only seed, same as every other key |

The `TorrentGroupScope` enum survives: it moves from `torrent_groups` to `user_torrent_groups` and
stays in the GraphQL surface as the argument of `setPreferredTorrentGroups`.

## Acceptance Criteria

- [x] **AC-1**: On `/settings`, the Media Server, Compression and Media Manager tabs show the
      `cast`, `file-video-camera` and `library` icons respectively.
- [x] **AC-2**: The app-language and media-server dropdowns show the project chevron; picking a value
      and pressing Save still persists it — `bin/mysql -e "select value from settings where key='ui_locale'"`
      returns the chosen locale.
- [x] **AC-3**: On the Media Manager tab, "Enable movies" and "Enable series" render as switches.
      Turning "Enable movies" off makes the movies folder input non-editable; turning it back on
      restores the same folder value that was displayed before.
- [x] **AC-4**: Turning "Enable series" on, saving, and reloading the page shows it still on, and
      `bin/mysql -e "select value from settings where key='shows_enabled'"` prints `true`. Turning it
      off, saving and reloading prints `false`.
- [x] **AC-5**: On the Compression tab, the control is labelled Resolution and offers exactly 4k,
      1080p, 720p and 360p. Choosing `720p` and saving makes
      `bin/mysql -e "select value from settings where key='compression_resolution'"` print `720p`,
      and the choice survives a reload.
- [x] **AC-6** *(failure path)*: An `updateSettings` call carrying
      `{key: "compression_resolution", value: "480p"}` returns a GraphQL error whose
      `extensions.i18n.key` is `error.setting.expected_enum`, and
      `bin/mysql -e "select value from settings where key='compression_resolution'"` still prints the
      previous value.
- [x] **AC-7**: Pressing Save shows "Settings saved."; clicking any other tab makes it disappear, and
      it does not return until the next save.
- [x] **AC-8**: On the Torrent Manager tab, typing `FLUX` and confirming adds a badge labelled `FLUX`
      below the input, and `bin/mysql -e 'select name from torrent_groups'` lists it. Clicking the X
      on that badge removes it from both the screen and the table.
- [x] **AC-9** *(failure path)*: Adding `FLUX` a second time shows the duplicate message next to the
      input, adds no badge, and `bin/mysql -e 'select count(*) from torrent_groups where name="FLUX"'`
      still prints `1`.
- [x] **AC-10**: With `FLUX` in the catalog, a non-admin user on `/preferences` sees it offered on
      both the Movies and the Series tab. Selecting it for Series only, saving and reloading shows it
      chosen for Series and not for Movies, and `bin/mysql -e 'select scope from user_torrent_groups'`
      prints a single `SHOW` row.
- [x] **AC-11**: `bin/npm api run test`, `bin/npm web run build` and the api typecheck all exit 0,
      with no reference to `TorrentGroup.scope` remaining in `services/web/src`.

## Out of Scope

- **The worker acting on `compression_resolution`.** The setting is stored and validated; nothing
  reads it. The worker keeps its current rule (HEVC 4K downscaled to 1080p, everything else left at
  source resolution). Wiring it in means a job-payload change and a `worker` slice, and is its own
  feature.
- **Torrent groups influencing release selection.** The catalog and the per-user selection are
  configuration only; `src/lib/torrent-ranking.ts` and the indexer search do not consult them. That
  was already true of `021-user-preferences` and stays true here.
- **Renaming a group.** The ABM is add and remove. A rename is a mutation nobody asked for, and
  removing plus re-adding achieves it at the cost of the users' selections — which is arguably the
  honest outcome anyway.
- **Seeding a starter catalog.** No group names ship with the installation; the administrator
  curates the list from empty.
- **Restyling the remaining form controls.** REQ-2 covers the two single-choice dropdowns on
  General and Media Server. `MultiSelect.tsx`, the path pickers and the scheduling panel's inputs
  are left alone.
- **Committing the TailAdmin sample gallery.** See NFR-4 — `form/form-elements/` is reference
  material for this spec and is expected to be gone by the time the feature closes.
