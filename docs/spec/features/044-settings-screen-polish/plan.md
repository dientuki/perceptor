---
title: Settings Screen Polish — Implementation Plan
spec_version: 0.1.0
last_updated: 2026-09-04
status: Implemented
---

# PLAN: Settings Screen Polish (`plan.md`)

## Approach

This feature is two things wearing one hat, and the plan keeps them separate because their risk
profiles could not be more different.

The first is a presentation pass over `services/web/src/components/settings/` — icons, chevrons,
switches, a disabled state, a confirmation that clears. Nothing here crosses the service boundary,
nothing here can fail silently except by writing the wrong thing to the database, and the whole of
it reuses controls that already exist: `components/form/switch/Switch.tsx` (the control REQ-3 wants,
already used by `CompressionPanel`), `components/form/Select.tsx` (which already carries
`appearance-none`, so REQ-2 is a wrapper and a positioned `ChevronDown` from `lucide-react`, not a
new control), and the `hidden input beside a controlled widget` idiom that `PathPicker.tsx` and
`CheckboxField.tsx` both already implement. The one genuinely new value is
`compression_resolution`, which is an entry in `SETTINGS_CATALOG` and a line in the seed — the
settings pipeline (`updateSettings` → `SettingsService.updateMany` → per-`kind` validation) already
handles an `enum` kind end to end and needs no new code at all.

The second is the torrent-group ABM, and it is the reason this is a spec. `021-user-preferences`
put `scope` on `TorrentGroup`, which makes the catalog a list of (name, scope) pairs an
administrator would have to enter twice. Moving `scope` onto `UserTorrentGroup` makes the catalog a
flat list of names and the scope a per-user, per-group decision — which is what the feature asks
for and, not incidentally, what the join table was always the right home for. The administrator's
two mutations go into the **existing** `preferences` module (`PreferencesResolver` /
`PreferencesService`) rather than a new `torrent-groups` module: `findCatalog` already lives there,
the entity is already declared there, and a third module holding two mutations over a two-column
table would be ceremony. `SettingsResolver` is the precedent for one resolver carrying per-method
guards of different strengths (`@Public()` beside `AdminGuard`), and this resolver follows it —
which does mean its class-level header comment, which currently claims every operation is rooted at
`@CurrentUser()`, stops being true and must be rewritten.

The alternative considered for the contract was keeping `UserPreferences.torrentGroups` as one list
and adding `scope` to *that* payload — a `UserTorrentGroupSelection` wrapper type. It was rejected:
`UserPreferences` already splits a two-valued kind into two fields (`audioLanguages` /
`subtitleLanguages`), `web` already keeps two pieces of state (`movieGroupIds` / `showGroupIds`) and
immediately filters the single list into them, and a wrapper type would add a GraphQL type to
express something the existing shape expresses for free.

## Order of Work

`api` first, without qualification. It owns the migration, and every `web` change to the group
picker reads a schema shape that does not exist until the migration and the decorators have landed.

| Step | Service | Why it must come here |
| :-- | :-- | :-- |
| 1 | `api` | Owns the Prisma migration, the `TorrentGroup`/`UserPreferences` decorators and the two new mutations. `web` cannot query `movieTorrentGroups` before it exists. |
| 2 | `api` | `compression_resolution` in `SETTINGS_CATALOG` + the seed. Independent of step 1; same slice, same agent. |
| 3 | `web` | The presentation pass (REQ-1 – REQ-5, REQ-7). Touches no GraphQL. |
| 4 | `web` | The Compression resolution control (REQ-6). Needs step 2 landed, or the save is rejected as a non-editable key. |
| 5 | `web` | The Torrent Manager ABM and the `/preferences` retype (REQ-8 – REQ-11). Needs step 1 landed. |

**Genuinely parallel:** step 3 can run alongside steps 1–2 — it is confined to
`components/settings/` and touches nothing either `api` step produces. Steps 4 and 5 cannot: both
fail at runtime against an `api` that has not moved, and the failure for step 5 is a GraphQL
validation error on every render of `/preferences`, which looks like a `web` bug and is not.

## Contract Freeze

The `## GraphQL Contract Delta` in `spec.md` is frozen as of `status: Approved`. Three things an
implementer will be tempted to change and must not:

