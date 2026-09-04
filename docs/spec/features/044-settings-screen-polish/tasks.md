---
title: Settings Screen Polish — Tasks
last_updated: 2026-09-04
status: Done
---

# TASKS: Settings Screen Polish (`tasks.md`)

## Legend

| Marker | Meaning |
| :-- | :-- |
| `[api]` `[web]` | Which subagent owns the task. Exactly one per task. |
| `[docs]` | Documentation only. Owned by the orchestrator, not a service agent. |
| `[P]` | May run in parallel with the other `[P]` tasks in the same group. |
| `→ Tnnn` | Blocked by that task. |

No `[worker]` or `[infra]` task exists in this feature: `services:` is `[api, web]`, nothing about
the stack's boot or wiring changes, and the transcode pipeline is untouched by requirement
(`spec.md` § Out of Scope).

## Tasks

### Group 1 — schema, contract and the settings catalog (`api`)

Everything `web` consumes is produced here. T002 and T003 touch nothing T001 touches and may start
immediately.

- [x] **T001** `[api]` Move `TorrentGroupScope` from `torrent_groups` to `user_torrent_groups` in
      `prisma/schema.prisma` (drop `TorrentGroup.scope`, `name` becomes `@unique`; add
      `UserTorrentGroup.scope` and widen `@@id` to `(userId, torrentGroupId, scope)`), then generate
      the migration with `bin/npm api run prisma:migrate` and **hand-reorder its SQL** to the seven
      statements in `plan.md` § Migrations. The widened primary key must precede the duplicate
      repoint — Prisma will not produce that order, and the reverse aborts mid-migration on a
      populated database.
      *Done when:* `bin/cli api npx --no prisma migrate status` reports no pending migration, and
      `bin/mysql -e 'describe user_torrent_groups; describe torrent_groups'` shows `scope` on the
      first table and not on the second.

- [x] **T002** `[api] [P]` Add `TORRENT_GROUP_NAME_TAKEN` and
      `VALIDATION_TORRENT_GROUP_NAME_REQUIRED` to `src/i18n/error-keys.ts` with their English text in
      `src/i18n/messages.en.ts`; delete `TORRENT_GROUP_WRONG_SCOPE` from both.
      *Done when:* `grep -rn "WRONG_SCOPE\|wrong_scope" services/api/src` returns nothing except the
      throw site T005 removes, and `bin/cli api npx --no tsc --noEmit` names only that one call site.

- [x] **T003** `[api] [P]` Add `compression_resolution` to `SETTINGS_CATALOG`
      (`src/settings/settings.catalog.ts`) as `kind: 'enum'` over `['4k', '1080p', '720p', '360p']`,
      declared once as an exported const and reused by `prisma/seeds/settings.ts`, which gains the
      create-only default `'1080p'`. No validation code: `SettingsService.updateMany` already handles
      the `enum` kind end to end.
      *Done when:* after `bin/dbreset`,
      `bin/mysql -e "select value from settings where \`key\`='compression_resolution'"` prints
      `1080p`, and an `updateSettings` carrying `480p` comes back with
      `extensions.i18n.key = error.setting.expected_enum` and the stored row unchanged **(AC-6)**.

- [x] **T004** `[api]` Reshape the read path: remove `scope` from
      `src/preferences/entities/torrent-group.entity.ts`; replace `UserPreferences.torrentGroups`
      with `movieTorrentGroups` and `showTorrentGroups` in
      `entities/user-preferences.entity.ts`; drop the argument from `PreferencesService.findCatalog`
      and from the `torrentGroups` query in `preferences.resolver.ts`; narrow
      `findSelectedTorrentGroupsFor` on the `user_torrent_groups.scope` column instead of the join
      through `torrentGroup`; have `findForUser` fill both new fields. The `torrentGroups` query keeps
      `JwtAuthGuard` and **must not** gain `AdminGuard` (`plan.md` § Contract Freeze). → T001
      *Done when:* `bin/cli api npx --no tsc --noEmit` is at 0 errors and `bin/npm api run test`
      is green apart from the `wrong_scope` case T005 deletes.

