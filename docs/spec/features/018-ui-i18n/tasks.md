---
title: UI Internationalization — Tasks
last_updated: 2026-08-19
status: Draft
---

# TASKS: UI Internationalization (`tasks.md`)

## Legend

| Marker | Meaning |
| :-- | :-- |
| `[api]` `[web]` `[worker]` `[infra]` | Which subagent owns the task. Exactly one per task. |
| `[docs]` | Documentation only. Owned by the orchestrator, not a service agent. |
| `[P]` | May run in parallel with the other `[P]` tasks in the same group. |
| `→ Tnnn` | Blocked by that task. |

No `[infra]` tasks: this feature adds no environment variable, changes no `bin/` wrapper, and
touches no Dockerfile or `docker-compose.yaml`. `next-intl` is a `services/web/package.json`
dependency installed through `bin/npm web install`, which is `web`'s own territory.

## Tasks

### Group 1 — Vocabulary and transport (`api`)

Nothing else in the feature can start until a key exists and survives the wire. T004 is the gate:
verify a keyed error arrives with `extensions.i18n` **by hand in the playground** before anyone
rewrites a call site — a formatter bug found after 64 rewrites is indistinguishable from a
call-site bug.

- [ ] **T001** `[api] [P]` Add `User.uiLocale`, `MediaSource.errorKey`/`errorParams` and
      `ProcessJob.errorKey`/`errorParams` to `prisma/schema.prisma` and generate the migration via
      `bin/npm api run prisma:migrate`. No backfill (NFR-2).
      *Done when:* `bin/cli api npx prisma migrate status` reports no pending migration, and
      `git status services/api/prisma/` shows both a modified `schema.prisma` and one new migration
      directory containing only `ADD COLUMN` statements.
- [ ] **T002** `[api] [P]` Write `src/i18n/locales.ts` (`SUPPORTED_LOCALES`, `DEFAULT_LOCALE`),
      `src/i18n/error-keys.ts` and `src/i18n/messages.en.ts`, transcribing every key from
      `spec.md`'s error tables.
      *Done when:* every key in `spec.md`'s tables that `api` owns exists as a constant with an
      English message, and `bin/cli api npx --no tsc --noEmit` reports 0 errors.
- [ ] **T003** `[api]` Write `src/i18n/i18n-error.ts` — one factory per Nest exception type used in
      the spec tables, each returning a **real** Nest exception whose response body is
      `{ message, i18n: { key, params } }`. → T002
      *Done when:* `i18nError.notFound(ERROR_KEYS.MOVIE_NOT_FOUND, { id: 1 })` returns a
      `NotFoundException` whose `getResponse()` carries both the English message and the `i18n`
      object.
- [ ] **T004** `[api]` Write `src/i18n/graphql-error.formatter.ts`, wire it into the existing
      `GraphQLModule.forRoot` in `src/app.module.ts:28-41`, and cover it with
      `src/i18n/graphql-error.formatter.spec.ts` and `src/i18n/messages.en.spec.ts`. → T003
      *Done when:* a keyed error queried in the playground returns `extensions.i18n.key`; an
      unexpected 500 passes through **without** an invented key; both new suites pass under
      `bin/npm api test`.

### Group 2 — Schema surface (`api`)

The three contract-producing tasks every consumer waits on.

- [ ] **T005** `[api]` Add `uiLocale` to `User` entity and the `me` selection; add
      `Query.supportedLocales` (derived from `SUPPORTED_LOCALES`, never a literal array) and
      `Mutation.setUiLocale`, refusing an unsupported locale with `error.user.unsupported_locale`.
      Extend `src/users/users.service.spec.ts`. → T001, T003
      *Done when:* `setUiLocale("es")` stores it and `me { uiLocale }` returns `"es"`;
      `setUiLocale("kl")` is refused **and** a follow-up `me { uiLocale }` shows the previous value
      unchanged (AC-6); `supportedLocales` returns the list.
- [ ] **T006** `[api] [P]` Expose `errorKey`/`errorParams` on
      `src/media-sources/entities/media-source.entity.ts`. Do **not** expose the `ProcessJob`
      equivalents. → T001
      *Done when:* `schema.gql` shows the two fields on `MediaSource` and none on `ProcessJob`.
- [ ] **T007** `[api] [P]` Change `encodeFailed` to
      `(processJobId: Int!, errorKey: String!, errorParams: String, errorMessage: String!)` and
      persist all three onto `ProcessJob`. → T001, T003
      *Done when:* `schema.gql` shows the new arity and a call writes all three columns.

