---
title: First-step page — TMDB key plus indexer setup — api slice
service: api
last_updated: 2026-09-28
status: Approved
---

# PLAN: First-step page — TMDB key plus indexer setup — `api` (`api/plan.md`)

## Scope

Expose one read-only, admin-only query, `indexerStatus`, reporting how many indexers the configured
Prowlarr holds and whether Prowlarr answered. That is the whole slice.

This service does **not**: render anything, own any copy the user reads (`web` owns every string —
this query returns a number and a boolean, no message), add a URL for the indexer (the existing
`environmentInfo` already carries it, and `../plan.md` § Contract Freeze forbids a second source),
touch the search/ranking/acquisition paths, or change the Prisma schema.

Writes are confined to `services/api/` and this directory. Anything else is a stop-and-report.

## Files

| File | New / Modified | What changes |
| :-- | :-- | :-- |
| `services/api/src/clients/indexer/client.ts` | Modified | Extract the Prowlarr base-URL + `X-Api-Key` construction out of the private `getData(query)` into one private request helper; add `countIndexers()` using it. |
| `services/api/src/clients/indexer/types.ts` | Modified | Add `countIndexers` to the `IndexerClient` type. |
| `services/api/src/clients/indexer/client.spec.ts` | Modified | Cover `countIndexers`' failure branches beside the existing `getData` ones. |
| `services/api/src/indexer/entities/indexer-status.entity.ts` | New | `@ObjectType() IndexerStatus` — `configuredIndexers: Int!`, `reachable: Boolean!`. |
| `services/api/src/indexer/indexer.service.ts` | Modified | Add `status()`: calls `countIndexers()`, maps a throw to `{ configuredIndexers: 0, reachable: false }`. |
| `services/api/src/indexer/indexer.resolver.ts` | Modified | Add the `indexerStatus` query, `@UseGuards(AdminGuard)`. |
| `services/api/src/indexer/indexer.service.spec.ts` | Modified | The three outcomes of `status()`. |
| `services/api/src/indexer/indexer.module.ts` | Modified | Only if `AdminGuard`'s dependency (`PrismaService`) is not already reachable from this module's injector — check before editing. |
| `services/api/src/schema.gql` | Regenerated | Artifact of the decorators above, never hand-edited (Article IV). |

No migration, no `prisma/` change, no new module directory.

## Existing code to reuse

- `services/api/src/clients/indexer/client.ts` — `ProwlarrClient` already resolves
  `tracker_host`/`tracker_port`/`tracker_api_key` from `SettingsService.getMap()` and already maps a
  failed fetch and a non-2xx response to `i18nError.serviceUnavailable(ERROR_KEYS.INDEXER_UNAVAILABLE)`.
  `countIndexers()` reuses that posture verbatim — do **not** add a second error key, and do not
  make this one method swallow its own failure (the service does that, see below).
- `services/api/src/environment/environment.resolver.ts` — the house shape for an admin-only,
  read-only leaf query: `@UseGuards(AdminGuard)` **per method**, never at class level, with a
  `description` on the `@Query`. Copy that shape; the `indexer.resolver.ts` you are editing has no
  guard today because `searchTorrents` is open to every user, so the guard goes on the new method
  only.
- `services/api/src/i18n/error-keys.ts` — `INDEXER_UNAVAILABLE` already exists. This feature adds no
  error key: the only new failure the user can observe is rendered by `web` from `reachable: false`,
  which is data, not an error.
- `services/api/src/indexer/entities/torrent-result.entity.ts` — the entity shape/decorator style to
  follow for the new `IndexerStatus`.

## Steps

1. In `client.ts`, extract the base-URL and header construction from `getData` into one private
   helper that takes a path plus optional search params and returns the parsed JSON, keeping the
   existing `try`/`catch` → `INDEXER_UNAVAILABLE` and the `!res.ok` → `INDEXER_UNAVAILABLE` branches
   exactly as they are. `getData` becomes a caller of it. `search()`'s observable behaviour must not
   change — `client.spec.ts`'s existing cases are the proof.
2. Add `ProwlarrClient.countIndexers(): Promise<number>` calling that helper against
   `/api/v1/indexer` (Prowlarr's configured-indexer list; the URL is the one comment this file is
   allowed, Article XI exception 1). Validate the body with `Array.isArray` and throw
   `INDEXER_UNAVAILABLE` when it is not an array — a 200 carrying an error object must not be
   counted as indexers, which is the same class of bug `client.spec.ts`' header paragraph already
   names. Return `length`.
