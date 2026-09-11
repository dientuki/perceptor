---
title: Deselected torrent files must never be encoded — api slice
service: api
last_updated: 2026-09-10
status: Approved
---

# PLAN: Deselected torrent files must never be encoded — `api` (`api/plan.md`)

## Scope

`api` owns everything about *knowing* which files the torrent client actually wrote, and everything
about what an empty scan means. Concretely: one new read on the qBittorrent client, one new
resolved-on-demand field on `MediaSource`, one new field on `SourceFileInput`, and two conditions
inside `sourceScanned` — the `hasUnmatchedFiles` computation and the empty-match `ERROR` branch.

`api` does **not** decide which file gets encoded. The narrowing, the path assembly and the per-file
`isDownloaded` verdict are the worker's (`../worker/plan.md`); `api` receives the verdict and trusts
it, exactly as it already trusts `SourceFileInput.isVideo`. `api` also does not touch the Prisma
schema in this feature — there is no migration (NFR-2).

Writes are confined to `services/api/` and this directory. Anything else is a stop-and-report.

## Files

| File | New / Modified | What changes |
| :-- | :-- | :-- |
| `services/api/src/clients/torrent/types.ts` | Modified | `TorrentClientFile` type (`name`, `priority`, `progress`) + `files` on the `TorrentClient` type. |
| `services/api/src/clients/torrent/client.ts` | Modified | `files(hash)` — `GET torrents/files?hash=<lowercased>`, mapped like `info()` does, throwing `TorrentClientError` on any non-2xx. |
| `services/api/src/media-sources/media-sources.service.ts` | Modified | `downloadedFiles(source)`; the two conditions in `sourceScanned`. |
| `services/api/src/media-sources/media-sources.resolver.ts` | Modified | `@ResolveField('downloadedFiles')`. |
| `services/api/src/media-sources/entities/media-source.entity.ts` | Modified | `downloadedFiles: [String!]` declaration (nullable list of non-null strings). |
| `services/api/src/media-sources/dto/source-file.input.ts` | Modified | `isDownloaded: Boolean!`. |
| `services/api/src/media-sources/media-sources.module.ts` | Modified | `imports: [QueueModule, SettingsModule]`. |
| `services/api/src/i18n/error-keys.ts` | Modified | `SOURCE_SCAN_NO_DOWNLOADED_VIDEO: 'error.source.scan_no_downloaded_video'`. |
| `services/api/src/i18n/messages.en.ts` | Modified | its English rendering. |
| `services/api/src/media-sources/media-sources.service.spec.ts` | Modified | the cases under § Tests. |
| `services/api/src/schema.gql` | Regenerated | artifact only — never hand-edited (Article IV). |

## Existing code to reuse

- `services/api/src/clients/torrent/client.ts` — `baseUrl()`, `HTTP_METHOD`, the
  `new URL(<endpoint>, await this.baseUrl())` + `searchParams` shape of `info()`, and
  `TorrentClientError(message, status)`. `files()` is a sibling of `info()` and must read like one,
  including the comment convention of linking the qBittorrent WebUI API wiki anchor.
  **Do not add a retry, a timeout or a cache** — none of the other methods has one.
