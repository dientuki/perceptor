---
title: User Preferences — Implementation Plan
spec_version: 0.2.0
last_updated: 2026-09-01
status: Implemented
---

# PLAN: User Preferences (`plan.md`)

## Approach

Six controls, and only two of them are genuinely new machinery. That asymmetry shapes the plan.

**The interface language builds nothing on `api`.** `User.uiLocale`, `Query.supportedLocales` and
`Mutation.setUiLocale` all shipped with `018-ui-i18n` and `services/web/src/actions/locale.ts`
already wraps the mutation in `setUiLocaleAction` — a server action with, today, no caller anywhere
in the repository. The *Idioma de Perceptor* control is that missing caller and nothing else. The
resolution chain it feeds (`src/i18n/request.ts`: user → installation → `Accept-Language` → `en`)
is likewise untouched; REQ-3's "overrides the general one" is a description of behaviour that
already exists, not a change to it.

**The two language lists reuse `LanguagesService` and `LanguagePicker` wholesale.**
`LanguagesService.validateAndResolveLanguageIds` (`services/api/src/languages/languages.service.ts`)
is already public, already rejects an unknown and a duplicated tag with the two keys the spec's
error table names, and is already reused by `SettingsService` for exactly this reason. The new write
is a third sibling beside `setMoviePreferredLanguagesFor` and `setShowPreferredLanguagesFor`, in the
same file, with the same validate-then-`$transaction`-replace ordering. On `web`,
`src/components/media/LanguagePicker.tsx` is the dual-pane control all three existing call sites
share (`030-language-regional-variants`); the audio and subtitle cards become the fourth and fifth,
each binding it to its own action and leaving the component itself alone.

**The genuinely new surface is the torrent-group catalog and the cinema boolean**, and both live in
one new Nest module, `preferences/`. It owns the `UserPreferences` type, `Query.preferences`,
`Query.torrentGroups` and the three mutations. It is one module rather than two (`preferences/` plus
a `torrent-groups/`) because the catalog exists only to feed the picker on this screen and has no
other consumer — Article X. Where it composes rather than duplicates:

- The **language write** is delegated to `LanguagesService`, which `LanguagesModule` already exports.
  A second place that resolves tags to ids would be a second place that can get the validation
  ordering wrong.
- The **`users` row write** for `allowCinemaReleases` is delegated to `UsersService`, beside its
  existing `setUiLocale` (`services/api/src/users/users.service.ts:207`). That method is the
  precedent for a self-service write against the `users` table, and keeping every write to that table
  in one service is worth the one-line indirection. `UsersModule` already exports `UsersService`.
- The **torrent-group replace** is the only write `PreferencesService` performs itself, and it is
  written as a scope-narrowed twin of `setMoviePreferredLanguagesFor`.

**On `web`, `/preferences` is a Server Component with five independent cards**, each with its own
server action and its own `useActionState`, and no page-level *Guardar*. The alternative — one form
posting everything — was rejected twice over: the contract has no transactional multi-write
mutation, and `LanguagePicker` renders its own `<form>`, which cannot be nested inside another one.
`SettingsForm.tsx` already carries the scar tissue of learning that (`030`), and this screen avoids
it by never having a shared form in the first place.

One judgement call the spec left open: `TorrentGroupPicker` is a **new sibling component**, not a
generalization of `LanguagePicker`. Generalizing would mean editing a component with three live call
sites — the two per-title pickers and the Settings one — whose payload is a comma-separated list of
BCP-47 tags, to make it also carry `Int!` ids and a `scope`. The two share a visual shape and not a
data shape. If a third multi-select of this kind appears, that is the moment to extract a shared
presentational shell; not now, with one.

## Order of Work

| Step | Service | Why it must come here |
| :-- | :-- | :-- |
| 1 | `api` | Owns the migration, both enums, the new module and all three mutations. `web` cannot query a field the schema does not have, and it has no codegen and no mocked schema to develop against. |
| 2 | `web` | The screen, the `/settings` strip, the navigation entries. |

Steps 1 and 2 **cannot** meaningfully run in parallel: every `web` step is verified against a
running `api` that already exposes the contract, so "parallel" here means "typing against a schema
that does not exist yet".

What *can* overlap inside step 2, once it starts: **removing the *Descarga* tab from `/settings`**
depends on nothing in step 1 — it reads no new field and calls no new mutation. It is the one piece
of `web` work that could equally have been done last month.

Both prerequisites this feature's 0.1.0 waited on — `018-ui-i18n` and `019-user-menu` — are
implemented. There is nothing to wait for.

## Contract Freeze

The `## GraphQL Contract Delta` in `spec.md` is frozen as of `status: Approved`. Implementers read
it; they do not edit it (Constitution, Article VIII).

Things an implementer will be tempted to change, and must not:

