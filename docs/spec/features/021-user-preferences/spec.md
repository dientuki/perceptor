---
title: User Preferences
spec_version: 0.1.0
author: Juan Farias
created_at: 2026-08-19
last_updated: 2026-08-19
status: Approved
services: [api, web]
---

# SPEC: User Preferences (`spec.md`)

## Context & Goal

`/settings` is one screen doing two unrelated jobs. Most of it —
`services/web/src/components/settings/SettingsForm.tsx` — posts installation-wide key/value
configuration through the `updateSettings` mutation, validated against `SETTINGS_CATALOG`
(`services/api/src/settings/settings.catalog.ts`): the download and library paths, the TMDB and
Prowlarr API keys, the media-server block. Bolted on underneath it is `PreferredLanguagesCard.tsx`,
which is not that at all. It is a **per-user** preference with its own server action
(`setPreferredLanguagesAction`) and its own mutation (`setPreferredLanguages`), and the component
carries a comment saying in so many words that it is deliberately not part of `SettingsForm` because
there is no settings key behind it. One screen, two owners, two persistence models, one title.

This feature pulls the per-user half out and calls it what it is: *Preferencias*. What is left on
`/settings` is installation-wide configuration and nothing else. *Preferencias* is a new screen at
`/preferences` holding three groups. **Idiomas**: the language Perceptor's own interface speaks for
this user, and the additional languages to keep when downloading content — additional, because the
title's original language and its subtitles are always kept regardless, which is what
`ProcessJobsService`'s `{original} ∪ preferences` rule already does today
(`services/api/src/process-jobs/process-jobs.service.ts:115`). **Películas**: whether releases
recorded in a cinema are acceptable, plus the preferred torrent groups for films. **Series**: the
preferred torrent groups for series.

Half of that surface already has its backing and is being *moved*, not built. `setPreferredLanguages`
ships today in `services/api/src/languages/languages.resolver.ts`. The interface language is
`018-ui-i18n`'s `User.uiLocale`, `supportedLocales` and `setUiLocale` — approved, not yet
implemented, and written on the explicit understanding that someone else builds the control: its
REQ-13 says the list exists so that "the picker this feature deliberately does not build has a list
to read". This is that picker, and it re-uses 018's contract rather than restating it. The genuinely
new surface is two things: a boolean on `User` for cinema releases, and a catalog of torrent groups
with a per-user, per-scope selection over it.

Both of those are stored and displayed here, and consumed by nothing. The cinema flag exists because
Perceptor will later be able to go looking for a title on its own, before it has been released on
home formats, where the only releases that exist are CAM/TS — the flag is the user saying whether
that is acceptable for them. That automatic search is not this feature. Likewise, the torrent-group
catalog ships **empty**: filling it is an administrator's job through a CRUD screen that does not
exist yet, so the empty state is a first-class requirement here rather than an accident. No pipeline
stage in the root `CLAUDE.md` changes status: this feature adds no stage and moves none forward.

## Requirements

### Functional Requirements

- [ ] **REQ-1 (Two screens)**: There must be exactly two configuration screens with no overlap
      between them. `/preferences`, titled *Preferencias*, holds everything scoped to the signed-in
      user. `/settings`, titled *Ajustes*, holds installation-wide configuration only. A control may
      appear on one or the other, never on both.

- [ ] **REQ-2 (The languages card moves)**: `/settings` must stop rendering the *Idiomas preferidos*
      card. After this change `settings/page.tsx` no longer needs `getCurrentUser()` or
      `getLanguages()`, and `PreferredLanguagesCard` is reached only from `/preferences`. The
      existing `setPreferredLanguages` mutation and `setPreferredLanguagesAction` are re-used
      unchanged — this is a move, not a rewrite.

- [ ] **REQ-3 (Navigation)**: Both screens must be reachable. The sidebar
      (`services/web/src/layout/AppSidebar.tsx`) and the header user menu (`019-user-menu`) must
      each offer *Preferencias* alongside the existing *Ajustes* entry, and *Ajustes* must keep
      pointing at `/settings` exactly as `019`'s AC-3 requires.

- [ ] **REQ-4 (Group: Idiomas)**: The *Idiomas* group must show two controls — the interface
      language, a single choice among `supportedLocales`, and the additional download languages, the
      existing multi-select over the `languages` catalog. The copy must state that the title's
      original language and subtitles are always kept, so that an empty additional-languages
      selection reads as a deliberate state rather than as a missing one.

- [ ] **REQ-5 (Group: Películas)**: The *Películas* group must show a yes/no control for whether
      cinema-recorded releases are acceptable, and a multi-select of preferred torrent groups
      restricted to the film catalog.