### Group 3 — Error migration (`api`)

All depend on T003. T008 first and alone: it carries the highest risk in the feature.

- [ ] **T008** `[api]` Key the five auth throw sites (`auth.resolver.ts`, `auth.service.ts`,
      `guards/admin.guard.ts`, `guards/jwt-auth.guard.ts`, `strategies/jwt.strategy.ts`), rewrite
      the frozen-contract comments at `jwt-auth.guard.ts:50-56` and `auth.resolver.ts:56-62` to name
      the **keys** instead of the Spanish sentences, and add
      `src/auth/test/auth-error-keys.spec.ts`. → T003
      *Done when:* every auth throw site emits `error.auth.unauthenticated` or
      `error.auth.session_expired`, and the new spec **fails** when a key is removed from any one of
      them.
- [ ] **T009** `[api] [P]` Key the throw sites in `users`, `movies`, `shows`, `seasons`, `episodes`
      and `media/media-dispatch.service.ts`, collapsing the six `Ese magnet ya está asociado a «…»`
      sites onto `error.magnet.already_attached` with a `title` param. → T003
      *Done when:* `query { movie(id: 999999) }` returns `extensions.i18n.key =
      "error.movie.not_found"` with `params.id = 999999` and an English `message` (AC-4).
- [ ] **T010** `[api] [P]` Key the throw sites in `media-roots`, `media-sources`, `process-jobs`,
      `settings`, `languages`, `clients/torrent/magnet.ts`, `clients/indexer` and
      `clients/media-server`. The three `magnet.ts` errors must carry their key through the
      `BadRequestException(err.message)` re-wrapping at `movies.service.ts:262`,
      `episodes.service.ts:42` and `seasons.service.ts:38` instead of flattening to a string. → T003
      *Done when:* posting a non-magnet string to `addMagnetToMovie` returns
      `error.magnet.not_a_magnet`, not a re-wrapped sentence.
- [ ] **T011** `[api] [P]` Move the eight `class-validator` constraint messages to keys and extend
      `main.ts`'s `exceptionFactory` to carry them, preserving the flattening documented at
      `main.ts:40-51`. → T003
      *Done when:* `login` with an empty username returns a `BadRequestException` with both a key
      and a plain-string English `message`.
- [ ] **T012** `[api]` Write `errorKey`/`errorParams` alongside `errorMessage` wherever `api`
      populates `MediaSource.errorMessage` (`episodes.service.ts`, `seasons.service.ts`,
      `media-sources.service.ts`, `downloads.service.ts`), and clear the two new columns everywhere
      `errorMessage` is currently cleared to null. → T006
      *Done when:* a forced replacement writes `error.source.replaced` with an English message; a
      pre-existing row with a null `errorKey` still returns its stored Spanish text (AC-11); no row
      exists with a non-null `errorKey` and a null `errorMessage`.
- [ ] **T013** `[api]` Give `UploadHttpError` the key/params pair, serialize `{ message, i18n }` in
      the REST error body, and **replace the string comparison at `uploads.service.ts:122-123`**
      with a typed or keyed check against what `upload-tickets.service.ts` throws. → T003
      *Done when:* an expired ticket returns HTTP 401 with `i18n.key =
      "error.upload.ticket_expired"` in the body, and no `Error.message` string comparison remains
      in `src/uploads/`.
- [ ] **T014** `[api] [P]` Rewrite `src/languages/language-names.ts` in English and drop the
      `localeCompare(…, 'es')` at `languages.service.ts:31`. → T002
      *Done when:* `query { languages { iso2 name } }` returns English names in a stable order.
- [ ] **T015** `[api]` Update `src/media-roots/media-roots.service.spec.ts` and
      `src/clients/torrent/magnet.spec.ts`, which assert on Spanish message text today, to assert on
      keys. Keep their header comments — the class of bug they defend against is unchanged.
      → T009, T010
      *Done when:* `bin/npm api test` is green with no assertion on a Spanish string anywhere in
      `services/api/src`.

### Group 4 — Consumers

Everything here depends on Group 2: the contract must **exist**, not merely be agreed. `web` and
`worker` share no file and may run fully in parallel with each other.

#### `web`

- [ ] **T016** `[web]` Install `next-intl`, `negotiator` and `@formatjs/intl-localematcher` via
      `bin/npm web install`, and wrap `next.config.ts` in `createNextIntlPlugin`, preserving
      `reactCompiler`, `output: 'standalone'`, `images` and `allowedDevOrigins`.
      *Done when:* `bin/npm web run build` still exits 0 with the plugin wired and no other change.
