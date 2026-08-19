---
title: UI Internationalization
spec_version: 0.1.0
author: Juan Farias
created_at: 2026-08-19
last_updated: 2026-08-19
status: Approved
services: [api, web, worker]
---

# SPEC: UI Internationalization (`spec.md`)

## Context & Goal

Every string Perceptor shows a user is a Spanish literal hardcoded wherever it happens to be
rendered. In `services/web` that is roughly forty files: all twelve server actions in
`src/actions/`, about eighteen components, the landing page, both `not-found.tsx` boundaries and
`src/lib/graphql-client.ts`. In `services/api` it is sixty-four `HttpException` throw sites carrying
about forty-three distinct message templates, ten more on the REST `/uploads` endpoint, eight
`class-validator` constraint messages, and a hardcoded twenty-entry `LANGUAGE_NAMES` map that the
`languages` query serves as its `name` field. In `services/worker` it is sixteen error strings that
travel back through `encodeFailed` and get persisted verbatim into `ProcessJob.errorMessage`. There
is no i18n library anywhere, no locale column on `User`, and `src/app/layout.tsx` hardcodes
`<html lang="en">` on a Spanish application.

The application runs on the user's own LAN and is never exposed to the internet, so none of the
usual reasons to put a locale in the URL apply — there is nothing to index, nothing to share, and
no SEO. The locale therefore belongs to the user, not to the address bar, and it is read from a
column on `User` rather than negotiated per-navigation. Text must arrive already translated from the
server render: a client that fetched its own catalog would repaint every label after hydration on
every navigation, which is the exact regression `007-library-listing` removed from the library
listings when it turned them from client fetches into Server Components.

The hard part is not `web`. It is the seam. `api` returns rendered Spanish sentences and `web` shows
them verbatim — the server-action pattern in `services/web/CLAUDE.md` reads `errors[0].message`
straight onto the screen, and three call sites in `src/actions/users.ts` carry comments saying that
passthrough is deliberate. Worse, `src/lib/auth-session.ts:6` compares that message against the
literal strings `'No autenticado'` and `'Tu sesión expiró, iniciá sesión de nuevo'` to decide whether
to delete the session cookie and redirect to `/login`. Translating `api`'s messages without first
introducing a stable, language-independent identifier does not produce a mixed-language UI — it
silently breaks session invalidation, on a path that only runs when a session actually expires. So
`api` and `worker` stop shipping prose and start shipping **keys**: `error.movie.not_found` plus the
parameters it interpolates, carried in the GraphQL error's `extensions`, with an English `message`
alongside it for logs and for any consumer that has not been migrated.

Once this ships, a user whose row says `es` sees Perceptor in Spanish and a user whose row says `en`
sees it in English, at the same URLs, with no flash of the wrong language, and an error raised three
services away renders in whichever of the two they chose. No pipeline stage in the root `CLAUDE.md`
changes status: this feature adds no stage and moves no stage forward. It changes how every stage
talks to the person watching it.

## Requirements

### Functional Requirements

- [ ] **REQ-1 (Locale Resolution)**: The active locale must be resolved per request, on the server,
      in exactly this order: (1) the authenticated user's `uiLocale`, if set; (2) the request's
      `Accept-Language` header, negotiated against the supported set; (3) `en`. A request with no
      authenticated user (the landing page, `/login`) starts at step 2.

- [ ] **REQ-2 (Language-Range Negotiation)**: `Accept-Language` must be matched by language range,
      not by exact tag — `es-AR`, `es-419` and `es` all resolve to `es`. A header naming only
      unsupported languages falls through to `en`.

- [ ] **REQ-3 (Server-Rendered Text)**: Every translated string must be produced during the server
      render of the page that shows it. No component may fetch, import or lazily load a translation
      catalog from the browser, and no text may change after hydration.

- [ ] **REQ-4 (URLs Are Not Localized)**: No locale segment, path prefix, query parameter, cookie
      redirect or rewrite may be introduced. Every route keeps its exact current shape, including
      the `AUTH_ROUTES` and `PUBLIC_ROUTES` lists in `services/web/src/proxy.ts`. Two users on
      different locales looking at the same film must be looking at byte-identical URLs.

