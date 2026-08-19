---
title: UI Internationalization — api slice
service: api
last_updated: 2026-08-19
status: Approved
---

# PLAN: UI Internationalization — `api` (`api/plan.md`)

## Scope

`api` owns the migration, the schema surface and the **key vocabulary** the whole system translates
against. It stops returning Spanish prose and starts returning a key plus its parameters, with an
English sentence alongside as the fallback. It also gains the locale column, the query that lists
supported locales, and the mutation that writes one.

`api` does **not** translate anything into Spanish, and it does not ship an `es` catalog. Rendering
a key in the user's language is `web`'s job — `api` only ever produces English. `api` also does not
build any UI and does not touch `worker`'s own key list.

Writes are confined to `services/api/` and this directory. Anything else is a stop-and-report.

## Files

| File | New / Modified | What changes |
| :-- | :-- | :-- |
| `services/api/prisma/schema.prisma` | Modified | `User.uiLocale`, `MediaSource.errorKey`/`errorParams`, `ProcessJob.errorKey`/`errorParams` |
| `services/api/prisma/migrations/…_add_ui_locale_and_error_keys/` | New | The five `ADD COLUMN`s, no backfill |
| `services/api/src/i18n/locales.ts` | New | `SUPPORTED_LOCALES` and `DEFAULT_LOCALE` — the single list REQ-17/REQ-18/REQ-19 all read |
| `services/api/src/i18n/error-keys.ts` | New | Every key from `../spec.md`'s error tables, as constants |
| `services/api/src/i18n/messages.en.ts` | New | key → English template, the `message` REQ-8 requires |
| `services/api/src/i18n/i18n-error.ts` | New | Factories that build a Nest exception carrying `{ message, i18n }` |
| `services/api/src/i18n/graphql-error.formatter.ts` | New | `formatError` that lifts `i18n` into `extensions` |
| `services/api/src/app.module.ts` | Modified | Wire `formatError` into the existing `GraphQLModule.forRoot` |
| `services/api/src/main.ts` | Modified | `ValidationPipe`'s `exceptionFactory` carries keys (REQ-9) |
| `services/api/src/users/entities/user.entity.ts` | Modified | `uiLocale` field |
| `services/api/src/users/users.service.ts` | Modified | `setUiLocale`, validated against `SUPPORTED_LOCALES` |
| `services/api/src/auth/auth.resolver.ts` | Modified | `setUiLocale` mutation, `supportedLocales` query, `me` returns `uiLocale` |
| `services/api/src/media-sources/entities/media-source.entity.ts` | Modified | `errorKey`/`errorParams` fields |
| `services/api/src/process-jobs/process-jobs.resolver.ts` | Modified | `encodeFailed` new arity |
| `services/api/src/languages/language-names.ts` | Modified | English names; display authority moves to `web` (REQ-13) |
| `services/api/src/uploads/uploads.service.ts` | Modified | `UploadHttpError` carries key/params; internal string-matching removed |
| ~20 service/resolver files across all modules | Modified | The 64 throw sites, keyed |
| `services/api/src/**/dto/*.input.ts` | Modified | The 8 `class-validator` messages become keys |

A **new Nest module** that is not in this table means the plan missed something — report it rather
than inventing one.

## Existing code to reuse

- **`GraphQLModule.forRoot` in `src/app.module.ts:28-41`** — has no `formatError` and no `plugins`
  today. Add the hook there; do not add a second `GraphQLModule` and do not add a global
  `ExceptionFilter` (there are none in this service, and one would compete with `formatError` for
  the same job).
- **`main.ts:52-62`'s `exceptionFactory`** — already flattens `ValidationError[]` to one
  `BadRequestException` with a plain string, precisely so `web` can read `errors[0].message`. Extend
  it to also carry the key; do not replace the flattening, and do not revert to Nest's default —
  the comment at `main.ts:40-51` explains what that would break.