- [x] **T005** `[api]` Rewrite `setPreferredTorrentGroupsFor`: delete the
      `row.scope !== prismaScope` rejection (any catalog id is now valid for either scope), narrow
      the `deleteMany` to `{ userId, scope }`, write `scope` on each `createMany` row, keep the
      duplicate-id and not-found rejections and the surrounding `$transaction` exactly as they are.
      Update `preferences.service.spec.ts` in step: `SelectionRow` gains `scope`, the `wrong_scope`
      test is deleted, the two "leaves the sibling scope / another user's rows in place" tests keep
      passing unchanged in intent, and one new test is added — **the same group id selected for both
      scopes yields two rows and neither save clobbers the other**. → T004, T002
      *Done when:* `bin/npm api run test src/preferences` is green including the new case, with the
      in-memory fake still applying the `where` it is given rather than recording call arguments.

- [x] **T006** `[api]` Add `createTorrentGroup(name)` and `deleteTorrentGroup(id)` to
      `PreferencesService` and expose them on `PreferencesResolver`, each `@UseGuards(AdminGuard)`,
      returning `TorrentGroup!` and `Boolean!`. `create` trims, rejects empty with
      `VALIDATION_TORRENT_GROUP_NAME_REQUIRED`, and rejects a collision with
      `TORRENT_GROUP_NAME_TAKEN` — compared case-insensitively **and** by catching Prisma `P2002`,
      because MariaDB's collation makes the unique index case-insensitive too. `delete` throws
      `TORRENT_GROUP_NOT_FOUND`; the existing `onDelete: Cascade` removes the users' selections, so
      do not delete those by hand. Rewrite the resolver's class header comment — "every operation is
      rooted at `@CurrentUser()`" stops being true, and the reason `torrentGroups` stays non-admin
      belongs there. Add the case-insensitive-collision test to `preferences.service.spec.ts`.
      → T004, T002
      *Done when:* `bin/npm api run test src/preferences` is green, and a `createTorrentGroup("FLUX")`
      followed by `createTorrentGroup("flux")` returns `error.torrent_group.name_taken` with
      `bin/mysql -e 'select count(*) from torrent_groups'` still printing `1`.

- [x] **T007** `[api]` Boot the api so `src/schema.gql` regenerates, then diff it against the frozen
      delta. Never hand-edit the file (Constitution, Article IV). → T004, T005, T006
      *Done when:* `git diff services/api/src/schema.gql` matches `spec.md` § GraphQL Contract Delta
      line for line — `TorrentGroup` without `scope`, `torrentGroups` without its argument,
      `UserPreferences` with the two new lists, both new mutations present. Any difference is a
      contract violation and goes to **Blocked**, not into an edit.

### Group 2 — the `/settings` presentation pass (`web`)

These four cross no service boundary. T008, T009 and T010 may run alongside Group 1 entirely —
they touch nothing `api` produces. T011 is the exception and waits on T003.

- [x] **T008** `[web] [P]` In `src/components/settings/SettingsForm.tsx`: Media Server → `Cast`,
      Compression → `FileVideoCamera`, Media Manager → `Library` (all real exports of the installed
      `lucide-react`); and clear the save/error state when `activeTab` changes. Do **not** switch the
      panels to conditional rendering to force a remount — the file's header comment explains why
      every panel stays mounted, and breaking that silently drops fields from the save.
      *Done when:* the three tabs show the new icons **(AC-1)**, and pressing Save then clicking any
      other tab makes "Settings saved." disappear until the next save **(AC-7)**.

