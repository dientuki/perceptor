---
title: User Preferences — Implementation Plan
spec_version: 0.1.0
last_updated: 2026-08-19
status: Approved
---

# PLAN: User Preferences (`plan.md`)

## Approach

Three of the four controls on the new screen already have a backing mutation; only one is genuinely
new. That asymmetry is what shapes this plan.

**Nothing is built for the language half.** The interface language is `018-ui-i18n`'s
`setUiLocale` / `supportedLocales`, consumed as it stands. The additional download languages are the
existing `setPreferredLanguages` and the existing `PreferredLanguagesCard.tsx` /
`LanguagePicker.tsx`, relocated from `/settings` to `/preferences` without a behavioural change.
Both are re-used, not reimplemented, and the `api` slice touches neither.

**The cinema flag is a column and a self-service mutation on the caller.** It follows the precedent
`018-ui-i18n` set for `setUiLocale`: the write lives in `UsersService`, the mutation on
`AuthResolver` beside `me` — the resolver whose whole reason for existing is "the caller acting on
themselves" — and the value is a plain `@Field()` on the `User` entity, not a settings key.
`SettingsService` and `SETTINGS_CATALOG` are deliberately untouched: `Setting` is a single global
key/value table with no user dimension, and `011-av1-transcode` already established that a per-user
preference gets its own mutation instead of a catalog entry.

**The torrent groups get a new module, modelled line for line on `languages/`.** `TorrentGroup` /
`UserTorrentGroup` are the same shape as `Language` / `UserLanguage`; `TorrentGroupsService` is the
same validate-the-whole-list-then-replace-inside-a-`$transaction` shape as `LanguagesService`, whose
file-header comment already explains precisely why the validation must precede the delete. The one
structural difference is `scope`: `setPreferredTorrentGroups` replaces the rows for **one** scope and
must leave the other alone, where `setPreferredLanguagesFor` deletes everything for the user. That
single divergence is the whole risk surface of this feature (see § Risks).

On `web`, `/preferences` is a Server Component in the `(dashboard)` group that fetches its four
inputs in one `Promise.all` and hands them to four independent cards, each with its own server
action and its own `useActionState`. There is no page-level *Guardar*. The alternative — one form
posting everything — was rejected because it would either need a transactional multi-write mutation
the contract does not have, or would silently half-save when one control failed.

One judgement call the spec left open: the torrent-group picker is a **new sibling component**
(`TorrentGroupPicker.tsx`) rather than a generalization of `LanguagePicker`. Generalizing would mean
editing a component with three other call sites (the global card plus both per-title pickers on
`/movies/[id]` and `/shows/[id]`), and `018-ui-i18n`'s `web` plan explicitly ring-fences
`LanguagePicker`/`PreferredLanguagesCard` as "do not touch beyond string extraction". The two
components share a visual shape but not a payload (`iso2: [String!]` versus `scope` + `ids: [Int!]`).
If a third multi-select appears, that is the moment to extract a shared presentational shell — not
now.

## Order of Work

This feature has two hard prerequisites, both approved and neither implemented. They are not
optional sequencing preferences; the screen cannot be built correctly without them.

| Step | Service | Why it must come here |
| :-- | :-- | :-- |
| 0a | — | **`018-ui-i18n` must be implemented first.** It owns `User.uiLocale`, `supportedLocales`, `setUiLocale`, the `src/i18n/` error-key vocabulary this feature's errors are written in, and the `messages/*.json` catalogs every new string on this screen belongs to (NFR-1). Building `/preferences` before it means writing Spanish literals into new components and then rewriting them. |
| 0b | — | **`019-user-menu` must be implemented first.** REQ-3 requires *Preferencias* to sit beside *Ajustes* in the header menu, and that menu — with its *Ajustes* entry pointing at `/settings` — is `019`'s deliverable. Today's `UserDropdown.tsx` still carries the untranslated TailAdmin placeholders. `020-profile-edit` amends `019` but is independent of this feature and may land in any order relative to it. |
| 1 | `api` | Owns the migration, the enum, the new module and the two new mutations. `web` cannot query a field the schema does not have. |
| 2 | `web` | The screen, the split, the navigation entries. |