- [ ] **REQ-6 (Group: Series)**: The *Series* group must show a multi-select of preferred torrent
      groups restricted to the series catalog. The two selections are independent: changing the film
      selection must leave the series selection untouched, and the reverse.

- [ ] **REQ-7 (Empty catalog is a designed state)**: With no torrent groups seeded — which is the
      state of every install the day this ships — each picker must render an explanatory message
      saying an administrator has not loaded any groups yet. Nothing is selectable, no mutation is
      sent, and the rest of the screen keeps working.

- [ ] **REQ-8 (Groups save independently)**: Each of the four controls must persist on its own. A
      failure saving one must leave the other three untouched and must not prevent the user from
      saving them. There is no single *Guardar* button spanning the whole screen.

- [ ] **REQ-9 (Self only)**: Every read and every write on this screen must target the authenticated
      caller. No mutation accepts a user id, and `User.preferredTorrentGroups` must carry the same
      identity guard `AuthResolver.preferredLanguages` already applies
      (`services/api/src/auth/auth.resolver.ts:78`): selected on a `User` that is not the caller —
      reachable through the admin `users`/`user(id)` queries, because a field resolver attaches per
      *type* — it returns `[]` rather than another user's preferences.

- [ ] **REQ-10 (Scope is enforced, not assumed)**: A torrent group belongs to exactly one scope,
      films or series. Saving a film selection that names a series group must be refused outright,
      not silently filtered down to the valid subset — a caller told "saved" about a set that is not
      what it sent is the failure this requirement exists to prevent.

- [ ] **REQ-11 (Replace, never merge)**: Saving a torrent-group selection replaces the whole set for
      that scope; an empty list clears it. The write must be validated in full before anything is
      persisted and applied atomically, matching the pattern `LanguagesService` already documents at
      the top of `services/api/src/languages/languages.service.ts`.

### Non-Functional & Operational Requirements

- [ ] **NFR-1 (Depends on `018-ui-i18n`)**: `018` must land first. `User.uiLocale`,
      `supportedLocales` and `setUiLocale` are its contract, consumed verbatim here and **not**
      redefined — the GraphQL delta below adds no locale surface of its own. As a consequence every
      visible string on the new screen comes from `018`'s message catalogs; this feature introduces
      no Spanish literal in `services/web/src` and no rendered Spanish sentence on the API boundary.

- [ ] **NFR-2 (Additive migration, no backfill)**: The migration is `ADD COLUMN` plus two new
      tables. Every existing user reads as "cinema releases not allowed, no torrent groups selected"
      with no data written on their behalf.

- [ ] **NFR-3 (Installation settings untouched)**: `updateSettings`, `SettingInput` and
      `SETTINGS_CATALOG` must not change. None of the four preferences is a settings key, and none
      may be added to `EDITABLE_KEYS` in `services/web/src/actions/settings.ts`.

- [ ] **NFR-4 (No typecheck or build regression)**: `bin/cli api npx --no tsc --noEmit` and
      `bin/cli web npx --no tsc --noEmit` must both report 0 errors, and `bin/npm web run build`
      must exit 0 — reported before and after the change.

## GraphQL Contract Delta

Frozen once `status: Approved` (Constitution, Article VIII). `web` retypes all of this by hand and
no codegen checks it.

The interface-language half of this screen adds **nothing** here: `User.uiLocale`,
`Query.supportedLocales` and `Mutation.setUiLocale` are `018-ui-i18n`'s contract and are consumed
as it defines them (NFR-1). The additional-download-languages half adds nothing either — it is the
existing `languages` query and `setPreferredLanguages` mutation, moved to a different page.

### Schema

```graphql
enum TorrentGroupScope {
  MOVIE
  SHOW
}

"""A release group an administrator has approved, scoped to films or to series."""
type TorrentGroup {
  id: Int!
  name: String!
  scope: TorrentGroupScope!
}

type User {
  """Whether cinema-recorded releases (CAM/TS) are acceptable for this user."""
  allowCinemaReleases: Boolean!

  """The caller's own selection, both scopes in one list. [] for any other user."""
  preferredTorrentGroups: [TorrentGroup!]!
}

type Query {
  """The full catalog the pickers read from. Empty until an administrator loads it."""
  torrentGroups(scope: TorrentGroupScope): [TorrentGroup!]!
}

type Mutation {
  setAllowCinemaReleases(allowed: Boolean!): User!

  """Replaces the caller's selection for one scope; [] clears it. The other scope is untouched."""
  setPreferredTorrentGroups(scope: TorrentGroupScope!, ids: [Int!]!): [TorrentGroup!]!
}
```