- [x] **T009** `[web] [P]` Add the chevron wrapper (a `relative` container plus an absolutely
      positioned, `pointer-events-none` `ChevronDown` from `lucide-react` over the existing
      `appearance-none` `components/form/Select.tsx`) and use it in `GeneralPanel.tsx` and
      `MediaServerFields.tsx`. `name`, `value`/`defaultValue`, `onChange` and `disabled` pass through
      untouched. Delete `src/components/form/form-elements/` — uncommitted TailAdmin sample material
      importing a `@/icons` alias this project does not define (NFR-4).
      *Done when:* both dropdowns render the project chevron, `bin/npm web run build` exits 0 with
      that directory gone, and choosing a language then saving leaves
      `bin/mysql -e "select value from settings where \`key\`='ui_locale'"` holding the chosen locale
      **(AC-2)**.

- [x] **T010** `[web] [P]` Replace the two `CheckboxField` uses in `MediaManagerPanel.tsx` with
      `Switch` + a hidden input (the `CompressionPanel` pairing), lift the two booleans into the
      panel's state, and pass `disabled` into the matching `PathPicker`. Teach `PathPicker.tsx` a
      `disabled` prop that makes the visible input read-only while **the hidden input keeps
      submitting the stored value unchanged** — never blanked, never dropped, never defaulted to
      `'.'`, which means "the media root itself" and would silently repoint the library. Delete
      `CheckboxField.tsx` if nothing else imports it.
      *Done when:* both toggles render as switches, disabling "Enable movies" makes the movies folder
      non-editable and re-enabling shows the same value as before **(AC-3)**; and toggling "Enable
      series" on → Save → reload → off → Save → reload leaves
      `bin/mysql -e "select \`key\`, value from settings where \`key\` in ('movies_enabled','shows_enabled')"`
      printing `true` then `false` **(AC-4)**.

- [x] **T011** `[web]` In `CompressionPanel.tsx`, replace the three presets with `4k`, `1080p`,
      `720p`, `360p`, relabel to Resolution, seed from a new prop fed by
      `getSettingValue("compression_resolution")` (falling back to `1080p`), and add a hidden
      `name="compression_resolution"` input carrying the selection — the radios keep `name=""` and
      the comment explaining why. Add `compression_resolution` to `EDITABLE_KEYS` in
      `src/actions/settings.ts` (it is a string key, **not** a `BOOLEAN_KEYS` entry). Labels into both
      message catalogs. → T003
      *Done when:* choosing `720p` and saving makes
      `bin/mysql -e "select value from settings where \`key\`='compression_resolution'"` print `720p`,
      and the choice survives a reload **(AC-5)**. This is the one control in the feature whose
      current failure mode is silent — verify the row, not the screen.

### Group 3 — consumers of the changed contract (`web`)

Everything here fails at runtime against an `api` that has not landed T007. Not parallel with
Group 1.

- [x] **T012** `[web]` Retype the preferences boundary: drop `scope` from `TorrentGroup` in
      `src/types/preferences.ts` and add the two lists to `UserPreferences`; remove `scope` from
      every `TorrentGroup` selection set in `src/actions/preferences.ts` (it appears in
      `PREFERENCES_QUERY`, `TORRENT_GROUPS_QUERY`, the `setAllowCinemaReleases` and
      `setAudioMandatory` payloads, and `SET_PREFERRED_TORRENT_GROUPS_MUTATION`); in
      `PreferencesForm.tsx` read the two new lists instead of `idsFrom(...)`, and offer the **whole**
      catalog on both the Movies and Series tabs. `setPreferredTorrentGroupsAction` keeps its `scope`
      argument and its `Number(id)` conversion. → T007
      *Done when:* `/preferences` renders with no GraphQL error, and
      `grep -rn "scope" services/web/src/types/preferences.ts services/web/src/actions/preferences.ts`
      returns only `TorrentGroupScope` and `setPreferredTorrentGroups`' argument.