- [ ] **T017** `[web]` Write `src/i18n/locales.ts` and `src/i18n/negotiate.ts` — language-range
      matching, so `es-AR`, `es-419` and `es` all resolve to `es` and an all-unsupported header
      falls to `en`. → T016
      *Done when:* the negotiator maps `es-AR,es;q=0.9` → `es` and `fr-FR` → `en`.
- [ ] **T018** `[web]` Extract a non-redirecting, `cache()`-wrapped `getCurrentUserOrNull()` in
      `src/actions/auth.ts`, add `uiLocale` to `ME_QUERY`, and leave `getCurrentUser()`'s existing
      redirect behaviour intact for its current callers. → T005
      *Done when:* `getCurrentUserOrNull()` returns `null` on an auth error instead of redirecting,
      and one `/dashboard` render issues exactly **one** `me` request.
- [ ] **T019** `[web]` Write `src/i18n/request.ts` implementing REQ-1's order: user row → header →
      `en`. → T017, T018
      *Done when:* the resolver returns the user's locale when set, the negotiated header locale
      when not, and `en` for an unauthenticated request with an unsupported header — **without
      redirecting**.
- [ ] **T020** `[web]` Make `src/app/layout.tsx` async: resolve the locale, set `<html lang>`, wrap
      the tree in `NextIntlClientProvider` with the server-loaded catalog. Seed
      `messages/en.json` + `messages/es.json` with a handful of keys to prove the path. → T019
      *Done when:* `bin/npm web run build` exits 0, `/` and `/login` load anonymously with **no
      redirect loop**, and `<html lang>` reflects the resolved locale. None of
      `016-web-build-errors`'s banned escape hatches appear (`ignoreBuildErrors`,
      `dynamic = "force-dynamic"` added to dodge prerender, compiler suppression).
- [ ] **T021** `[web]` Write `src/lib/graphql-error.ts`: read `extensions.i18n.key`, `JSON.parse`
      `params`, translate; fall back to the English `message`; never render a bare key. → T020
      *Done when:* a known key renders translated, an unknown key renders the English `message`, and
      no input produces a raw `error.*` string on screen.
- [ ] **T022** `[web]` Migrate `src/lib/auth-session.ts` to match `error.auth.unauthenticated` and
      `error.auth.session_expired` off `extensions.i18n.key`; delete `SESSION_ERROR_MESSAGES`.
      → T021, T008
      *Done when:* a signed-in user disabled from another browser lands on `/login` with the auth
      cookie deleted, in **both** locales (AC-5), and no Spanish literal remains in the file.
- [ ] **T023** `[web]` Rewrite the twelve `src/actions/*.ts` to derive error strings through
      `graphql-error.ts`, keeping the documented server-action shape. Update — do not delete — the
      passthrough comments at `users.ts:76-77,112-113,152-154`. → T021
      *Done when:* a duplicate-username create shows the API's reason in the active locale, and no
      `errors[0]?.message || "…"` Spanish fallback remains in `src/actions/`.
- [ ] **T024** `[web] [P]` Add `src/actions/locale.ts` with `setUiLocaleAction`, copying
      `src/actions/media-server.ts`'s shape. No UI calls it yet — that is expected. → T005
      *Done when:* the action returns `{ success: true }` for a supported locale and surfaces
      `error.user.unsupported_locale` translated for an unsupported one.
- [ ] **T025** `[web] [P]` Extract every literal in `src/app/**`, `src/layout/**` and
      `src/components/header/**` into both catalogs — the landing page, both `not-found.tsx`, every
      `metadata.title`, the `AppSidebar` nav, `UserDropdown`, every `PageBreadcrumb pageTitle` —
      and delete the two TailAdmin boilerplate titles on `/movies/add` and `/shows/add`. → T020
      *Done when:* no user-facing literal remains in those directories and both catalogs carry
      every new key.
- [ ] **T026** `[web] [P]` Extract every literal in `src/components/**` (search, import, settings,
      users, movies, shows, media) into both catalogs, keeping the Rioplatense register in `es`
      (REQ-6). → T020
      *Done when:* a search for Spanish copy under `src/components` returns nothing outside the
      catalogs (AC-9).