Notes the SDL cannot carry:

- **`preferredTorrentGroups` returns both scopes in one list**, and `web` splits it by `scope` to
  fill the two pickers. One field, one round trip, and the *Películas* and *Series* cards never
  disagree about what is selected because they are reading the same array.

- **`setPreferredTorrentGroups` is scoped, `preferredTorrentGroups` is not.** The mutation replaces
  the set for the scope it was given and must leave the other scope's rows in place (REQ-6, REQ-11).
  A implementation that deletes every row for the user before inserting would pass a single-scope
  test and silently wipe the other picker.

- **The `scope` argument on `torrentGroups` is optional.** Omitted, it returns the whole catalog;
  `web` uses that form and splits client-side, the same way it does for the selection.

- **A mismatched id is an error, not a filter** (REQ-10), and so is an unknown id or a repeated one.
  All three are checked against the catalog *before* any row is written, following
  `LanguagesService.resolveLanguageIds`.

- **No mutation here takes a user id** (REQ-9). The target is `@CurrentUser()`. None carries
  `@AllowService()`: a service principal authenticated with `SERVICE_TOKEN` has no preferences of
  its own, exactly as `setPreferredLanguages` already documents.

- **`torrentGroups` is readable by any authenticated user**, not admin-only. It is a catalog of
  names, and every user needs it to render their own pickers.

### Error table — `torrent-groups`

Written in `018-ui-i18n`'s five-column form, because `api` ships keys rather than rendered prose
once that feature lands (NFR-1).

| Condition | Exception | Key | Params | English `message` |
| :-- | :-- | :-- | :-- | :-- |
| An id in `ids` matches no row | `BadRequestException` | `error.torrent_group.not_found` | `id` | `Torrent group {id} does not exist` |
| An id appears twice in `ids` | `BadRequestException` | `error.torrent_group.duplicated` | `id` | `Torrent group {id} is repeated` |
| An id's row has a different `scope` than the argument | `BadRequestException` | `error.torrent_group.wrong_scope` | `id`, `scope` | `Torrent group {id} does not belong to {scope}` |
| No credential, expired session, or a service principal | `UnauthorizedException` | `error.auth.unauthenticated` | — | `Not authenticated` |

`error.auth.unauthenticated` is `018`'s existing key for the sentence `No autenticado`, not a new
one. The other three are new and need a catalog entry per locale.

**What `web` does with each.** The three `error.torrent_group.*` keys surface as an inline message on
the card that failed, leaving the other cards' state alone (REQ-8), with the selection reverted to
what the server still holds — the picker must not show a selection the API refused.
`error.auth.unauthenticated` never reaches the card: `redirectIfUnauthenticated` intercepts it in the
server action, clears the cookie and sends the browser to `/login`, as every action in
`services/web/src/actions/` already does. `setAllowCinemaReleases` has no failure of its own — a
boolean cannot be invalid — so its only path is the unauthenticated one.

## Data Model Changes

Owned by `api` (Constitution, Article III). `TorrentGroup`/`UserTorrentGroup` are modelled on the
existing `Language`/`UserLanguage` pair in `services/api/prisma/schema.prisma`, including the
`@@index` on the non-leading half of the composite key.

| Model | Change | Nullable / default | Backfill needed? |
| :-- | :-- | :-- | :-- |
| `User` | `+ allowCinemaReleases Boolean @default(false)` | non-null, defaults `false` | **No** — the default is the answer for every existing row |
| `User` | `+ torrentGroups UserTorrentGroup[]` (back-relation) | — | — |
| `TorrentGroup` *(new)* | `id Int @id @default(autoincrement())`, `name String`, `scope TorrentGroupScope`, `@@unique([name, scope])`, `@@map("torrent_groups")` | — | **No** — ships empty by design (REQ-7) |
| `UserTorrentGroup` *(new)* | `userId String` + `torrentGroupId Int`, `@@id([userId, torrentGroupId])`, both relations `onDelete: Cascade`, `@@index([torrentGroupId])`, `@@map("user_torrent_groups")` | — | **No** |
| `TorrentGroupScope` *(new enum)* | `MOVIE`, `SHOW` | — | — |

`@@unique([name, scope])` rather than `@@unique([name])`: the same release group name can plausibly
appear in both catalogs, and the two lists are curated independently.

`allowCinemaReleases` sits on `User` rather than in `settings`. It is per-user — two people on the
same install can disagree about it — and `Setting` is a single global key/value table with no user
dimension (NFR-3).

## Acceptance Criteria

- [ ] **AC-1**: `/preferences` renders three groups — *Idiomas*, *Películas*, *Series* — and
      `/settings` no longer shows the *Idiomas preferidos* card anywhere on the page.