- [ ] **REQ-5 (No Literals in `web`)**: Every user-facing string rendered by `services/web/src` must
      come from a message catalog. This includes the strings that are currently **English** and were
      never translated — the sidebar entries in `src/layout/AppSidebar.tsx`, the three items in
      `src/components/header/UserDropdown.tsx`, every `PageBreadcrumb pageTitle`, and every
      `metadata.title` — as well as the two TailAdmin boilerplate titles still on `/movies/add` and
      `/shows/add`. Log output, code comments and identifiers stay English and are not catalog
      entries (Constitution, Article VI).

- [ ] **REQ-6 (Spanish Register Is Preserved)**: The `es` catalog carries the existing Rioplatense
      copy unchanged (`Intentá`, `No podés`, `Confirmá`). This feature relocates the existing
      Spanish; it does not rewrite it.

- [ ] **REQ-7 (API Errors Carry Keys)**: Every user-facing error `api` returns over GraphQL must
      carry `extensions.i18n.key` and, when the sentence interpolates anything, the values it
      interpolates. The key set is frozen in the GraphQL Contract Delta below.

- [ ] **REQ-8 (API Messages Become English)**: The `message` on those same errors must be the
      English rendering of the key. It is the fallback a consumer shows when it does not recognise
      the key, and it is what appears in `api`'s own logs.

- [ ] **REQ-9 (Validation Errors Carry Keys)**: The eight `class-validator` constraint messages must
      travel the same way. The `exceptionFactory` in `services/api/src/main.ts` currently flattens a
      `ValidationError[]` to one plain string; whatever it produces must still expose a key.