Steps 1 and 2 **cannot** meaningfully run in parallel: `web` has no codegen and no mocked schema, so
every step of the `web` slice is verified against a running `api` that must already expose the
contract. What *can* overlap inside step 2 is the two halves of the `web` work — relocating the
languages card off `/settings` touches no new field and depends on nothing in step 1.

## Contract Freeze

The `## GraphQL Contract Delta` in `spec.md` is frozen as of `status: Approved`. Implementers read
it; they do not edit it (Constitution, Article VIII).

Things an implementer will be tempted to change, and must not:

- **`preferredTorrentGroups` returns both scopes in one unfiltered list, while
  `setPreferredTorrentGroups` takes a mandatory `scope`.** From inside `api` this looks lopsided and
  invites adding a `scope` argument to the field. It is right for the feature: `web` renders both
  pickers on one screen from one read, and two scope-filtered field selections would let the
  *Películas* and *Series* cards disagree about what is saved.

- **A wrong-scope id is an error, not a filter** (REQ-10). The tempting "helpful" implementation
  silently drops the ids that do not belong to the scope and reports success. That tells the caller
  its set was saved when a different set was saved — the exact class of silent failure Article IX
  exists for.

- **`torrentGroups` is not admin-only.** It is a catalog of names and every authenticated user needs
  it to render their own pickers. Do not add `AdminGuard` because the catalog is admin-*written*.

- **`allowCinemaReleases` is not a `Setting`.** Do not add it to `SETTINGS_CATALOG` or
  `EDITABLE_KEYS`, however much it looks like `movies_enabled` sitting next to it.

- **No mutation here gains a user id argument, and none gains `@AllowService()`.** A `SERVICE_TOKEN`
  principal has no preferences (REQ-9).

- **Error keys are `api`'s vocabulary.** `web` renders them; it does not invent, rename or
  string-match on them.

If the contract turns out to be wrong: stop, amend `spec.md`, re-approve, re-brief both services.
Never patch it from inside one slice.

## Migrations

Owned by `api` (Constitution, Article III). One migration, generated through
`bin/npm api run prisma:migrate` — never hand-written SQL.

1. `add_torrent_groups_and_cinema_flag`:
   - `CREATE TYPE`/enum `TorrentGroupScope` (`MOVIE`, `SHOW`) — on MariaDB, Prisma renders this as a
     column-level `ENUM`, not a standalone type.
   - `CREATE TABLE torrent_groups` — `id`, `name`, `scope`, `UNIQUE(name, scope)`.
   - `CREATE TABLE user_torrent_groups` — composite PK `(userId, torrentGroupId)`, both FKs
     `ON DELETE CASCADE`, index on `torrentGroupId`.
   - `ALTER TABLE users ADD COLUMN allowCinemaReleases BOOLEAN NOT NULL DEFAULT false`.

2. Backfill: **none** (NFR-2). Every existing user reads as "cinema not allowed" from the column
   default, and as "no groups selected" from the absence of join rows. Both are the intended answer,
   not a placeholder. `torrent_groups` ships empty by design (REQ-7) — there is no seed, and adding
   one is out of scope.

Reversibility: dropping the two tables and the column restores the previous state exactly, because
nothing outside this feature reads any of the three. That is only true for as long as the flag stays
unconsumed — the later automatic-search feature is what makes this migration one-way in practice.

Verify with `git status services/api/prisma/`: a modified `schema.prisma` **and** a new migration
directory. One without the other is an Article III violation.

## Risks

