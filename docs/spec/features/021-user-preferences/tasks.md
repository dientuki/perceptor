---
title: User Preferences — Tasks
last_updated: 2026-08-19
status: Draft
---

# TASKS: User Preferences (`tasks.md`)

## Legend

| Marker | Meaning |
| :-- | :-- |
| `[api]` `[web]` `[worker]` `[infra]` | Which subagent owns the task. Exactly one per task. |
| `[docs]` | Documentation only. Owned by the orchestrator, not a service agent. |
| `[P]` | May run in parallel with the other `[P]` tasks in the same group. |
| `→ Tnnn` | Blocked by that task. |

No `[worker]` tasks: nothing in the job payload or the encode pipeline changes. No `[infra]` tasks:
this feature adds no environment variable, changes no `bin/` wrapper, and touches no Dockerfile or
`docker-compose.yaml`.

## Prerequisites

These are **not** tasks in this feature — they are other features that must already be implemented
before T001 starts (`plan.md` § Order of Work):

- **`018-ui-i18n`** — owns `User.uiLocale`, `Query.supportedLocales`, `Mutation.setUiLocale`, the
  `src/i18n/` key vocabulary this feature's errors are written in, and the `messages/*.json`
  catalogs every new string belongs to. Starting before it means writing Spanish literals into new
  components and then rewriting them.
- **`019-user-menu`** — owns the header menu whose *Ajustes* entry T017 adds *Preferencias* beside.

If either is unimplemented when this feature is dispatched, stop and say so rather than working
around it.

## Tasks

### Group 1 — Schema, vocabulary and the contract (`api`)

Nothing in `web` can start until the contract exists and matches `spec.md`. T009 is the gate.

- [ ] **T001** `[api] [P]` Add `TorrentGroupScope`, `TorrentGroup`, `UserTorrentGroup`,
      `User.allowCinemaReleases` and the `User.torrentGroups` back-relation to
      `prisma/schema.prisma`, following the `Language`/`UserLanguage` block above it (snake_case
      `@@map`, `@@index` on the non-leading key). Generate the migration with
      `bin/npm api run prisma:migrate`. No backfill.
      *Done when:* `bin/cli api npx prisma migrate status` reports no pending migration;
      `git status services/api/prisma/` shows a modified `schema.prisma` **and** exactly one new
      migration directory; `bin/mysql -e 'select count(*) from torrent_groups'` prints `0` and
      `bin/mysql -e 'select allowCinemaReleases from users'` prints `0` for every existing row.

- [ ] **T002** `[api] [P]` Add `error.torrent_group.not_found`, `error.torrent_group.duplicated` and
      `error.torrent_group.wrong_scope` to `src/i18n/error-keys.ts`, with the English templates from
      `spec.md`'s error table in `src/i18n/messages.en.ts`.
      *Done when:* all three exist as constants with an English message, and
      `bin/cli api npx --no tsc --noEmit` reports 0 errors.

- [ ] **T003** `[api]` Write `src/torrent-groups/entities/torrent-group.entity.ts` — the
      `TorrentGroupScope` enum via `registerEnumType` and the `@ObjectType() TorrentGroup`, mirroring
      `languages/entities/language.entity.ts` including a header comment saying the catalog is
      administrator-loaded and ships empty. → T001
      *Done when:* `bin/cli api npx --no tsc --noEmit` reports 0 errors.

- [ ] **T004** `[api]` Write `src/torrent-groups/torrent-groups.service.ts` — `findAll(scope?)`,
      private `resolveTorrentGroupIds(scope, ids)` (duplicates, then unknown, then wrong-scope, all
      before any write), `setPreferredFor(userId, scope, ids)` and `findPreferredFor(userId)`. Copy
      `LanguagesService`'s validate-then-`$transaction` ordering, and write the equivalent of its
      file-header comment explaining why. The `deleteMany` must be narrowed to the given scope, not
      to `{ userId }`. → T002, T003
      *Done when:* `bin/cli api npx --no tsc --noEmit` reports 0 errors and the file carries a header
      comment naming the failure the ordering prevents.

- [ ] **T005** `[api]` Write `src/torrent-groups/torrent-groups.service.spec.ts` covering the five
      cases in `api/plan.md` § Tests: a `MOVIE` write leaves `SHOW` rows intact, wrong-scope /
      unknown / duplicated ids are each refused **with no write attempted**, and an empty list clears
      only the given scope. Open it with the Article IX paragraph naming the silent failure. → T004
      *Done when:* `bin/npm api test` passes with one more suite than the 16 recorded in the root
      `CLAUDE.md`, and the scope-isolation case fails if `deleteMany`'s `where` is widened to
      `{ userId }` (verify by temporarily widening it).