- **`HttpException`'s object response body** — Nest already supports
  `new NotFoundException({ message, i18n })`. This is the transport. Do not invent a custom
  exception hierarchy parallel to Nest's; the factories in `i18n-error.ts` return **real** Nest
  exceptions so every existing `catch`, guard and status mapping keeps working.
- **`AdminGuard` / `JwtAuthGuard` / `jwt.strategy.ts`** — the five auth throw sites. The frozen-
  contract comments at `src/auth/guards/jwt-auth.guard.ts:50-56` and `auth.resolver.ts:56-62` name
  the Spanish sentences; rewrite them to name the two **keys** instead. Leaving those comments
  pointing at strings is how the next feature reintroduces the coupling.
- **`UsersService`'s validate-then-write shape** (`src/users/users.service.ts`) and
  `LanguagesService`'s "validate every value against a known set before writing" pattern
  (`src/languages/languages.service.ts:40-55`) — `setUiLocale` is the same shape against
  `SUPPORTED_LOCALES`. Do not write a new validation idiom.
- **`SettingsService`** — `uiLocale` is **not** a setting. `Setting` is global key/value config with
  an `EDITABLE_KEYS` allowlist; a per-user preference has no key behind it. Follow the precedent
  `011-av1-transcode` set with `setPreferredLanguages`: its own mutation on the user, not a
  `SETTINGS_CATALOG` entry.
- **`Language` / `UserLanguage`** — audio/subtitle preference for the encoder. Unrelated to
  `uiLocale`. Do not merge, rename or reuse them for the interface language.

## Steps

1. Add the five columns to `schema.prisma` and generate the migration through
   `bin/npm api run prisma:migrate`. No backfill. Verify `git status services/api/prisma/` shows
   both a modified schema and a new migration directory (Article III).
2. Write `src/i18n/locales.ts`, `error-keys.ts` and `messages.en.ts` from `../spec.md`'s error
   tables. This is the vocabulary; everything after it depends on it existing.
3. Write `src/i18n/i18n-error.ts` — one factory per Nest exception type used in the spec tables
   (`notFound`, `badRequest`, `conflict`, `unauthorized`, `forbidden`, `serviceUnavailable`), each
   taking a key and optional params, rendering the English message from `messages.en.ts`.
4. Write `src/i18n/graphql-error.formatter.ts` and wire it into `app.module.ts`. Verify by hand in
   the playground that a keyed error arrives with `extensions.i18n` **before** rewriting 64 call
   sites — a formatter bug found after the rewrite is indistinguishable from a call-site bug.
5. Extend `main.ts`'s `exceptionFactory` and move the eight DTO constraint messages to keys (REQ-9).
6. Rewrite the auth throw sites first (five sites, `auth/`), since REQ-14 depends on them and they
   carry the highest risk. Update the two frozen-contract comments.
7. Rewrite the remaining throw sites module by module: `users`, `movies`, `shows`, `seasons`,
   `episodes`, `media-roots`, `media-sources`, `process-jobs`, `settings`, `languages`, `media`,
   `clients/torrent/magnet.ts`, `clients/indexer`, `clients/media-server`. Collapse the six
   `Ese magnet ya está asociado a «…»` sites onto the single `error.magnet.already_attached` key
   with a `title` param, per `../spec.md`.
8. Key the strings `api` **writes into** `MediaSource.errorMessage` (`error.source.replaced`,
   `error.source.scan_no_video`, `error.source.no_download_path`) — write `errorKey`/`errorParams`
   alongside the existing English `errorMessage`, in `episodes.service.ts`, `seasons.service.ts`,
   `media-sources.service.ts` and `downloads.service.ts`. Every place that currently clears
   `errorMessage` to `null` must clear the two new columns too, or a stale key outlives its message.
9. `uploads`: give `UploadHttpError` the key/params pair and serialize `{ message, i18n }` in the
   REST error body (REQ-10). **Replace the string comparison at `uploads.service.ts:122-123`** with
   a key or typed check against what `upload-tickets.service.ts` throws.
10. Change `encodeFailed`'s signature to `(processJobId, errorKey, errorParams, errorMessage)` and
    persist all three onto `ProcessJob`.