- **The preferences do not hang off `User`.** From inside `api`, `Query.preferences` looks like a
  redundant root when `me` already returns a `User`, and adding `User.preferences` would be one
  decorator. That decorator is the leak: a field attaches per *type*, so it would immediately be
  selectable through the admin `users`/`user(id)` queries and would need a runtime identity check
  returning an empty value to defend it. `029-settings-screen-tabs` deleted exactly that shape, and
  the comment it left in `src/users/entities/user.entity.ts` records why it existed. Do not
  reintroduce it.

- **`preferences.torrentGroups` returns both scopes unfiltered, while `setPreferredTorrentGroups`
  takes a mandatory `scope`.** From inside `api` this looks lopsided and invites a `scope` argument
  on the read. It is right for the feature: `web` renders both pickers from one array, which is what
  keeps the *Películas* and *Series* cards from disagreeing about what is saved.

- **A wrong-scope id is an error, not a filter** (REQ-10). The "helpful" implementation drops the ids
  that do not belong to the scope and reports success — telling the caller its set was saved when a
  different set was saved. Same for an unknown or duplicated language tag: `validateAndResolveLanguageIds`
  throws, and nothing may catch and downgrade that.

- **`Query.torrentGroups` is not administrator-only.** It is a catalog of names and every
  authenticated user needs it to render their own pickers. That an administrator will eventually be
  the one who *writes* it is not a reason to guard the *read* — and `AdminGuard` is very close at
  hand in this codebase since `029`.

- **`allowCinemaReleases` is not a `Setting`.** Do not add it to `SETTINGS_CATALOG` or to
  `EDITABLE_KEYS`, however much it looks like `movies_enabled` sitting next to it in the same
  screen's ancestry.

- **`default_languages` survives** — row, catalog entry and its contribution to every encode
  (REQ-6). Only `DownloadPanel` and the action that writes it are removed. Deleting the row because
  nothing edits it any more is the one change in this feature that would silently alter output
  files.

- **No mutation gains a user id argument, and none gains `@AllowService()`.** A `SERVICE_TOKEN`
  principal has no preferences (REQ-9).

- **Error keys are `api`'s vocabulary.** `web` renders them through
  `src/lib/graphql-error.ts`; it does not invent, rename or string-match on them.

If the contract turns out to be wrong: stop, amend `spec.md`, re-approve, re-brief both services.
Never patch it from inside one slice.

## Migrations

Owned by `api` (Constitution, Article III). One migration, generated through
`bin/npm api run prisma:migrate` — never hand-written SQL.

1. `add_user_preferences`:
   - `ALTER TABLE users ADD COLUMN allowCinemaReleases BOOLEAN NOT NULL DEFAULT false`.
   - `CREATE TABLE user_language_preferences` — `userId`, `languageId`, `kind`, composite PK on all
     three, both FKs `ON DELETE CASCADE`, index on `languageId`.
   - `CREATE TABLE torrent_groups` — `id`, `name`, `scope`, `UNIQUE(name, scope)`.
   - `CREATE TABLE user_torrent_groups` — composite PK `(userId, torrentGroupId)`, both FKs
     `ON DELETE CASCADE`, index on `torrentGroupId`.
   - Both enums render as column-level `ENUM`s on MariaDB, not standalone types.

2. Backfill: **none** (NFR-2). Every existing user reads as "cinema not allowed" from the column
   default and "nothing selected" from the absence of rows, and both are the intended answer rather
   than a placeholder. No seeder is added: `torrent_groups` ships empty by design (REQ-7), and
   seeding it with `036`'s `ntb`/`btm`/`flux` would look like the ranking heuristic had been wired
   to it, which is exactly what NFR-1 forbids.

Reversibility: dropping the three tables and the column restores the previous state exactly, because
nothing outside this feature reads any of them. That holds only while the values stay unconsumed —
the worker spec and the ranking spec are what make this migration one-way in practice.

Verify with `git status services/api/prisma/`: a modified `schema.prisma` **and** a new migration
directory. One without the other is an Article III violation.

## Risks