- [ ] **T006** `[api]` Write `src/torrent-groups/torrent-groups.resolver.ts` (the `torrentGroups`
      query with an optional `scope`, and `setPreferredTorrentGroups` — `@CurrentUser()` only, no
      user argument, no `@AllowService()`) and `torrent-groups.module.ts`; register the module in
      `src/app.module.ts`. → T004
      *Done when:* `api` boots, and in the playground with a user cookie `torrentGroups` returns
      `[]` while `setPreferredTorrentGroups` called with a `SERVICE_TOKEN` bearer returns
      `error.auth.unauthenticated`.

- [ ] **T007** `[api] [P]` Add `allowCinemaReleases` as a plain `@Field()` on
      `src/users/entities/user.entity.ts`, `setAllowCinemaReleases(userId, allowed)` to
      `src/users/users.service.ts`, and the `setAllowCinemaReleases` mutation to
      `src/auth/auth.resolver.ts` beside `me`. Do not add a `select` anywhere — `getProfile` and
      `findAll` already return whole rows. → T001
      *Done when:* `setAllowCinemaReleases(allowed: true)` in the playground returns the user, and
      `bin/mysql -e 'select username, allowCinemaReleases from users'` shows `1` for that row and
      `0` for the others.

- [ ] **T008** `[api]` Add `preferredTorrentGroups` to `src/users/entities/user.entity.ts` (optional
      in TypeScript, like `preferredLanguages`) and its field resolver to `src/auth/auth.resolver.ts`
      directly beside `preferredLanguages`, with the identical non-caller `[]` guard; import
      `TorrentGroupsModule` in `src/auth/auth.module.ts`, extending the existing comment there.
      → T006
      *Done when:* signed in as an admin, `users { id preferredTorrentGroups { id } }` returns `[]`
      for every user except the caller, including for a user with rows in `user_torrent_groups`
      (AC-11).