- [ ] **AC-2**: Both the sidebar and the header user menu show *Preferencias* and *Ajustes*;
      clicking each lands on `/preferences` and `/settings` respectively.

- [ ] **AC-3**: Changing the interface language and reloading renders Perceptor in that language,
      and `me { uiLocale }` returns the new tag.

- [ ] **AC-4**: Selecting an additional download language and reloading `/preferences` shows it
      still selected, and `me { preferredLanguages { iso2 } }` lists it — proving the moved card
      still writes through the same mutation it did on `/settings`.

- [ ] **AC-5**: Ticking *Permitir películas de cine* and reloading keeps it ticked, and
      `bin/mysql -e 'select allowCinemaReleases from users where username = "<username>"'` prints
      `1`. Unticking it and reloading prints `0`.

- [ ] **AC-6**: On a freshly migrated install, `torrentGroups` returns `[]` and both group pickers
      render the "no groups loaded" message with nothing selectable and no mutation sent.

- [ ] **AC-7**: After inserting one `MOVIE` row and one `SHOW` row by hand
      (`bin/mysql -e 'insert into torrent_groups …'`), selecting the film group and reloading keeps
      it selected, and the series selection is still empty. Selecting the series group afterwards
      leaves the film selection in place.

- [ ] **AC-8** *(failure path)*: `setPreferredTorrentGroups(scope: MOVIE, ids: [<the SHOW row's
      id>])` is refused with `error.torrent_group.wrong_scope`, and a follow-up
      `me { preferredTorrentGroups { id } }` shows the previously saved set unchanged.

- [ ] **AC-9** *(failure path)*: `setPreferredTorrentGroups` with an id matching no row is refused
      with `error.torrent_group.not_found`, and with the same id twice is refused with
      `error.torrent_group.duplicated`. In both cases `user_torrent_groups` is unchanged —
      `bin/mysql -e 'select count(*) from user_torrent_groups'` prints the same number before and
      after.

- [ ] **AC-10** *(failure path)*: `setPreferredTorrentGroups` and `setAllowCinemaReleases` called
      with `SERVICE_TOKEN` as the bearer are both refused with `error.auth.unauthenticated`.

- [ ] **AC-11** *(failure path)*: Signed in as an admin, `users { id preferredTorrentGroups { id } }`
      returns `[]` for every user except the caller, even for a user who has a saved selection.

- [ ] **AC-12**: `grep -rn "PreferredLanguagesCard" services/web/src/app/\(dashboard\)/settings`
      returns nothing.

- [ ] **AC-13**: `bin/cli api npx --no tsc --noEmit` and `bin/cli web npx --no tsc --noEmit` both
      report 0 errors, `bin/npm web run build` exits 0, and `bin/npm api test` reports no failures.

## Out of Scope

- **The admin CRUD that fills the torrent-group catalog.** Stated up front by the user as a separate
  concern. This feature creates the tables, the query and the pickers; until that screen exists the
  catalog is filled by hand or not at all, which is why REQ-7 makes the empty state a requirement
  rather than leaving it to whoever implements the picker.

- **Any filtering, ranking or scoring of indexer results by preferred group.** Nothing reads
  `UserTorrentGroup` in this feature. `services/api/src/clients/indexer/client.ts` and the release
  dialog are untouched. Wiring it in is a later feature that will need to decide whether a preferred
  group is a hard filter or a sort key — a question this spec deliberately does not answer.

- **The automatic search that `allowCinemaReleases` is being stored for.** Perceptor searching on
  its own for a title not yet released does not exist. The flag is being recorded now so that the
  preference is already there when it does.

- **Interpreting a release title to decide whether it is CAM/TS.** That parsing belongs with whoever
  consumes the flag.

- **Per-title torrent-group overrides.** Languages have them (`UserMovieLanguage`,
  `UserShowLanguage`); groups deliberately do not. Adding them later is a third table in the same
  shape, with no change to what this feature builds.

- **Locking `/settings` behind `AdminGuard`.** The `settings` query and `updateSettings` mutation
  carry no guard today, and any signed-in user can edit installation-wide configuration. Splitting
  the screens makes that easier to notice but does not change it — closing it is its own decision,
  with its own migration question about what a non-admin sees instead.

- **Moving any other control off `/settings`.** `movies_enabled`, `shows_enabled`, the paths, the
  API keys and the media-server block are installation-wide and stay exactly where they are
  (NFR-3).

- **Introducing the message catalogs.** `018-ui-i18n` owns that machinery; this feature is a
  consumer of it and must land after it (NFR-1).
