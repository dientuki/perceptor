---
title: User Preferences — Tasks
last_updated: 2026-09-01
status: Draft            # Draft | In Progress | Done
---

# TASKS: User Preferences (`tasks.md`)

## Legend

| Marker | Meaning |
| :-- | :-- |
| `[api]` `[web]` `[worker]` `[infra]` | Which subagent owns the task. Exactly one per task — a task that needs two services is two tasks. |
| `[docs]` | Documentation only. Owned by the orchestrator, not a service agent. |
| `[P]` | May run in parallel with the other `[P]` tasks in the same group. |
| `→ Tnnn` | Blocked by that task. |

**No `[worker]` tasks**: nothing in the job payload or the encode pipeline changes — splitting
`allowedLanguagesIso3` is a separate spec (`../spec.md` § Out of Scope). **No `[infra]` tasks**:
this feature adds no environment variable, changes no `bin/` wrapper, and touches no Dockerfile or
`docker-compose.yaml`.

Every new file in every task is written under Article XI — no explanatory comments. The one
exception in this whole feature is the Article IX header paragraph on the two `*.spec.ts` files
(T008, T009). The files being imitated predate that article; copy their structure, not their prose.

## Tasks

### Group 1 — Schema, vocabulary and the contract (`api`)

- [ ] **T001** `[api] [P]` Add to `prisma/schema.prisma`: enums `LanguageTrackKind { AUDIO SUBTITLE }`
      and `TorrentGroupScope { MOVIE SHOW }`; `allowCinemaReleases Boolean @default(false)` and the
      `languages` / `torrentGroups` back-relations on `User`; `userPreferences` on `Language`; and
      the models `UserLanguagePreference`, `TorrentGroup` and `UserTorrentGroup` exactly as
      `../spec.md` § Data Model Changes tables them — composite `@@id`, `onDelete: Cascade` on every
      user-side relation, `@@index` on the non-leading key, `@@map` to the snake_case names given
      there. Generate the migration `add_user_preferences` with `bin/npm api run prisma:migrate`.
      *Done when:* `git status services/api/prisma/` shows both a modified `schema.prisma` **and** a
      new migration directory (Article III's Check);
      `bin/mysql -e 'show tables'` lists `torrent_groups`, `user_torrent_groups` and
      `user_language_preferences`; `bin/mysql -e 'select allowCinemaReleases from users'` prints `0`
      for every existing row with no backfill run.

- [ ] **T002** `[api] [P]` Add `TORRENT_GROUP_NOT_FOUND`, `TORRENT_GROUP_DUPLICATED` and
      `TORRENT_GROUP_WRONG_SCOPE` to `src/i18n/error-keys.ts` with the key strings from
      `../spec.md` § Error table, and their English templates to `src/i18n/messages.en.ts` with the
      exact `{param}` names (`id`, and `id` + `scope` for the third).
      *Done when:* `grep -n "torrent_group" src/i18n/error-keys.ts src/i18n/messages.en.ts` shows
      three keys and three templates, and the strings match `../spec.md` character for character.

- [ ] **T003** `[api]` Add `src/preferences/entities/` — `TorrentGroupScope` and `LanguageTrackKind`
      exposed with `registerEnumType` following the placement already used elsewhere in this service
      (`grep -rn "registerEnumType" src/`), `TorrentGroup`, and `UserPreferences` with its four
      fields, `Language` reused unchanged as the element type of the two list fields. → T001
      *Done when:* `bin/cli api npx --no tsc --noEmit` reports 0 errors and the entity files declare
      exactly the fields in `../spec.md` § Schema — no extra field, none renamed.

- [ ] **T004** `[api] [P]` Add `setPreferredTrackLanguagesFor(userId, kind, tags)` and
      `findPreferredTrackLanguagesFor(userId, kind)` to `LanguagesService`, beside the two per-title
      pairs: `validateAndResolveLanguageIds` **first**, then a `$transaction` whose `deleteMany` is
      keyed on `{ userId, kind }` — never `{ userId }` — then `createMany`, then a re-read through
      the finder. → T001
      *Done when:* seeding a user with one `AUDIO` and one `SUBTITLE` row and calling the method for
      `AUDIO` leaves the `SUBTITLE` row in place, checked with
      `bin/mysql -e 'select kind, count(*) from user_language_preferences group by kind'`.

- [ ] **T005** `[api] [P]` Add `setAllowCinemaReleases(userId, allowed)` to `UsersService`, beside
      `setUiLocale` — one `prisma.user.update`, returning the row. Not routed through
      `UsersService.update`. → T001
      *Done when:* `bin/cli api npx --no tsc --noEmit` reports 0 errors and the method sits in the
      same file as `setUiLocale` with the same shape.

- [ ] **T006** `[api]` Write `src/preferences/preferences.service.ts`: `findForUser`, `findCatalog(scope?)`,
      `setAllowCinemaReleases` (delegating to `UsersService`, then re-reading), and
      `setPreferredTorrentGroupsFor(userId, scope, ids)` — the only write it owns. That last one
      resolves every id against `torrent_groups` **before** any write, throwing
      `TORRENT_GROUP_DUPLICATED` on a repeated id, `TORRENT_GROUP_NOT_FOUND` on an id with no row and
      `TORRENT_GROUP_WRONG_SCOPE` on a row whose scope differs from the argument, all through
      `i18nError.badRequest`; then replaces inside a `$transaction` whose `deleteMany` is narrowed to
      the caller **and** the scope (a join to `torrent_groups`, which is where `scope` lives —
      `user_torrent_groups` has no scope column). → T002, T003, T004, T005
      *Done when:* with one `MOVIE` and one `SHOW` group seeded by hand and both selected, writing
      the `MOVIE` scope leaves the `SHOW` row present in
      `bin/mysql -e 'select count(*) from user_torrent_groups'`, and each of the three refusals
      leaves that count unchanged.

- [ ] **T007** `[api]` Write `src/preferences/preferences.resolver.ts` (`preferences`,
      `torrentGroups(scope)`, `setAllowCinemaReleases`, `setPreferredTrackLanguages`,
      `setPreferredTorrentGroups`) and `preferences.module.ts` importing `LanguagesModule` and
      `UsersModule`, then register `PreferencesModule` in `src/app.module.ts`. Every operation
      `@UseGuards(JwtAuthGuard)` with the explicit `principal.type !== 'user'` narrowing that throws
      `AUTH_UNAUTHENTICATED`, none with `@AllowService()`, none taking a user id. → T006
      *Done when:* all four operations called from the playground with `SERVICE_TOKEN` as the bearer
      return `error.auth.unauthenticated` (AC-12), and each of them called with a user cookie
      returns data.

- [ ] **T008** `[api] [P]` Write `src/preferences/preferences.service.spec.ts` with the six cases in
      `../api/plan.md` § Tests — scope isolation both ways, another user's rows untouched, the three
      refusals each asserting **both** the throw and an unchanged stored set, and `ids: []` clearing
      one scope only. Opens with the Article IX header naming the silent failure it defends against.
      → T006
      *Done when:* `bin/npm api test` is green, **and** the isolation case has been verified to fail
      by fault injection: widen the `deleteMany`'s `where` to `{ userId }`, watch it fail, restore.
      Report that both halves were observed.

- [ ] **T009** `[api] [P]` Add one case to `src/languages/languages.service.spec.ts`: saving `AUDIO`
      leaves the caller's `SUBTITLE` rows in place, and the reverse. Same fault-injection standard.
      → T004
      *Done when:* `bin/npm api test` is green and the case was observed to fail with the `kind`
      dropped from the `deleteMany`'s `where`.

- [ ] **T010** `[api]` Boot the service and diff the regenerated `src/schema.gql` against
      `../spec.md` § Schema. → T007
      *Done when:* the diff shows exactly the delta — two enums, `TorrentGroup`, `UserPreferences`,
      two queries, three mutations, and **no new field on `User`** (AC-13). Any difference is a
      contract violation or a stale spec and stops the slice (Article VIII's Check); record it under
      `## Blocked` rather than adjusting either side.

### Group 2 — The screen (`web`)

Everything here except T011 depends on Group 1: `web` has no codegen and no mocked schema, so a
card written against a schema that does not exist yet is unverifiable.

- [ ] **T011** `[web] [P]` Strip the *Descarga* tab from `/settings`: delete
      `src/components/settings/DownloadPanel.tsx`, remove the download entry from `SettingsForm`'s
      `TABS`/`tabItems` **and** the `activeTab === "download"` hide/show wrapper that existed only to
      keep `LanguagePicker`'s own `<form>` out of the main one, delete `updateDefaultLanguagesAction`
      and `ALWAYS_SENT_STRING_KEYS` from `src/actions/settings.ts`, and drop `getLanguages()` and the
      `languages` prop from `settings/page.tsx`. Remove the now-orphaned `settings.download.*`
      catalog entries from both `messages/*.json`. **Nothing about the `default_languages` key
      changes on the `api` side** (REQ-6). *This task consumes no new contract and is not blocked by
      Group 1 — it can start immediately.*
      *Done when:* `/settings` shows five tabs with no *Descarga*;
      `grep -rn "DownloadPanel\|updateDefaultLanguagesAction" services/web/src` returns nothing
      (AC-1); and `bin/mysql -e "select value from settings where \`key\` = 'default_languages'"`
      prints the same value it printed before the task (AC-15).

- [ ] **T012** `[web]` Add `src/types/preferences.ts` (hand-typed from `../spec.md`'s SDL, the two
      enums as string unions) and `src/actions/preferences.ts` — `getPreferences` and
      `getTorrentGroups` using `redirectToClearSession` because a Server Component `await`s them
      during render, the three form actions using `redirectIfUnauthenticated`, every error derived
      through `translateGraphQLError`. Torrent-group ids converted with `Number` before they go on
      the wire. → T010
      *Done when:* `bin/cli web npx --no tsc --noEmit` reports 0 errors and each of the five
      functions returns real data from a running stack, checked from a scratch page or by the cards
      in T013–T015.

- [ ] **T013** `[web] [P]` Build `src/components/preferences/UiLocaleCard.tsx` (single choice over
      `SUPPORTED_LOCALES` from `src/i18n/locales.ts`, names via `Intl.DisplayNames`, submitting a
      field named `locale` to the **existing** `setUiLocaleAction`, refreshing the route on success
      so the new language takes effect) and `DownloadLanguagesCard.tsx` (two `LanguagePicker`
      instances, each bound to an action already bound to its `kind`, no `name` prop, the component
      itself untouched). Strings into both catalogs. → T012
      *Done when:* with the installation `ui_locale` at `es`, picking English re-renders the UI in
      English and `me { uiLocale }` returns `en` while a second user still sees Spanish (AC-3);
      picking two audio and one subtitle language and reloading shows exactly that, and
      `bin/mysql -e 'select kind, count(*) from user_language_preferences group by kind'` prints
      `AUDIO 2` / `SUBTITLE 1` (AC-4); re-saving audio alone leaves the `SUBTITLE` count unchanged
      (AC-5).

- [ ] **T014** `[web] [P]` Build `src/components/preferences/CinemaReleasesCard.tsx` — the
      `Checkbox` + hidden-input markup from `SettingsForm`'s boolean fields, calling
      `setAllowCinemaReleasesAction` rather than a settings key. Strings into both catalogs. → T012
      *Done when:* ticking it and reloading keeps it ticked and
      `bin/mysql -e 'select username, allowCinemaReleases from users'` prints `1`; unticking prints
      `0`; a user created afterwards from `/users` prints `0` with no preference row written (AC-6).

- [ ] **T015** `[web] [P]` Build `src/components/preferences/TorrentGroupPicker.tsx` (a sibling of
      `LanguagePicker`, bound to one scope, never a generalization of it) and `TorrentGroupsCard.tsx`,
      which decides between the empty state and the picker on `options.length === 0` **before the
      picker renders** — an empty submission is a valid "clear my selection" write. Strings into both
      catalogs. → T012
      *Done when:* with an empty catalog both pickers show the "no groups loaded" message, nothing is
      selectable and the network tab shows no mutation sent (AC-7); after
      `bin/mysql -e "insert into torrent_groups (name, scope) values ('GRUPO-A','MOVIE'),('GRUPO-B','SHOW')"`,
      selecting the film group and reloading keeps it with the series picker still empty, and
      selecting the series group afterwards leaves the film selection in place (AC-8).

- [ ] **T016** `[web]` Write `src/app/(dashboard)/preferences/page.tsx` — a Server Component with one
      `Promise.all([getPreferences(), getLanguages(), getTorrentGroups()])`, the three sections in
      the spec's order (*Idiomas*, *Películas*, *Series*), `PageBreadcrumb` and `generateMetadata`
      from the catalog. **No `isAdmin` check and no `notFound()`** — do not copy that half of
      `users/page.tsx` or `settings/page.tsx`. → T013, T014, T015
      *Done when:* `/preferences` renders the three groups with all six controls (AC-1), and it
      renders in full for a **non-administrator** (AC-2b).

- [ ] **T017** `[web]` Add *Preferencias* to `AppSidebar.tsx`'s `baseNavItems` — the array every user
      gets, **not** the `isAdmin` spread beneath it — and to `UserDropdown.tsx` beside the existing
      *Ajustes* item. Labels from the `nav` and `userMenu` catalog namespaces. Leave the *Ajustes*
      item's own missing admin gating alone (`../spec.md` § Out of Scope). → T016
      *Done when:* as an administrator both the sidebar and the header menu show *Preferencias* and
      *Ajustes*, landing on the right routes (AC-2); as a non-administrator the sidebar shows
      *Preferencias* and not *Ajustes* (AC-2b).

- [ ] **T018** `[web]` Close the slice: confirm every new string is in **both** `messages/en.json`
      and `messages/es.json` — including `errors.torrent_group.not_found`,
      `errors.torrent_group.duplicated` and `errors.torrent_group.wrong_scope` — with `es` in the
      existing Rioplatense register, and run the full gate. → T011, T016, T017
      *Done when:* `bin/cli web node scripts/check-messages.mjs` exits 0,
      `bin/cli web npx --no tsc --noEmit` reports **0 errors**, `bin/npm web run build` exits **0**
      and `bin/npm web run lint` reports no new findings (AC-16). Report the typecheck and build
      results from before and after the slice.

### Group 3 — Verification and docs

- [ ] **T019** `[docs]` Update the `CLAUDE.md` files this feature invalidates. `services/api/CLAUDE.md`:
      the module map gains `preferences/`, the "Schema/enum reality check" section's enum table gains
      `LanguageTrackKind` and `TorrentGroupScope` (it currently says "exactly four enums"), and the
      model and migration counts move. `services/web/CLAUDE.md`: the "Language pickers" section —
      three call sites become five, and the paragraph describing `DownloadPanel` and
      `updateDefaultLanguagesAction` now describes something that no longer exists; the settings
      screen is five tabs; `/preferences` is a new screen. Root `CLAUDE.md`: the layout/current-state
      counts. **The pipeline table does not change** — no stage moved. → T010, T018
      *Done when:* every count and claim touched was re-measured with the command each file names
      beside it (`grep -c "^model "`, `grep -n '^enum'`, `bin/npm api test`), not carried over.

- [ ] **T020** `[docs]` Walk AC-1 through AC-16 in `../spec.md` against the running stack, including
      the ones no single task owns end to end — AC-9/AC-10/AC-11 (the five refusals, from the
      playground, each followed by a row count), AC-12/AC-13, AC-14 (delete a user through `/users`,
      then check both preference tables for their id), AC-15. Tick each box. → T019
      *Done when:* every checkbox in `../spec.md` § Acceptance Criteria is ticked or listed under
      `## Blocked` with a reason, and `status: Implemented` is set on `spec.md`, `plan.md`,
      `api/plan.md` and `web/plan.md`.

## Blocked

| Task | Service | What blocked it | Needs |
| :-- | :-- | :-- | :-- |