- [ ] **T009** `[api]` Restart `api` so `src/schema.gql` regenerates, and diff the result against
      `spec.md` § GraphQL Contract Delta (Article VIII's check). Never hand-edit the file. → T005,
      T006, T007, T008
      *Done when:* every type, field, argument and nullability in the delta appears in `schema.gql`
      with no difference; `bin/cli api npx --no tsc --noEmit` reports 0 errors and `bin/npm api test`
      reports no failures. Any mismatch goes to § Blocked instead of being fixed in either direction.

### Group 2 — The screen (`web`)

Everything here except T010 waits on Group 1: `web` has no codegen, so each step is verified against
a running `api` that already exposes the contract.

- [ ] **T010** `[web] [P]` Write `src/components/preferences/UiLocaleCard.tsx` — a single-select over
      `018-ui-i18n`'s `supportedLocales`, labelled with `Intl.DisplayNames`, submitting through its
      `setUiLocaleAction`. Depends on `018` only, not on this feature's `api` slice.
      *Done when:* `bin/cli web npx --no tsc --noEmit` reports 0 errors and every string in the file
      resolves through the message catalog.

- [ ] **T011** `[web]` Write `src/types/torrent-groups.ts` (hand-typed from `spec.md`;
      `TorrentGroupScope` as a string union), `src/actions/torrent-groups.ts`
      (`getTorrentGroups`, `setPreferredTorrentGroupsAction` — `ids` converted with `Number`) and
      `src/actions/preferences.ts` (`setAllowCinemaReleasesAction`), following
      `src/actions/languages.ts`'s shape and deriving errors through `src/lib/graphql-error.ts`.
      → T009
      *Done when:* `bin/cli web npx --no tsc --noEmit` reports 0 errors, and each of the three
      `error.torrent_group.*` keys has a handler that returns it as the action's `error` rather than
      being swallowed.

- [ ] **T012** `[web]` Extend `ME_QUERY` and the `CurrentUser` type in `src/actions/auth.ts` with
      `allowCinemaReleases` and `preferredTorrentGroups { id name scope }` — one round trip, not a
      second query. → T009
      *Done when:* `getCurrentUser()` returns both fields, and no new `me` call was added anywhere.

- [ ] **T013** `[web]` Write `src/components/preferences/TorrentGroupPicker.tsx` (a sibling of
      `LanguagePicker`, never a generalization of it) and `TorrentGroupsCard.tsx`, which decides
      between the empty state and the picker on `options.length === 0` and reverts its selection to
      the server's on a refusal. → T011, T012
      *Done when:* with an empty catalog the card renders the "no groups loaded" message, nothing is
      selectable, and no mutation is sent (AC-6); `src/components/media/LanguagePicker.tsx` is
      unchanged in `git diff`.

- [ ] **T014** `[web]` Write `src/components/preferences/CinemaReleasesCard.tsx`, reusing the
      `movies_enabled` checkbox markup from `SettingsForm.tsx` but calling
      `setAllowCinemaReleasesAction`, not `updateSettings`. → T011, T012
      *Done when:* ticking it and reloading keeps it ticked, and
      `bin/mysql -e 'select allowCinemaReleases from users where username = "<user>"'` prints `1`;
      unticking prints `0` (AC-5).

- [ ] **T015** `[web]` Move `PreferredLanguagesCard.tsx` from `src/components/settings/` to
      `src/components/preferences/` (contents unchanged apart from imports and its header comment),
      and write `src/app/(dashboard)/preferences/page.tsx` — one `Promise.all`, then the three groups
      in spec order: *Idiomas* (T010 + the moved card), *Películas* (T014 + T013 scoped `MOVIE`),
      *Series* (T013 scoped `SHOW`). No page-level *Guardar*. → T010, T013, T014
      *Done when:* `/preferences` renders all three groups (AC-1); selecting an extra download
      language and reloading shows it still selected and `me { preferredLanguages { iso2 } }` lists
      it (AC-4); changing the interface language and reloading renders the UI in that language and
      `me { uiLocale }` returns the new tag (AC-3).

- [ ] **T016** `[web]` Strip `src/app/(dashboard)/settings/page.tsx`: remove `PreferredLanguagesCard`
      and the now-unused `getLanguages()` and `getCurrentUser()` calls. → T015
      *Done when:* `grep -rn "PreferredLanguagesCard" "services/web/src/app/(dashboard)/settings"`
      returns nothing (AC-12), `/settings` still renders the paths, API keys and media-server block,
      and saving them still works.

- [ ] **T017** `[web]` Add a *Preferencias* entry to `src/layout/AppSidebar.tsx`'s `navItems` and to
      `src/components/header/UserDropdown.tsx` beside `019-user-menu`'s *Ajustes*, both labelled from
      the catalog. → T015
      *Done when:* both the sidebar and the header menu offer *Preferencias* and *Ajustes*, landing
      on `/preferences` and `/settings` respectively (AC-2).

- [ ] **T018** `[web]` Complete `messages/en.json` and `messages/es.json` for every string this slice
      added, including the three `error.torrent_group.*` keys, and run `018-ui-i18n`'s catalog parity
      check. → T013, T014, T015, T016, T017
      *Done when:* `bin/npm web run scripts/check-messages.mjs` (or the script name `018` settled on)
      reports parity; `bin/cli web npx --no tsc --noEmit` reports 0 errors; `bin/npm web run build`
      exits 0; `bin/npm web run lint` reports no new findings; and no user-facing literal remains in
      `src/components/preferences/` or `src/app/(dashboard)/preferences/`.

### Group 3 — Verification and docs

- [ ] **T019** `[docs]` Update `services/api/CLAUDE.md` (the module map gains `torrent-groups/`; the
      test counts), `services/web/CLAUDE.md` (the `/preferences` screen, and that `/settings` is now
      installation-wide only), and the root `CLAUDE.md` *Current state* counts. The pipeline table
      does **not** change — no stage moves. → T009, T018
      *Done when:* each file names the new module or screen, and the counts match what
      `bin/npm api test` and the two typechecks actually reported.

- [ ] **T020** `[docs]` Walk AC-1 through AC-13 in `spec.md` against the running stack — including
      the three playground refusals (AC-8, AC-9) with
      `bin/mysql -e 'select count(*) from user_torrent_groups'` unchanged either side, the
      `SERVICE_TOKEN` refusal (AC-10), and the hand-seeded two-scope check (AC-7). Tick each box and
      set `status: Implemented` on `spec.md`, `plan.md`, `api/plan.md` and `web/plan.md`. → T019
      *Done when:* every acceptance criterion is ticked with the observed result, or listed in
      § Blocked with what stopped it.

## Blocked

Anything an agent stopped on rather than working around. Empty is the normal state; a non-empty
entry is a decision waiting for a human.

| Task | Service | What blocked it | Needs |
| :-- | :-- | :-- | :-- |

Contract problems always land here (Constitution, Article VIII): an agent that finds the GraphQL
delta wrong stops and reports, it does not amend the delta from inside its slice.