| Risk | How it fails | Mitigation |
| :-- | :-- | :-- |
| `setPreferredTorrentGroups` deletes every row for the user before inserting, instead of only the rows in the given scope | Saving film groups silently clears the series selection. No error anywhere; the user only notices later, on a screen they were not looking at, and blames the other picker | The `api` slice owes `torrent-groups.service.spec.ts` a case that seeds both scopes, writes one, and asserts the other survived (AC-7). This is the single most likely defect in the feature |
| A wrong-scope id is filtered out instead of refused | Caller is told "saved" about a set that is not what it sent; the picker re-renders showing the ids it sent, so the UI and the database disagree until the next reload | REQ-10 + a spec case for the mixed-scope list, and AC-8 verifies the stored set is unchanged after the refusal |
| Validation runs after a partial delete, or the delete/insert pair is not transactional | A rejected write leaves the user with half their old selection gone and none of the new one — a state the caller was told never happened | Copy `LanguagesService`'s ordering verbatim: `resolveIds` first, `$transaction` second. Its file-header comment already states this reasoning; do not paraphrase it into a weaker version |
| `preferredTorrentGroups` is added as a plain entity field instead of a guarded field resolver | An admin listing users through the `users` query reads every user's preferences. No error — it just quietly returns data it should not | Field resolver on `AuthResolver` returning `[]` for a non-caller parent, mirroring `preferredLanguages` at `auth.resolver.ts:78`. AC-11 verifies it |
| `web` renders the picker over an empty catalog | An empty `<select multiple>` looks like a broken control, and submitting it sends `ids: []`, which is a *valid* "clear my selection" write — so the user's saved groups could be wiped by a UI that never showed them | REQ-7 makes the empty state the card's decision, before the picker exists. AC-6 asserts no mutation is sent |
| The languages card is copied to `/preferences` instead of moved | Two screens write the same preference through the same mutation; they disagree the moment one is left open | AC-12 greps `/settings` for the component. `git status` on the `web` slice must show a deletion in `settings/page.tsx`, not only an addition |

## Verification

```bash
bin/cli api npx --no tsc --noEmit
bin/npm api test
bin/cli api npx prisma migrate status
bin/cli web npx --no tsc --noEmit
bin/npm web run build
```

Baseline before starting: `api` 0 errors / 156 tests across 16 suites; `web` 0 errors, build exits 0
(root `CLAUDE.md`, measured 2026-08-18). Both must be re-measured rather than trusted, and both must
be no worse after.

Then the manual pass, with the stack up (`bin/dev`):

1. Sign in. The header menu and the sidebar both offer *Preferencias* and *Ajustes* (AC-2).
2. `/settings` shows the paths, the API keys and the media-server block, and **no** *Idiomas
   preferidos* card (AC-1, AC-12).
3. `/preferences` shows *Idiomas*, *Películas*, *Series*. Both group pickers show the "no groups
   loaded" message and nothing is selectable (AC-6).
4. Change the interface language, reload, confirm the UI language changed (AC-3). Select an extra
   download language, reload, confirm it stuck (AC-4).
5. Tick the cinema checkbox, then
   `bin/mysql -e 'select username, allowCinemaReleases from users'` prints `1` for that user; untick
   and it prints `0` (AC-5).
6. Seed the catalog by hand —
   `bin/mysql -e "insert into torrent_groups (name, scope) values ('GRUPO-A','MOVIE'),('GRUPO-B','SHOW')"`
   — reload, select the film group, reload again: it is still selected and the series picker is still
   empty. Then select the series group and confirm the film selection survived (AC-7).
7. From the Apollo playground with a user cookie, run the three refusals — wrong scope (AC-8),
   unknown id and duplicated id (AC-9) — and after each,
   `bin/mysql -e 'select count(*) from user_torrent_groups'` prints the same number as before.
8. With `SERVICE_TOKEN` as the bearer, both mutations return `error.auth.unauthenticated` (AC-10).
9. Signed in as an admin, `users { id preferredTorrentGroups { id } }` returns `[]` for every user
   except the caller (AC-11).