| Risk | How it fails | Mitigation |
| :-- | :-- | :-- |
| A replace deletes every row for the user instead of only the rows for the `kind`/`scope` being written | Saving audio languages silently clears the subtitle list; saving film groups silently clears the series selection. No error anywhere. The user notices later, on a control they were not looking at, and blames the wrong thing | The `api` slice owes `preferences.service.spec.ts` and a `languages.service.spec.ts` case that seed both sides, write one, and assert the other survived. Verified by fault injection: widen the `where` and the case must fail (AC-5). This is the single most likely defect in the feature |
| A wrong-scope id is filtered out instead of refused | The caller is told "saved" about a set that is not what it sent, and the picker re-renders showing what it sent, so UI and database disagree until the next reload | REQ-10, a spec case for the mixed-scope list, and AC-9 checks the stored set is unchanged after the refusal |
| Validation runs after a partial delete, or the delete/insert pair is not transactional | A rejected write leaves the user with half the old selection gone and none of the new one — a state the caller was told never happened | Copy `setMoviePreferredLanguagesFor`'s ordering verbatim: resolve and validate first, `$transaction` second |
| `/preferences` is built by copying `settings/page.tsx` | That page calls `notFound()` for a non-administrator. Copied, every non-admin gets a 404 on their own preferences — and an implementer testing as the seeded admin sees nothing wrong | REQ-2 states it, AC-2b tests it as a non-admin explicitly, and the `web` plan names `users/page.tsx`'s gate as the thing *not* to copy |
| *Preferencias* is added to `AppSidebar`'s `isAdmin` branch, next to *Ajustes* | Same class: invisible to exactly the users who most need it. Silent for whoever implements it | The entry belongs in `baseNavItems`. AC-2b again |
| `default_languages` is deleted along with its editor | Every encode from then on merges one fewer source of languages, so files get fewer audio and subtitle tracks. Nothing errors; the difference is only visible by playing an output | REQ-6 is explicit, and AC-15 compares the setting's value and an encode's logged `allowedLanguagesIso3` across the change |
| `getPreferences()` uses `redirectIfUnauthenticated` | It is `await`ed during a Server Component's render pass, where cookie mutation throws. The screen 500s for anyone with a stale cookie instead of bouncing to `/login` | `services/web/CLAUDE.md` § "not interchangeable" — read functions use `redirectToClearSession`, form actions use `redirectIfUnauthenticated`. Derive it from where the call happens, not from the nearest example |
| A picker is rendered over an empty catalog | An empty picker submits an empty list, which is a *valid* "clear my selection" write — so a user's saved groups can be wiped by a control that never showed them anything | REQ-7 makes the empty state the card's decision, decided before the picker renders. AC-7 asserts no mutation is sent |
| New files are written in the house style of the files they were copied from | Every file this feature imitates predates Article XI and is full of explanatory comments. Copying that style is a constitution violation in a diff that otherwise looks exemplary | Both service plans say it: copy the *ordering and structure*, not the prose. The only comment owed anywhere in this feature is the Article IX header on each new spec file |

## Verification

```bash
bin/cli api npx --no tsc --noEmit
bin/npm api test
bin/cli api npx prisma migrate status
bin/cli web npx --no tsc --noEmit
bin/npm web run build
bin/npm web run lint
bin/cli web node scripts/check-messages.mjs
```

`check-messages.mjs` has no `package.json` script of its own — it is run directly, which is why the
command above is `bin/cli` rather than `bin/npm`.

Baselines to re-measure rather than trust (root `CLAUDE.md`, 2026-09-01): `api` 0 errors and 294
tests across 32 suites; `web` 0 errors and `next build` exit 0. Both must be no worse after.

Then the manual pass, with the stack up (`bin/dev`):

1. Sign in as the seeded administrator. Sidebar and header menu both offer *Preferencias* and
   *Ajustes* (AC-2). `/settings` shows five tabs, no *Descarga* (AC-1).
2. Sign in as a non-administrator created from `/users`. The sidebar offers *Preferencias* and not
   *Ajustes*; `/preferences` renders all six controls and every one of them saves (AC-2b).
3. With `ui_locale` set to `es` at the installation level, pick English on `/preferences`, reload:
   the UI is English and `me { uiLocale }` returns `en`. A second user still sees Spanish (AC-3).
4. Pick two audio languages and one subtitle language, reload, then
   `bin/mysql -e 'select kind, count(*) from user_language_preferences group by kind'` (AC-4). Save
   the audio list again on its own and re-run the count: the `SUBTITLE` row is unchanged (AC-5).
5. Tick the cinema checkbox, then
   `bin/mysql -e 'select username, allowCinemaReleases from users'` prints `1`; untick, `0`. Create a
   user from `/users` and it prints `0` for them with no preference row written (AC-6).
6. Both group pickers show the "no groups loaded" message and nothing is selectable (AC-7). Seed the
   catalog by hand —
   `bin/mysql -e "insert into torrent_groups (name, scope) values ('GRUPO-A','MOVIE'),('GRUPO-B','SHOW')"`
   — reload, select the film group, reload: still selected, series picker still empty; then select
   the series group and confirm the film selection survived (AC-8).
7. From the Apollo playground with a user cookie, run the refusals: wrong scope (AC-9), unknown id
   and duplicated id (AC-10), unknown tag and duplicated tag (AC-11). After each,
   `bin/mysql -e 'select count(*) from user_torrent_groups'` and the `user_language_preferences`
   count print what they printed before.
8. With `SERVICE_TOKEN` as the bearer, all four operations return `error.auth.unauthenticated`
   (AC-12). `users { id preferences { allowCinemaReleases } }` fails to validate (AC-13).
9. Delete a user through `/users` and check both preference tables for their id (AC-14).
10. `bin/mysql -e "select value from settings where \`key\` = 'default_languages'"` prints what it
    printed before the feature, and an encode run afterwards logs the same `allowedLanguagesIso3`
    (AC-15).