3. Add `countIndexers` to the `IndexerClient` type in `types.ts`.
4. Create `indexer/entities/indexer-status.entity.ts` with the two fields, both non-null, each with
   the contract's own wording as its `description`.
5. Add `IndexerService.status(): Promise<IndexerStatus>` — `await this.prowlarr.countIndexers()` in a
   `try`, returning `{ configuredIndexers: count, reachable: true }`; on `catch`, **log the caught
   error** and return `{ configuredIndexers: 0, reachable: false }`. The log line is what keeps
   Risk 1 in `../plan.md` from being silent: a real defect absorbed into `reachable: false` must at
   least be findable. Do not cache this and do not touch the Redis search cache — it answers one
   question per page load (NFR-3).
6. Add the `indexerStatus` query to `IndexerResolver`, `@UseGuards(AdminGuard)`, returning
   `IndexerService.status()`. It takes no arguments and reads no principal.
7. Verify `AdminGuard` resolves inside `IndexerModule` — it injects `PrismaService`. If it does not,
   import the module that provides it rather than re-providing `PrismaService` locally.
8. Boot the container and confirm the regenerated `schema.gql` diff is exactly `IndexerStatus` and
   `Query.indexerStatus`.

## Contract obligations

From `../spec.md` § GraphQL Contract Delta, read-only:

```graphql
type IndexerStatus {
  configuredIndexers: Int!
  reachable: Boolean!
}

type Query {
  indexerStatus: IndexerStatus!
}
```

- Admin-only, `error.auth.admin_required` for anyone else — `AdminGuard`'s existing behaviour, not
  a new check. The service token is refused too (the guard rejects a non-`user` principal), which is
  correct: no machine caller needs this.
- **A Prowlarr that refuses, times out or answers non-2xx resolves the query** with
  `{ configuredIndexers: 0, reachable: false }`. It does not throw. This is the one place this slice
  deliberately departs from every other Prowlarr caller in the service; `../plan.md` § Contract
  Freeze records why, and "restoring consistency" here breaks AC-2.
- `configuredIndexers` is `0` — never null, never omitted — whenever `reachable` is false.
- Nothing derived from `tracker_api_key` or from an indexer's own configuration leaves this service
  (NFR-1). Return the count and the flag; never Prowlarr's response, not even a filtered copy.

## Tests

- `services/api/src/indexer/indexer.service.spec.ts` — **owed.** `status()`'s mapping is exactly the
  kind of failure Article IX names: too wide a catch reports a healthy indexer as unreachable, too
  narrow a catch makes the page that explains a broken indexer unopenable, and neither produces an
  error a user or a log reader would connect to the cause. Three cases, each asserted separately:
  a count of `0` with `reachable: true`, a positive count with `reachable: true`, and a thrown
  `INDEXER_UNAVAILABLE` mapped to `{ 0, false }`. The spec file's Article IX header paragraph names
  that failure.
- `services/api/src/clients/indexer/client.spec.ts` — **owed**, as an extension of the existing
  file. Its header paragraph already describes this precise class of bug for `search()`: a Prowlarr
  error body parsed as if it were data. `countIndexers()` inherits it — a 200 carrying
  `{"error": "..."}` must throw, not report some length. Add: non-2xx throws, fetch rejection
  throws, a non-array 200 body throws, a JSON array returns its length. Also re-run the existing
  `getData` cases unchanged — they are what proves step 1's extraction was behaviour-neutral.
- `indexer.resolver.ts`, `indexer-status.entity.ts` — **not owed.** The resolver is a one-line
  delegation and the guard is `AdminGuard`'s own already-tested behaviour; a test here would assert
  that Nest wires a decorator, which the boot and AC-3 cover.

## Done when

```bash
bin/cli api npx --no tsc --noEmit
bin/npm api test
git status --short services/api/prisma
```

Typecheck 0 errors; the suite passes with the pre-existing count plus the new cases, and no
previously passing test starts failing; `git status --short services/api/prisma` prints nothing.
Report the before and after test counts, and the exact `schema.gql` diff.