- **`setPreferredTorrentGroups` keeps `scope` as an argument** even though `TorrentGroup` no longer
  carries one. From inside `api` this reads like a leftover; it is not. The scope is now a property
  of the *selection*, and this mutation writes one scope's worth of selection — dropping the
  argument would make it impossible to express "this group, for series only".
- **`UserPreferences` gains two fields rather than one field plus a wrapper type.** See Approach. An
  implementer who finds themselves declaring `UserTorrentGroupSelection` has left the contract.
- **`torrentGroups` loses its `scope` argument and becomes admin-agnostic.** It stays readable by
  any signed-in user (`JwtAuthGuard` only) because `/preferences` — a non-admin screen — is its main
  consumer. Putting `AdminGuard` on it because the *mutations* are admin-only breaks preferences for
  every ordinary user, and does so with a `ForbiddenException` that looks like a session problem.

`error.torrent_group.duplicated` is **not** reused for the name collision. It already means "the
same id appeared twice in one `setPreferredTorrentGroups` call" and its copy interpolates `{id}`.
The new condition gets `error.torrent_group.name_taken`.

## Migrations

One migration, generated through `bin/npm api run prisma:migrate` and then hand-ordered, because
the statement order Prisma picks for this shape loses data. `api` owns it.

The generated SQL must end up in this order. **Steps 3 and 4 must precede step 5** — this is the
trap:

1. `ALTER TABLE user_torrent_groups ADD COLUMN scope ENUM('MOVIE','SHOW') NULL;`
2. Backfill: `UPDATE user_torrent_groups utg JOIN torrent_groups tg ON tg.id = utg.torrentGroupId
   SET utg.scope = tg.scope;` — every row is covered, the FK guarantees the join finds a partner.
3. `ALTER TABLE user_torrent_groups MODIFY scope ENUM('MOVIE','SHOW') NOT NULL;`
4. Widen the primary key: `DROP PRIMARY KEY, ADD PRIMARY KEY (userId, torrentGroupId, scope)`.
5. Repoint duplicates onto the surviving row: `UPDATE user_torrent_groups utg JOIN torrent_groups tg
   ON tg.id = utg.torrentGroupId JOIN (SELECT name, MIN(id) AS keep_id FROM torrent_groups GROUP BY
   name) k ON k.name = tg.name SET utg.torrentGroupId = k.keep_id;`
6. Delete the losing catalog rows: the same `MIN(id)` subquery, `WHERE tg.id <> k.keep_id`.
7. `ALTER TABLE torrent_groups DROP INDEX torrent_groups_name_scope_key, DROP COLUMN scope,
   ADD UNIQUE INDEX torrent_groups_name_key (name);`

Why the order matters: a user who had picked "FLUX (MOVIE)" and "FLUX (SHOW)" holds two rows. Step 5
repoints both at the same surviving `torrentGroupId`. Under the **old** primary key
`(userId, torrentGroupId)` that is a duplicate-key error and the migration aborts halfway; under the
widened key the two rows differ by `scope` and both survive, which is the correct outcome — the user
keeps the group for both scopes. Running step 5 before step 4 is the single most likely way to get
this wrong, and on a populated database it fails loudly rather than silently, which is the one mercy
here.

**In practice every installation has zero rows in both tables** — there is no seed and no mutation
that ever wrote one (that absence is the bug this feature fixes), so the backfill is a no-op on real
data. It is written correctly anyway; a spec that assumes its own tables are empty is a spec that
breaks the one installation where they are not.

Reversibility: not reversible without loss. Rolling back re-adds `scope` to `torrent_groups` with no
information about which value a given row should take, and a user who selected one group for both
scopes cannot be represented at all in the old shape. `bin/dbreset` is the dev-side escape hatch.

`compression_resolution` needs no migration — it is a row in `settings`, added by the create-only
seed (`prisma/seeds/settings.ts`), which backfills a key that does not yet exist without touching
any key that does.

## Risks