- [ ] **T027** `[web]` Render language names with `Intl.DisplayNames(activeLocale)`, sort with
      `localeCompare(activeLocale)`, and pass the active locale to `toLocaleDateString()` in
      `SeasonAccordion.tsx:54`. → T026, T014
      *Done when:* `/settings` shows `Español`/`Inglés` in Spanish and `Spanish`/`English` in
      English, with **no** language names in either catalog.
- [ ] **T028** `[web]` Read `i18n.key` off the REST error body from `/uploads` in
      `src/components/import/importFileModal.tsx`. → T013, T021
      *Done when:* an expired upload ticket shows a translated message in the modal, not English
      text on a Spanish UI.
- [ ] **T029** `[web]` Write `scripts/check-messages.mjs` — exit non-zero listing any key present in
      one catalog and absent from the other. It is a script, **not** a test framework (NFR-6).
      → T025, T026
      *Done when:* `bin/cli web node scripts/check-messages.mjs` exits 0 on the finished catalogs
      and exits non-zero when a key is deleted from `es.json`.

#### `worker`

- [ ] **T030** `[worker] [P]` Write `src/i18n/error-keys.ts`, `src/i18n/messages.en.ts` and
      `src/i18n/keyed-error.ts` (an `Error` subclass carrying `key` and `params`), transcribing the
      worker's keys from `spec.md`. Keys owned by `api` must be spelled identically.
      *Done when:* `bin/cli worker npx --no tsc --noEmit` reports 0 errors and every key in
      `spec.md`'s worker table exists with an English message.
- [ ] **T031** `[worker] [P]` Convert the throw sites in `ffmpeg/params.ts`, `ffmpeg/metadata.ts`,
      `ffmpeg/runner.ts`, `paths/build-output-path.ts`, `encode/index.ts` and
      `jobs/source-ready.job.ts` to `KeyedError`. `stderr`, exit `code`, `filePath` and `iso3`
      become **params**, never parts of a formatted sentence. → T030
      *Done when:* no Spanish string remains in those files and `bin/npm worker test` is green.
- [ ] **T032** `[worker]` Change `src/api/graphql-client.ts:50` to propagate an incoming
      `extensions.i18n` onto the thrown error instead of `JSON.stringify`-ing the error array. Leave
      the three infrastructure errors unkeyed and English. → T030
      *Done when:* an `api` error surfaced through the worker carries its original key rather than a
      JSON blob.
- [ ] **T033** `[worker]` Rewrite `src/jobs/encode.job.ts:139-144` for the four-argument
      `encodeFailed`, reading `key`/`params` off a `KeyedError` and falling back to a catch-all key
      carrying the raw message as a param for an unexpected throw. Extend
      `src/jobs/encode.job.spec.ts` and add `src/i18n/messages.en.spec.ts`. → T007, T031, T032
      *Done when:* a failed encode writes `errorKey` and an English `errorMessage` — verified with
      `bin/mysql -e 'select id, errorKey, errorMessage from process_jobs order by id desc limit 1'`
      (AC-7) — a failure **never** reports without a key, and the spec fails when `errorKey` is
      dropped from the call.

### Group 5 — Verification and docs

- [ ] **T034** `[docs]` Add an `018-ui-i18n` section to `docs/spec/graphql-contract.md`: the schema
      delta, the `extensions.i18n` envelope, and the full error-key vocabulary — the authoritative
      list, since no automated check can span the two services (`plan.md` § Risks).
- [ ] **T035** `[docs]` Update the root `CLAUDE.md` (Conventions — user-facing copy is no longer
      "Spanish", it is catalog-driven; the Current-state test counts) and
      `services/{api,web,worker}/CLAUDE.md` (the new `src/i18n/` modules, the keyed-error
      convention, and the removal of the `auth-session.ts` string coupling). No pipeline stage
      changes status.
- [ ] **T036** `[docs]` Walk all twelve acceptance criteria in `spec.md` — including the AC-8
      N-locale experiment (add `messages/pt.json` plus one registry entry, confirm
      `supportedLocales`, `setUiLocale("pt")` and a Portuguese render with `git status` showing
      exactly one new and one modified file, then revert) — tick each box, and set
      `status: Implemented` on `spec.md`, `plan.md` and all three `<svc>/plan.md`. → T033, T029

## Blocked

| Task | Service | What blocked it | Needs |
| :-- | :-- | :-- | :-- |

Contract problems always land here (Constitution, Article VIII): an agent that finds the GraphQL
delta wrong stops and reports, it does not amend the delta from inside its slice.