- [ ] **REQ-10 (Upload Errors Carry Keys)**: The REST `/uploads` endpoint's error responses must
      carry the same `{ key, params }` pair in their body, and the upload modal must render it
      translated. This is the one non-GraphQL surface a user sees text from (Constitution,
      Article II's single exception).

- [ ] **REQ-11 (Worker Errors Carry Keys)**: `worker` must report failures as a key plus parameters
      rather than a rendered sentence. An `ffmpeg` or `mkvmerge` stderr tail is **data**, not prose —
      it travels as a parameter of a key, not as the message itself.

- [ ] **REQ-12 (Persisted Errors Are Keyed)**: `MediaSource` and `ProcessJob` must store the key and
      its parameters alongside the existing `errorMessage` column, so a row written today can be
      rendered in either language tomorrow.

- [ ] **REQ-13 (Language Names)**: The `languages` query's `name` field must become English, and
      `web` must render language names for the active locale using the platform's
      `Intl.DisplayNames`, not a per-locale table duplicated in every catalog. The sort in
      `services/api/src/languages/languages.service.ts:31` must stop being `localeCompare(…, 'es')`;
      ordering for display belongs to whoever knows the locale.

- [ ] **REQ-14 (Auth Detection by Key)**: `services/web/src/lib/auth-session.ts` must decide whether
      an error is an authentication failure by inspecting `extensions.i18n.key`, never by comparing
      message text. This is the single most likely regression in the feature and it is silent when
      it breaks.

- [ ] **REQ-15 (Dates and Numbers)**: Any locale-sensitive formatting must take the active locale
      explicitly. The known instance is `new Date(...).toLocaleDateString()` in
      `services/web/src/components/shows/SeasonAccordion.tsx:54`, which today follows the container's
      default.

- [ ] **REQ-16 (`html lang`)**: The `lang` attribute on `<html>` must reflect the resolved locale
      rather than the hardcoded `"en"` at `services/web/src/app/layout.tsx:16`.

- [ ] **REQ-17 (N Locales, Not Two)**: The supported set must be **data, not code**. Adding a locale
      must cost its catalog file in `web` plus one entry in the single list `api` validates against —
      nothing else. There may be no `if (locale === 'es')` branch anywhere, no per-locale conditional
      in a component, and no locale literal in a resolver, a guard or `proxy.ts`. `en` keeps exactly
      one special property: it is the fallback.

- [ ] **REQ-18 (Supported Set Is Discoverable)**: `api` must expose the supported locales as a query,
      so the picker this feature deliberately does not build has a list to read and does not
      hardcode one.

- [ ] **REQ-19 (Unsupported Locale Refused)**: `setUiLocale` with a locale outside the supported set
      must be refused with its own keyed error, not stored. A stored locale that has no catalog is
      indistinguishable at render time from a bug in the resolver.

### Non-Functional & Operational Requirements

- [ ] **NFR-1 (Catalog Completeness)**: The `en` and `es` catalogs must both be complete. A key
      present in one and missing from the other must be detectable by running a command, not by a
      user finding a raw `error.movie.not_found` on screen. `en` is the fallback, so a gap there is
      unrecoverable.

- [ ] **NFR-2 (Additive Migration, No Backfill)**: The migration is `ADD COLUMN` only. `uiLocale` is
      nullable with no default and **no backfill** — every existing user resolves through
      `Accept-Language`. Consequence, accepted deliberately: on an existing install, a user whose
      browser is set to English will see Perceptor in English after this upgrade, where they saw
      Spanish before. They fix it by setting their locale, once the picker exists.

- [ ] **NFR-3 (Old Rows Still Render)**: A `MediaSource` or `ProcessJob` row written before this
      feature has a Spanish `errorMessage` and no key. It must keep rendering that stored text
      rather than rendering nothing or rendering a key.

- [ ] **NFR-4 (No Second REST Route)**: The locale must not become a REST endpoint. `/uploads` stays
      the only one (Constitution, Article II).

- [ ] **NFR-5 (Build Stays Green)**: `bin/npm web run build` must still exit 0 and
      `bin/cli api npx --no tsc --noEmit` must still report 0 errors. `016-web-build-errors` closed
      both and the banned escape hatches it listed stay banned — no `ignoreBuildErrors`, no
      `force-dynamic` added to dodge a prerender failure, no compiler suppression.

- [ ] **NFR-6 (No Test Toolchain in `web`)**: `services/web` still has no test runner and this
      feature does not add one. Introducing Vitest or Playwright there is its own decision
      (`services/web/CLAUDE.md`).

## GraphQL Contract Delta

Frozen once `status: Approved` (Constitution, Article VIII). `web` and `worker` retype all of this by
hand and no codegen checks it.

### Schema

```graphql
type User {
  """BCP-47 language tag. Null means unset — resolve from Accept-Language, then "en"."""
  uiLocale: String
}

type MediaSource {
  """Translation key for the failure, e.g. "error.source.scan_no_video". Null on rows written before 018."""
  errorKey: String
  """Interpolation values for errorKey, a JSON object encoded as a string. Null when the key takes none."""
  errorParams: String
}

type Query {
  """Every locale with a catalog. The list setUiLocale validates against."""
  supportedLocales: [String!]!
}

type Mutation {
  setUiLocale(locale: String!): User!

  encodeFailed(
    processJobId: Int!
    errorKey: String!
    errorParams: String
    errorMessage: String!
  ): Boolean!
}
```

**`errorParams` is a `String` holding a JSON object, not a JSON scalar.** The repository has no
custom GraphQL scalars today and this feature is not the place to introduce one: with no codegen
across the seam, a scalar that serializes differently on either side fails at runtime with no
compile error, which is the exact failure mode Article VIII exists to prevent. A string both sides
`JSON.parse` is honest about the fact that nothing is checking it.

**`encodeFailed` changes signature.** It is `(processJobId: Int!, errorMessage: String!): Boolean!`
today, called from `services/worker/src/jobs/encode.job.ts:139`. `errorKey` becomes required and
`errorMessage` stays required as the English rendering — `worker` is the only caller and both
services ship together, so there is no compatibility window to preserve.

`ProcessJob.errorKey` / `ProcessJob.errorParams` are stored but **not** exposed on any GraphQL type.
`ProcessJob.errorMessage` is not exposed today either, and adding surface with no consumer is how a
contract rots.

### The error envelope

Every user-facing error `api` returns gains an `extensions.i18n` object. The GraphQL error's
`message` stays present and becomes English.

```json
{
  "message": "Movie 42 does not exist",
  "extensions": {
    "code": "NOT_FOUND",
    "i18n": { "key": "error.movie.not_found", "params": { "id": 42 } }
  }
}
```

`params` is absent when the key takes no interpolation. A consumer that does not recognise a key
falls back to `message` — never to rendering the key itself.

### Error table — `auth`

| Condition | Exception | Key | Params | English `message` |
| :-- | :-- | :-- | :-- | :-- |
| No credential on a guarded operation | `UnauthorizedException` | `error.auth.unauthenticated` | — | `Not authenticated` |
| Session expired or revoked | `UnauthorizedException` | `error.auth.session_expired` | — | `Your session expired, sign in again` |
| Wrong username or password | `UnauthorizedException` | `error.auth.invalid_credentials` | — | `Invalid credentials` |
| Disabled account signing in | `UnauthorizedException` | `error.auth.account_disabled` | — | `Your account is disabled` |
| Non-admin hitting `UsersResolver` | `ForbiddenException` | `error.auth.admin_required` | — | `You do not have permission to manage users` |

`error.auth.unauthenticated` and `error.auth.session_expired` are the two keys REQ-14 makes
`auth-session.ts` match on. They are the replacement for the frozen string contract that
`002-auth-login` and `004-user-disable` established at
`services/api/src/auth/guards/jwt-auth.guard.ts:50-56`; that comment must be updated to name the
keys, not the sentences.

### Error table — `users`

| Condition | Exception | Key | Params | English `message` |
| :-- | :-- | :-- | :-- | :-- |
| Username taken | `ConflictException` | `error.user.username_taken` | — | `That username is already registered` |
| Unknown user id | `NotFoundException` | `error.user.not_found` | `id` | `User "{id}" not found` |
| Disabling yourself | `BadRequestException` | `error.user.cannot_disable_self` | — | `You cannot disable your own user` |
| Disabling the last enabled admin | `BadRequestException` | `error.user.cannot_disable_last_admin` | — | `You cannot disable the only administrator` |
| Deleting yourself | `BadRequestException` | `error.user.cannot_delete_self` | — | `You cannot delete your own user` |
| Deleting the last admin | `BadRequestException` | `error.user.cannot_delete_last_admin` | — | `You cannot delete the only administrator` |
| `setUiLocale` with an unsupported locale (REQ-19) | `BadRequestException` | `error.user.unsupported_locale` | `locale` | `Locale "{locale}" is not supported` |

### Error table — `movies`, `shows`, `seasons`, `episodes`

| Condition | Exception | Key | Params | English `message` |
| :-- | :-- | :-- | :-- | :-- |
| Film missing or not the caller's | `NotFoundException` | `error.movie.not_found` | `id` | `Movie {id} does not exist` |
| Film absent from the catalog | `NotFoundException` | `error.movie.not_in_catalog` | — | `We could not find that movie in the catalog` |
| Film already downloading, no `force` | `ConflictException` | `error.movie.download_in_progress` | — | `This movie already has a download in progress. Confirm to replace it.` |
| Series missing or not the caller's | `NotFoundException` | `error.show.not_available` | — | `Resource not available for this user` |
| Series absent from the catalog | `NotFoundException` | `error.show.not_in_catalog` | — | `We could not find that series in the catalog` |
| Unknown season id | `NotFoundException` | `error.season.not_found` | `id` | `Season {id} does not exist` |
| Season already downloading, no `force` | `ConflictException` | `error.season.download_in_progress` | — | `This season already has a download in progress. Confirm to replace it.` |
| Unknown episode id | `NotFoundException` | `error.episode.not_found` | `id` | `Episode {id} does not exist` |
| Episode already downloading, no `force` | `ConflictException` | `error.episode.download_in_progress` | — | `This episode already has a download in progress. Confirm to replace it.` |
| Magnet already attached to something else | `ConflictException` | `error.magnet.already_attached` | `title` | `That magnet is already attached to «{title}»` |
| Unsupported `type` on `searchMedia`/`addMedia` | `BadRequestException` | `error.media.unsupported_type` | `type` | `Unsupported media type: {type}` |

`error.magnet.already_attached` collapses the six near-identical `Ese magnet ya está asociado a
«…»` sites in `movies`, `seasons` and `episodes`. They differ only in how `title` is derived — the
film's `title`, `episodeDisplayTitle(...)` or `seasonDisplayTitle(...)` — which is a parameter, not
a different sentence. Those three display-title helpers are themselves user-facing string builders
and must produce their text from the catalog too.

### Error table — `magnet` parsing

These are thrown as plain `Error` in `services/api/src/clients/torrent/magnet.ts` and re-wrapped as
`BadRequestException(err.message)` at three call sites. They reach the user, so they are keyed; the
re-wrapping must carry the key through instead of flattening to a string.

| Condition | Key | Params | English `message` |
| :-- | :-- | :-- | :-- |
| Input is not a magnet link | `error.magnet.not_a_magnet` | — | `That does not look like a magnet link` |
| No decodable infoHash | `error.magnet.invalid_infohash` | — | `The magnet has no valid infoHash` |
| BitTorrent v2 magnet | `error.magnet.v2_unsupported` | — | `BitTorrent v2 magnets are not supported yet` |

### Error table — `media-roots`

| Condition | Exception | Key | Params | English `message` |
| :-- | :-- | :-- | :-- | :-- |
| Unknown root id | `NotFoundException` | `error.mediaRoot.unknown` | `rootId` | `Unknown media root: "{rootId}"` |
| Root not mounted in the container | `BadRequestException` | `error.mediaRoot.not_mounted` | `label`, `envVar` | `Root "{label}" is not mounted in this container — check {envVar} in your .env and bring the stack back up` |
| Path is not a usable string | `BadRequestException` | `error.mediaRoot.invalid_path` | — | `Invalid path` |
| Absolute path given | `ForbiddenException` | `error.mediaRoot.absolute_path` | `label`, `hostPath` | `The path for "{label}" must be relative to {hostPath}, not absolute` |
| Path escapes the root | `ForbiddenException` | `error.mediaRoot.escapes_root` | `label`, `hostPath` | `The path escapes "{label}" ({hostPath})` |
| Folder does not exist | `BadRequestException` | `error.mediaRoot.folder_not_found` | `path`, `label` | `Folder "{path}" does not exist in "{label}"` |
| Target is not a folder | `BadRequestException` | `error.mediaRoot.not_a_folder` | `path` | `"{path}" is not a folder` |

### Error table — `settings`, `languages`, `media-server`, `indexer`

| Condition | Exception | Key | Params | English `message` |
| :-- | :-- | :-- | :-- | :-- |
| Unknown or read-only setting | `BadRequestException` | `error.setting.not_editable` | `key` | `Unknown or read-only setting: "{key}"` |
| Boolean setting given a non-boolean | `BadRequestException` | `error.setting.expected_boolean` | `key` | `"{key}" must be "true" or "false"` |
| Int setting given a non-number | `BadRequestException` | `error.setting.expected_int` | `key` | `"{key}" must be a number` |
| Enum setting outside its options | `BadRequestException` | `error.setting.expected_enum` | `key`, `options` | `"{key}" must be one of: {options}` |
| Setting required by the encoder is absent | `NotFoundException` | `error.setting.missing` | `key` | `Setting "{key}" is missing — configure it in Settings before encoding` |
| Duplicate `iso2` in one preference write | `BadRequestException` | `error.language.duplicate` | `iso2` | `Language {iso2} is repeated` |
| Unknown `iso2` | `BadRequestException` | `error.language.unavailable` | `iso2` | `Language {iso2} is not available` |
| Unknown media server id | `BadRequestException` | `error.mediaServer.unknown` | `id` | `Unknown media server: "{id}"` |
| Indexer unreachable or non-success | `ServiceUnavailableException` | `error.indexer.unavailable` | `status` (optional) | `Could not reach the indexer` |
| Indexer result has no resolvable infoHash | `BadRequestException` | `error.indexer.no_infohash` | — | `Could not resolve an infoHash` |

### Error table — `media-sources`, `process-jobs`, `downloads`

These include the strings `api` **writes into** `MediaSource.errorMessage`, which under REQ-12 are
now written as `errorKey` + `errorParams` as well.

| Condition | Where it goes | Key | Params | English `message` |
| :-- | :-- | :-- | :-- | :-- |
| Unknown `mediaSource` id | `NotFoundException` | `error.source.not_found` | `id` | `Media source {id} does not exist` |
| Source targets no movie/episode/season | `BadRequestException` | `error.source.no_target` | `id` | `Media source {id} points at no movie, episode or season` |
| Reported match is not in the file list | `BadRequestException` | `error.source.match_not_reported` | `filePath` | `matchedFilePath {filePath} is not in the reported file list` |
| Scan found no video | `MediaSource.errorMessage` | `error.source.scan_no_video` | — | `Scan found no main video file: empty folder or no video` |
| Completed with no `downloadPath` | `MediaSource.errorMessage` | `error.source.no_download_path` | — | `Completed with no download path recorded — cannot enqueue` |
| Superseded by a forced replacement | `MediaSource.errorMessage` | `error.source.replaced` | — | `Replaced by a new download` |
| Unknown `processJob` id | `NotFoundException` | `error.processJob.not_found` | `id` | `Process job {id} does not exist` |

### Error table — `uploads`

Four over GraphQL:

| Condition | Exception | Key | Params | English `message` |
| :-- | :-- | :-- | :-- | :-- |
| Ticket requested with neither or both ids | `BadRequestException` | `error.upload.target_ambiguous` | — | `Provide exactly one of movieId or episodeId` |

The other three reuse `error.auth.unauthenticated`, `error.movie.not_found` and
`error.episode.not_found`.

Six over REST (`UploadHttpError`, `services/api/src/uploads/uploads.service.ts`). Their response
body gains the same pair, in the shape a plain `fetch` and `tus-js-client` can both read:

```json
{ "message": "The upload ticket expired, try again", "i18n": { "key": "error.upload.ticket_expired" } }
```

| Condition | HTTP | Key | Params | English `message` |
| :-- | :-- | :-- | :-- | :-- |
| Ticket expired or already spent | 401 | `error.upload.ticket_expired` | — | `The upload ticket expired, try again` |
| Ticket does not match this movie | 403 | `error.upload.ticket_wrong_movie` | — | `The upload ticket does not belong to this movie` |
| Ticket does not match this episode | 403 | `error.upload.ticket_wrong_episode` | — | `The upload ticket does not belong to this episode` |
| tus metadata incomplete | 400 | `error.upload.metadata_incomplete` | — | `Upload metadata is incomplete` |
| Target already downloading | 409 | `error.movie.download_in_progress` / `error.episode.download_in_progress` | — | *(as above)* |
| Target no longer exists | 404 | `error.movie.not_found` / `error.episode.not_found` | `id` | *(as above)* |

The English `Error`s in `services/api/src/uploads/upload-tickets.service.ts` that
`uploads.service.ts:122-123` currently matches **by string comparison** must move to the same key
mechanism. That coupling is the internal twin of the `auth-session.ts` one and breaks the same way.

### Error table — `worker`

Reported through `encodeFailed(errorKey, errorParams, errorMessage)` per REQ-11.

| Condition | Key | Params | English `message` |
| :-- | :-- | :-- | :-- |
| Input file has no video stream | `error.encode.no_video_stream` | — | `The input file has no video stream` |
| No audio track in the original language | `error.encode.no_original_audio` | `iso3` | `The file has no audio track in the original language ({iso3})` |
| `ffprobe` could not read the file | `error.encode.probe_failed` | `filePath`, `detail` | `Could not analyse the video file ({filePath}): {detail}` |
| `ffmpeg` exited non-zero | `error.encode.ffmpeg_failed` | `code`, `stderr` | `ffmpeg exited with code {code}: {stderr}` |
| `ffmpeg` exited 0 but wrote nothing | `error.encode.no_output` | `path` | `ffmpeg exited 0 but produced no {path}` |
| `mkvmerge` failed | `error.encode.mkvmerge_failed` | `code`, `stderr` | `mkvmerge failed with code {code}: {stderr}` |
| Episode missing season/episode number | `error.encode.episode_numbers_missing` | — | `Episode has no season/episode number: cannot build the output path` |
| Unknown `ENCODE_DRIVER` | `error.encode.unknown_driver` | `driver` | `Unknown ENCODE_DRIVER: {driver}` |
| `processJob` gone | `error.processJob.not_found` | `id` | *(as above)* |
| Source has no `downloadPath` | `error.source.no_download_path` | — | *(as above)* |
| Source targets nothing | `error.source.no_target` | `id` | *(as above)* |

`stderr` is a parameter, not part of the sentence. `services/worker/src/ffmpeg/runner.ts:9-10` already
keeps the tail specifically so it can reach `encodeFailed`; that stays true, it just travels in
`errorParams` now.

`services/worker/src/api/graphql-client.ts` throws when `api` returns errors. Under REQ-11 it must
propagate the `extensions.i18n` it received rather than `JSON.stringify`-ing the whole error array
into a new message — otherwise an `api` key round-trips into the database as unreadable JSON, which
is what happens today.

The three infrastructure errors in that same file (`INTERNAL_GRAPHQL_URL no está definida`,
`SERVICE_TOKEN no está definida`, and the HTTP-status throw) are **not** keyed. They are boot-time
operator errors that never reach a user; per Article VI they simply become English.

### What consumers do with each key

- **`web` server actions** (`src/actions/*.ts`): keep returning `{ error }` to `useActionState`, but
  `error` is now resolved through the catalog from `extensions.i18n`, falling back to `message`. The
  deliberate-passthrough comments in `src/actions/users.ts:76-77,112-113,152-154` are replaced by
  key lookup — the behaviour they describe (the API's exact reason reaching the screen) is preserved,
  the mechanism is not.
- **`web` read functions**: same resolution before `throw new Error(...)`.
- **`web` `auth-session.ts`**: matches `error.auth.unauthenticated` and `error.auth.session_expired`
  (REQ-14).
- **`web` `importFileModal.tsx`**: reads `i18n.key` off the REST error body (REQ-10).
- **`worker`**: does not render anything. It forwards keys and stores them.

## Data Model Changes

| Model | Change | Nullable / default | Backfill needed? |
| :-- | :-- | :-- | :-- |
| `User` | `+ uiLocale String? @db.VarChar(35)` | nullable, no default | **No** (NFR-2) |
| `MediaSource` | `+ errorKey String? @db.VarChar(100)` | nullable, no default | No |
| `MediaSource` | `+ errorParams String? @db.Text` | nullable, no default | No |
| `ProcessJob` | `+ errorKey String? @db.VarChar(100)` | nullable, no default | No |
| `ProcessJob` | `+ errorParams String? @db.Text` | nullable, no default | No |

One additive migration, `ALTER TABLE … ADD COLUMN` only — no `UPDATE`, no data movement, no dropped
column. `errorMessage` stays on both models and keeps holding the English rendering, which is what
makes NFR-3 hold for rows written before this feature.

`VarChar(35)` on `uiLocale` is the maximum length of a well-formed BCP-47 tag in practice; the
supported set today is far shorter, but the column should not be the thing that blocks REQ-17.

**`uiLocale` is not `UserLanguage`.** The existing `Language` / `UserLanguage` / `UserMovieLanguage` /
`UserShowLanguage` tables are the user's **audio and subtitle track** preference, consumed by the
encoder through `allowedLanguagesIso3`. They are unrelated to the interface language and must not be
reused, merged or renamed for it — `011-av1-transcode` built them for the transcode pipeline and a
user who wants Japanese audio with an English interface is an ordinary user, not an edge case.

## Acceptance Criteria

- [ ] **AC-1**: Given a freshly seeded install, `me { uiLocale }` returns `null`, and a request to
      `/dashboard` with `Accept-Language: en-US` renders the interface in English.

- [ ] **AC-2**: Given `setUiLocale("es")`, the same `/dashboard` request with an unchanged
      `Accept-Language: en-US` renders in Spanish — proving the user row wins over the header
      (REQ-1) — and the requested URL is byte-identical in both cases (REQ-4).

- [ ] **AC-3**: Given `uiLocale` null and `Accept-Language: es-AR,es;q=0.9`, the page renders in
      Spanish (REQ-2). With `Accept-Language: fr-FR`, the same page renders in English.

- [ ] **AC-4 (failure)**: `query { movie(id: 999999) }` for a film that does not exist returns an
      error whose `extensions.i18n.key` is `error.movie.not_found`, whose `extensions.i18n.params.id`
      is `999999`, and whose `message` is English. Navigating to `/movies/999999` in the browser
      renders the unavailable page in the active locale.

- [ ] **AC-5 (failure)**: Given a signed-in user in a second browser, an admin disables that user;
      the next navigation in the second browser lands on `/login` with the auth cookie deleted. This
      is `004-user-disable`'s AC re-run after REQ-14 replaced string matching with key matching, and
      it must pass in **both** locales.

- [ ] **AC-6 (failure)**: `setUiLocale("kl")` is refused with `error.user.unsupported_locale`, and a
      follow-up `me { uiLocale }` shows the value unchanged (REQ-19).

- [ ] **AC-7 (failure)**: Force an encode failure (an input with no video stream). The resulting
      `ProcessJob` row has `errorKey = "error.encode.no_video_stream"` and an English `errorMessage`
      — verifiable with `bin/mysql -e 'select id, errorKey, errorMessage from process_jobs order by
      id desc limit 1'`.

- [ ] **AC-8 (N locales)**: Adding a `pt.json` catalog beside the existing two and one entry to the
      supported-locale list makes `supportedLocales` include `pt`, makes `setUiLocale("pt")` succeed,
      and makes the interface render Portuguese — with **no other file changed**. `git status` after
      the experiment shows exactly one new file and one modified file (REQ-17).

- [ ] **AC-9**: A repository search for Spanish copy under `services/web/src` returns nothing outside
      the `es` catalog. The two TailAdmin boilerplate titles (`Next.js Blank Page | TailAdmin …`) on
      `/movies/add` and `/shows/add` are gone (REQ-5).

- [ ] **AC-10**: `bin/npm web run build` exits 0 and `bin/cli api npx --no tsc --noEmit` reports 0
      errors, before and after (NFR-5). `bin/npm api test` and `bin/npm worker test` stay green.

- [ ] **AC-11**: A row in `media_sources` written before this feature — one whose `errorKey` is
      `null` and whose `errorMessage` holds Spanish text — still renders that text rather than
      nothing (NFR-3).

- [ ] **AC-12**: A command reports any key present in one catalog and absent from the other, and
      exits non-zero when one exists (NFR-1).

## Out of Scope

- **The profile screen that sets the language.** Explicitly deferred by the user. This feature
  delivers the column, the resolution order, the `setUiLocale` mutation and the whole translation
  machinery; the screen a user clicks to change it is a separate feature.
  `services/web/src/components/header/UserDropdown.tsx:98,123` already links to `Edit profile` and
  `Account settings`, neither of which is a route — building those is that feature's job, not this
  one's. `setUiLocale` is nonetheless **in** scope: without it the column is unwritable, and
  Constitution Article III forbids setting it by hand with `bin/mysql`, so AC-2, AC-6 and AC-8 would
  all be unverifiable.

- **Catalogs for a third language.** The machinery is built for N locales (REQ-17, AC-8) and adding
  one must not touch code — but only `en` and `es` are written here. Translating Perceptor into a
  third language is content work.

- **Rendering `errorMessage` / `errorKey` anywhere in the UI.** A repository search for
  `errorMessage` under `services/web` returns nothing today: neither column is shown. REQ-12 makes
  those rows renderable later; it does not add a screen that renders them. A failure-detail UI is
  its own feature.

- **A language switcher in the header.** Ruled out by the user. The locale is a considered account
  setting, not a control anyone flips by accident.

- **Localized URLs, slugs or route segments.** REQ-4 forbids them. Perceptor runs on a LAN and is
  never indexed, so the usual reasons do not apply.

- **Translating GraphQL `description:` strings.** The Spanish descriptions on `auth.resolver.ts` and
  all six in `process-jobs.resolver.ts` are schema documentation read by developers in a playground,
  not user copy. They become English under Article VI, but they are not catalog entries.

- **Translating logs.** `console.log` / Nest logger output stays English, unkeyed. Article VI already
  requires this and a log line is not user-facing text.

- **Timezone handling.** REQ-15 covers formatting a date in the active locale. Which timezone that
  date is rendered in is governed by `TZ` and is not touched here.

- **The `movieId` unification debt.** The root `CLAUDE.md` records that `movieId` means two different
  things across three services and that `docs/spec/graphql-contract.md` must move first. This feature
  touches the same seam and must not opportunistically fix it — a partial rename breaks the download
  pipeline at runtime with no compile error anywhere.

- **A test toolchain for `services/web`.** Still none (NFR-6).