| Risk | How it fails | Mitigation |
| :-- | :-- | :-- |
| Migration step 5 runs before the PK is widened | Duplicate-key abort mid-migration on any installation with a user who picked the same group name in both scopes; the database is left with `scope` added but the catalog not collapsed | The ordered spine above is normative; `api/plan.md` repeats it as a numbered step list, and the migration is applied against a seeded dev database before the slice is called done |
| The Resolution radios keep `name=""` | The user picks 720p, presses Save, sees "Settings saved." — and nothing was ever submitted. **No error anywhere**, which is precisely the state the control is in today | REQ-6 requires the value to be re-read on the next render, and AC-5 checks the `settings` row directly rather than the screen. The `CheckboxField`/`PathPicker` hidden-input idiom is the prescribed shape |
| Gating a folder input clears its submitted value | Disabling "Enable movies" and saving writes `path_movies = '.'` (or drops it), silently repointing the library at the media root — the next encode files a film into the root and nothing reports a problem | REQ-4 states the stored value must survive gating. The hidden input keeps carrying the stored value while the visible input is read-only; it is never blanked, and never re-derived from a disabled control |
| The service's duplicate-name check disagrees with the column's collation | MariaDB's default collation is case-insensitive, so `flux` next to `FLUX` passes a JS `===` check and is rejected by the unique index as a raw Prisma `P2002` — the user sees an untranslated database error instead of the contract's message | The service compares case-insensitively **and** catches `P2002` on the insert, mapping both to `error.torrent_group.name_taken` |
| `setPreferredTorrentGroupsFor`'s delete loses its scope narrowing | The `deleteMany` currently narrows through `torrentGroup: { scope }`, which stops compiling once the column moves. Rewriting it to `{ userId }` alone compiles, passes a happy-path check, and silently wipes the sibling scope on every save | `preferences.service.spec.ts` already defends exactly this (its two surviving "leaves the sibling scope in place" tests); the in-memory fake is extended with the new `scope` column rather than replaced |
| `web` keeps `scope` in a GraphQL document | Every `/preferences` render fails with "Cannot query field scope on type TorrentGroup" | Loud, not silent — but it takes out a whole screen, so the retype is a listed obligation in `web/plan.md` with the grep that finds all of them |
| The sample gallery gets committed | `components/form/form-elements/` imports `@/icons`, an alias this project does not define; `bin/npm web run build` fails | NFR-4; the `web` slice deletes the directory, and the build is in the verification block |

## Verification

```bash
bin/cli api npx --no prisma migrate status
bin/npm api run test
bin/cli api npx --no tsc --noEmit
bin/npm web run build
bin/npm web run lint
bin/cli web node scripts/check-messages.mjs
```

Schema regeneration is confirmed by diffing the generated file against the frozen delta
(Constitution, Article VIII):

```bash
git diff services/api/src/schema.gql
```

Then the manual pass, which is where every acceptance criterion in `spec.md` is actually reached:

1. `/settings` → confirm the three tab icons (AC-1), the two chevrons (AC-2), the two switches and
   the folder gating (AC-3).
2. Toggle "Enable series", Save, reload; then toggle it back, Save, reload —
   `bin/mysql -e "select \`key\`, value from settings where \`key\` in ('shows_enabled','movies_enabled')"`
   (AC-4).
3. Compression tab → choose 720p, Save, reload, then
   `bin/mysql -e "select value from settings where \`key\`='compression_resolution'"` (AC-5). Send an
   `updateSettings` with `480p` and confirm `extensions.i18n.key` is `error.setting.expected_enum`
   and the row is unchanged (AC-6).
4. Save on any tab, then click another tab — the confirmation is gone (AC-7).
5. Torrent Manager → add `FLUX`, confirm the badge and `bin/mysql -e 'select * from torrent_groups'`;
   add `FLUX` again and confirm the inline message, no second badge, `count(*) = 1` (AC-8, AC-9);
   remove it with the X and confirm the row is gone.
6. Sign in as a non-admin, `/preferences` → `FLUX` offered on both Movies and Series; select it for
   Series only, Save, reload, then `bin/mysql -e 'select * from user_torrent_groups'` shows one row
   with `scope = 'SHOW'` (AC-10).
7. `grep -rn "scope" services/web/src/types/preferences.ts services/web/src/actions/preferences.ts`
   returns only `TorrentGroupScope` and `setPreferredTorrentGroups`' argument — no `TorrentGroup.scope`
   selection anywhere (AC-11).