- `services/api/src/settings/settings.module.ts` — already provides *and exports* `QbittorrentClient`.
  `MediaSourcesModule` imports `SettingsModule` to get it, the same way `DownloadsModule`,
  `ProcessJobsModule` and `MoviesModule` do. No new provider, no `forwardRef` (nothing in
  `SettingsModule`'s graph imports `MediaSourcesModule`).
- `services/api/src/media-sources/media-sources.service.ts` — `findOneFlat()` is the single read path
  for the row and already returns `infoHash`/`downloadPath`; `sourceScanned`'s transaction, its
  `resolvedPaths` set and its `ERROR` branch are extended in place, never duplicated.
- `services/api/src/i18n/` — `ERROR_KEYS` + `MESSAGES_EN` + the existing `errorKey`/`errorMessage`
  write inside the `ERROR` branch. The new key is **stored on the row**, never thrown: it must not go
  through `i18nError`, because a throw would roll the transaction back and leave the source in its
  previous status.
- `services/api/src/downloads/downloads.service.ts` — `liveInfoForHash()`'s `try`/`catch`/log/return-
  `undefined` shape is the precedent for degrading a torrent-client failure into "no information"
  rather than an exception. `downloadedFiles` follows it, returning `null`.

## Steps

1. **`types.ts`** — add `TorrentClientFile = { name: string; priority: number; progress: number }`
   and `files: (hash: string) => Promise<TorrentClientFile[]>` to `TorrentClient`.
2. **`client.ts`** — implement `files(hash)`: `GET torrents/files?hash=<hash.toLowerCase()>`, throw
   `TorrentClientError` with the status on any non-2xx (a 404 for an unknown hash included — the
   caller distinguishes nothing here, it degrades on any failure), map each row to the three fields
   above and nothing more. Lowercasing is load-bearing: an indexer-sourced `infoHash` is stored
   uppercase (see `../plan.md` § Risks) and qBittorrent answers 404 for it.
3. **`media-sources.service.ts`** — add
   `async downloadedFiles(source: { infoHash: string | null }): Promise<string[] | null>`:
   return `null` when `infoHash` is falsy; otherwise call `files(infoHash)` inside a `try`, and return
   the `name` of every row with `priority !== 0 && progress >= 1`. On **any** throw, log one line
   naming the source and the error and return `null` (REQ-8) — never `[]`, never a rethrow, since this
   resolver runs inside the worker's pre-scan query and an outage must not fail that query.
4. **`entities/media-source.entity.ts`** — declare
   `@Field(() => [String], { nullable: true }) downloadedFiles: string[] | null;`. Note the shape:
   nullable *list*, non-null *items* (`[String!]` in SDL) — `nullable: true` on a `[String]` field in
   Nest yields `[String!]`, which is what the frozen contract says; do not use `nullable: 'itemsAndList'`.
5. **`media-sources.resolver.ts`** — add `@ResolveField(() => [String], { nullable: true })` calling
   the service with `@Parent()`. The parent is the Prisma row, so type it locally against what it
   actually needs (`{ infoHash: string | null }`), not against the `MediaSource` `@ObjectType`, which
   does not expose `infoHash`. The resolver class already carries `@AllowService()` per method — the
   field resolver needs nothing extra; it is reached only through `mediaSource`/`sourceScanned`, which
   are already guarded.
6. **`dto/source-file.input.ts`** — add `@Field() @IsBoolean() isDownloaded: boolean;`, with a comment
   pointing at the worker as the owner of the rule, in the same spirit as `isVideo`'s.
7. **`media-sources.module.ts`** — import `SettingsModule`.
8. **`i18n/`** — add the key and its English message:
   `'No video file in this download has any content — check which files are selected in the torrent client'`.
9. **`sourceScanned`, condition 1 (REQ-6)** — `hasUnmatchedFiles` becomes
   `files.some((file) => file.isVideo && file.isDownloaded && !resolvedPaths.has(file.filePath))`.
10. **`sourceScanned`, condition 2 (REQ-7)** — in the `resolvedMatches.length === 0` branch, pick the
    key: if `files.some((file) => file.isVideo && !file.isDownloaded)` use
    `SOURCE_SCAN_NO_DOWNLOADED_VIDEO`, else keep `SOURCE_SCAN_NO_VIDEO`. `errorMessage` comes from
    `MESSAGES_EN[key]` as it does today; everything else in that branch (the `Movie`/`Episode` demotion
    to `ERROR`, `errorParams: null`) is unchanged.

## Contract obligations

From `../spec.md` § GraphQL Contract Delta, read-only:

```graphql
type MediaSource {
  downloadedFiles: [String!]
}

input SourceFileInput {
  isDownloaded: Boolean!
}
```

`api` owes the worker: a `null` list whenever the answer is not knowable (no `infoHash`, unknown hash,
client unreachable or rejecting) and a list of **paths relative to `downloadPath`** otherwise; a
`sourceScanned` that accepts `isDownloaded` on every file entry and rejects a payload missing it; and
the two stored-key outcomes in the spec's error table. `api` must **not** re-derive `isDownloaded`
itself, and must not filter the `files` array it receives — the inventory stays whole (REQ-5).

`downloadedFiles` must not be added to any `web`-facing query or entity selection, and must not be
resolved eagerly: one torrent-client call per asking caller, zero for everyone else (NFR-1).

## Tests

Follow `media-roots.service.spec.ts`'s style and the house fault-injection technique: each case must
have been verified to fail with the rule removed.

- `services/api/src/media-sources/media-sources.service.spec.ts` — extended, five cases:
  - `downloadedFiles` returns `null` for a source with no `infoHash` (the upload path — a wrong answer
    here breaks every tus import with no error anywhere).
  - `downloadedFiles` returns `null` and does not throw when the client throws `TorrentClientError`
    (REQ-8; defends the worker's pre-scan query against a stopped `torrent` container).
  - `downloadedFiles` drops a `priority: 0` row and an incomplete (`progress: 0.4`) row, keeping the
    rest (REQ-1 — the rule this whole feature exists for).
  - `downloadedFiles` lowercases the hash before calling the client, asserted with an uppercase stored
    `infoHash` (the silent-404 risk in `../plan.md`).
  - `sourceScanned` with one matched video and one `isDownloaded: false` video writes
    `hasUnmatchedFiles: false` (REQ-6 — a wrong value here suppresses download-folder cleanup forever,
    with no error anywhere).
  - `sourceScanned` with zero matches and a not-downloaded video writes
    `error_key = 'error.source.scan_no_downloaded_video'`, while the all-downloaded case still writes
    `error.source.scan_no_video` (REQ-7).

Not owed: `QbittorrentClient.files()` itself. It is a `fetch` wrapper with no branch beyond the
non-2xx throw every sibling method already has, and this service has no spec for any of them
(`clients/torrent/` is covered only for `magnet.ts`, which is pure parsing). Its one non-obvious
behaviour — the lowercase — is pinned from the service spec above, through the mock.

## Done when

```bash
bin/cli api npx --no tsc --noEmit
bin/npm api test
git status --short services/api/prisma
```

0 typecheck errors; the suite green and **above** its recorded count in the root `CLAUDE.md`
§ Current state by the cases added here; `git status` on `prisma/` prints nothing (no migration —
proving NFR-2 rather than asserting it). `services/api/src/schema.gql` may appear in the diff as a
regeneration artifact showing exactly the two frozen additions.