11. Add `User.uiLocale` to the entity, the `me` selection, `setUiLocale` and `supportedLocales`.
12. `language-names.ts` → English, and drop the `localeCompare(…, 'es')` at
    `languages.service.ts:31` (REQ-13); ordering for display is `web`'s call now.

## Contract obligations

Exactly the SDL and error tables in `../spec.md` § GraphQL Contract Delta — that document is
read-only here. Specifically, `api` must expose:

- `User.uiLocale: String` (nullable), selectable through `me`.
- `Query.supportedLocales: [String!]!`, derived from `SUPPORTED_LOCALES` — not a literal array in
  the resolver (REQ-17).
- `Mutation.setUiLocale(locale: String!): User!`, refusing an unsupported locale with
  `error.user.unsupported_locale` (REQ-19).
- `Mutation.encodeFailed(processJobId: Int!, errorKey: String!, errorParams: String, errorMessage:
  String!): Boolean!`.
- `MediaSource.errorKey: String` and `MediaSource.errorParams: String`.
- `extensions.i18n = { key, params? }` on **every** error in the spec's tables, with an English
  `message` beside it.

`ProcessJob.errorKey`/`errorParams` are persisted and **not** exposed. `errorParams` is a JSON
object encoded as a `String` — not a JSON scalar, and not a typed object. If any of this looks
wrong, stop and report; do not adapt it locally (Article VIII).

`schema.gql` will regenerate on boot. It may appear in the diff as an artifact, never as an
authored edit (Article IV).

## Tests

Article IX: tests are owed where a bug produces no error anywhere. Three units qualify, and one of
them is the highest-risk item in the whole feature.

- **`src/auth/test/auth-error-keys.spec.ts`** (new) — defends against the silent death of session
  invalidation. If any of the five auth throw sites ships without `error.auth.unauthenticated` or
  `error.auth.session_expired`, `web`'s `auth-session.ts` stops recognising an expired session: the
  cookie is never deleted, `proxy.ts` bounces the user back, and nothing is logged. Assert every one
  of those sites emits one of the two keys, and verify the test fails when a key is removed.
- **`src/i18n/messages.en.spec.ts`** (new) — defends against a key with no English rendering. The
  fallback REQ-8 relies on is the only thing standing between a `web` catalog gap and a raw
  `error.movie.not_found` on a user's screen; a key missing from `messages.en.ts` renders as
  `undefined` with no error. Assert every constant in `error-keys.ts` has a message, and that every
  message's interpolation placeholders are supplied by the sites that throw it.
- **`src/i18n/graphql-error.formatter.spec.ts`** (new) — defends against `i18n` being dropped between
  the thrown exception and the wire. If `formatError` fails to lift it, every consumer silently falls
  back to English forever and the feature looks like it works in development, where the developer's
  browser is probably English anyway. Assert the extension survives for each exception type, and
  that a non-keyed error (an unexpected 500) passes through without inventing one.

Extend, do not duplicate:

- `src/users/users.service.spec.ts` — add the `setUiLocale` cases (accepted locale stored; an
  unsupported one refused **and** the previous value left unchanged, per AC-6).
- `src/media-roots/media-roots.service.spec.ts` and `src/clients/torrent/magnet.spec.ts` — these
  assert on Spanish message text today. Update them to assert on keys. Their header comments already
  state the class of bug they defend against; that does not change.

**Not owed a test**: the throw-site rewrites themselves. A wrong key on a `NotFoundException` shows
the wrong English sentence to the user immediately — loud, not silent — and sixty-four assertions
that a constant equals itself is the scaffolding pattern Article IX bans.

## Done when

```bash
bin/cli api npx --no tsc --noEmit
bin/npm api test
bin/cli api npx prisma migrate status
```

Typecheck reports **0 errors**. The suite is green and larger than the 156/16 baseline recorded in
the root `CLAUDE.md` by the three new suites above. `migrate status` reports no pending migration.
Report the before/after test counts — that number is the proof the slice added nothing broken.