- [x] **T013** `[web]` Add `createTorrentGroupAction(name)` and `deleteTorrentGroupAction(id)` to
      `src/actions/preferences.ts`, following the file's own conventions: module-level
      SCREAMING_SNAKE document, `redirectIfUnauthenticated` then `translateGraphQLError`, and a
      returned `{ error } | { success: true }` rather than a `throw` — a thrown Server Action error
      loses `extensions.i18n.key`, and the panel needs to show the duplicate message inline. Add
      `errors.torrent_group.name_taken` and the name-required key to both message catalogs; delete
      `errors.torrent_group.wrong_scope` from both. → T007
      *Done when:* `bin/npm web run build` exits 0 and
      `bin/cli web node scripts/check-messages.mjs` reports no drift.

- [x] **T014** `[web]` Build the ABM in `TorrentManagerPanel.tsx`: the catalog arrives as a prop
      (`src/app/(dashboard)/settings/page.tsx` adds the existing `getTorrentGroups()` to its
      `Promise.all` and `SettingsForm` passes it through), a labelled text input with an add
      affordance where **Enter and the button both `preventDefault`** — this panel sits inside the
      settings `<form>` and a nested form or a bare submit would save the whole screen — and below it
      the badge list reusing `LanguagePickerField`'s markup (`Badge color="primary"`, `endIcon` with
      an `X` button and an `aria-label`). Local state changes only after the action reports success,
      never optimistically; an error renders inline beside the input and leaves the list untouched.
      → T013
      *Done when:* adding `FLUX` shows the badge and `bin/mysql -e 'select name from torrent_groups'`
      lists it **(AC-8)**; adding `FLUX` again shows the message inline, adds no badge, and
      `bin/mysql -e 'select count(*) from torrent_groups where name="FLUX"'` still prints `1`
      **(AC-9)**; the X removes it from both screen and table.

### Group 4 — verification and docs

- [x] **T015** `[web]` Full-service verification pass and the end-to-end scope check: as a non-admin
      user, confirm `FLUX` is offered on both the Movies and Series tabs of `/preferences`, select it
      for Series only, save, reload. → T012, T014
      *Done when:* `bin/npm web run build`, `bin/npm web run lint` and
      `bin/cli web node scripts/check-messages.mjs` all exit 0; the selection survives the reload as
      Series-only and `bin/mysql -e 'select * from user_torrent_groups'` shows one row with
      `scope = 'SHOW'` **(AC-10)**; `grep -rn "\.scope" services/web/src/components/preferences/`
      finds no read of a group's scope **(AC-11)**.

- [x] **T016** `[docs]` Update the three `CLAUDE.md` files this feature falsifies. In
      `services/api/CLAUDE.md`'s `preferences/` bullet: `Query.torrentGroups` no longer takes
      `scope`, `_WRONG_SCOPE` is gone, and the `deleteMany` no longer narrows through a join to
      `TorrentGroup.scope` — it reads a column on `user_torrent_groups`; add the two admin catalog
      mutations and note that they are the first non-self operations in that module. In
      `services/web/CLAUDE.md`'s "Two per-user settings screens" section: `TorrentGroupPickerField`
      is no longer "bound to one `TorrentGroupScope` at a time" in the sense of a scoped catalog —
      the same catalog now feeds both tabs. In the root `CLAUDE.md`: the Current state paragraph's
      re-measured counts. `docs/spec/graphql-contract.md` needs **no** edit — it has no torrent-group
      section (verified by grep); say so rather than inventing one.
      → T015
      *Done when:* no sentence in any of the three files describes a scope on `TorrentGroup`, and the
      root counts match a fresh `bin/npm api run test`.

- [x] **T017** `[docs]` Walk all eleven acceptance criteria in `spec.md` against the running stack,
      tick each box, and set `status: Implemented` on `spec.md`, `plan.md`, `api/plan.md` and
      `web/plan.md`; set this file to `status: Done`. → T016
      *Done when:* every AC box is ticked with the evidence actually observed (not assumed), and any
      criterion that could not be reached is written into **Blocked** below instead of being ticked.

## Blocked

| Task | Service | What blocked it | Needs |
| :-- | :-- | :-- | :-- |

Contract problems always land here (Constitution, Article VIII): an agent that finds the GraphQL
delta wrong stops and reports, it does not amend the delta from inside its slice.
