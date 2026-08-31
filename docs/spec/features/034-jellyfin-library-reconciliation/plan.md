---
title: Reconcile a newly registered title against the media server — Implementation Plan
spec_version: 0.2.0
last_updated: 2026-08-31
status: Implemented
---

# PLAN: Reconcile a newly registered title against the media server (`plan.md`)

## Approach

Three seams, in `api`, plus one button in `web`.

**The index is its own leaf module.** `src/media-server-index/` holds `MediaServerIndexService`,
which owns the `media_server_items` table, the three non-catalog `Setting` rows carrying rebuild
state, and the enumerate-and-replace routine. It imports **only** `PrismaModule` and `RedisModule`,
and it never reads `SettingsService`: `rebuild()` takes the client id and the `MediaServerConfig`
as arguments. That is not decoration — it is what makes the wiring possible at all. `SettingsResolver`
has to trigger a rebuild (REQ-2) and `MediaServerModule` already imports `SettingsModule`, so putting
the index inside `media-server/` would make `SettingsModule ⇄ MediaServerModule` circular. There is no
`forwardRef` anywhere in this service (`grep -rn forwardRef src` is empty) and no
`@nestjs/event-emitter` dependency; introducing either to work around a cycle we can simply not create
is the worse trade. Passing the config in inverts the dependency and both callers already hold it.

**Reconciliation lives in `media-server/`, not in `movies/` or `shows/`.**
`MediaServerReconcileService.reconcileMovie(movieId, tmdbId)` and `.reconcileShow(showId, tmdbId)` are
the only two entry points, and the never-downgrade guard (REQ-15) exists exactly once inside them.
Putting it in the two callers would duplicate the one rule in this feature whose violation is
invisible. The guard is expressed as a `where` clause, not a read-then-write:

```ts
prisma.movie.updateMany({ where: { id, status: 'MISSING' }, data: { status: 'COMPLETED' } })
```

`status: 'MISSING'` inside `where` makes the promotion atomic against a concurrent
`torrentCompleted` or `encodeCompleted`. A `findUnique` followed by an `update` would pass every test
and still clobber an in-flight download under real concurrency.

**`findByTmdbId` goes on the client, and the index reaches it as a port.** `clients/` is not a Nest
module — `createJellyfinClient` is a plain factory over a config object — so it cannot inject
`MediaServerIndexService`. `MediaServerFactory` gains a second parameter, a one-method port
`{ lookup(mediaType, tmdbId): Promise<string | null> }`. Jellyfin's `findByTmdbId` delegates to it;
an Emby client would ignore it and query `AnyProviderIdEquals` directly. `listLibrary` is **optional**
on the interface (`listLibrary?()`), which is how REQ-8 is honoured at zero cost: a client that
resolves natively simply does not implement it, and `rebuild()` is a no-op for it. `registry.ts` keeps
its one-line-per-server shape.

**Reused, not reinvented:**

- `services/api/src/shows/shows.service.ts`'s `hydrate()` — the whole detached-background-work idiom:
  a Redis `SET … NX` claim so concurrent triggers run once, a `try/catch/finally` so nothing escapes
  as an unhandled rejection, and a persisted "synced at" marker written only after the work is whole.
  `rebuild()` is that pattern applied to a different job; do not invent a second one.
- `services/api/src/settings/settings.resolver.ts`'s `changedDownloadsPath` block — the precedent for
  "after the write is confirmed, fire a side effect from the **resolver**, not the service, to avoid a
  cycle". REQ-2's trigger goes in the same place, immediately after it.
- `services/api/src/media-server/media-server.service.ts`'s `notifyCreated()` — the never-throws
  discipline NFR-1 demands, including the "client chosen but host empty" early return. Reconciliation
  copies its failure posture exactly.
- `services/api/src/ffprobe-logs/ffprobe-logs.resolver.ts` — `@UseGuards(AdminGuard)` **per method**.
  Not `UsersResolver`'s class-level form.
- `services/api/src/types/media.ts`'s `MEDIA_TYPE` — the `'movie'`/`'show'` vocabulary for the
  `mediaType` column. There is no Prisma enum for it and this feature does not add one.
- `services/web/src/components/downloads/DownloadsPanel.tsx` — `useTransition` + `Button onClick` +
  a server action returning `{ error }` + `router.refresh()`. The Re-sync button is that shape.
- `services/web/src/actions/downloads.ts` and `toActionError` — the action file shape.

## Order of Work

| Step | Service | Why it must come here |
| :-- | :-- | :-- |
| 1 | `api` | Owns the migration, the `MediaServerClient` interface change and the whole GraphQL delta. `web` cannot query a type the schema does not have. |
| 2 | `web` | Renders `mediaServerIndexStatus` and calls `resyncMediaServerIndex`; both must exist first. |

**Nothing runs in parallel across services here.** The `web` slice is four files and depends entirely
on step 1's schema; starting it early buys nothing and risks diverging from the delta.

*Within* `api`, once the migration and `clients/media-server/types.ts` are in place, three tracks are
genuinely independent: the Jellyfin client methods, the index service, and the reconcile service. They
meet only at module wiring. See `api/plan.md` for the ordering inside the slice.

## Contract Freeze

The `## GraphQL Contract Delta` in `spec.md` is frozen as of `status: Approved`. Things an
implementer will want to change and must not:

- **`MediaServerIndexStatus.state` is `String!`, not a GraphQL enum.** It will look like it should be
  an enum. `Movie.status` and `Show.status` are `MediaStatus` in Prisma and cross GraphQL as plain
  `String!`; `services/api/CLAUDE.md` calls out "do not `registerEnumType` it for one type only".
  Same rule, same reason.
- **`resyncMediaServerIndex` returns `MediaServerIndexStatus!`, not `Boolean`.** It returns the status
  as of the moment it was called so `web` can flip straight to `syncing` without a second round trip.
- **A rebuild already in flight is not an error** (REQ-7). The mutation returns the in-progress status.
  An implementer will be tempted to add a `*_SYNC_IN_PROGRESS` error key — do not; it is not in the
  frozen table.
- **`error.mediaServer.not_configured` is the only new key.** It goes in
  `src/i18n/error-keys.ts`, `src/i18n/messages.en.ts` and both `services/web/messages/*.json`.
- **`addMedia` does not change.** Not its signature, not its return type, not its timing contract for
  series. Reconciliation is invisible to the contract.
- **`Movie.filePath` stays `null` for a promoted title** (REQ-16). It will look like an omission.

If the contract turns out to be wrong: stop, amend `spec.md`, re-approve, re-brief both services.
Never patch it from inside one slice (Constitution, Article VIII).

## Migrations

1. `add_media_server_items` — creates `media_server_items` (`id`, `mediaType VARCHAR(10)`,
   `tmdbId INT`, `externalId VARCHAR(100)`, `createdAt`) with `@@unique([mediaType, tmdbId])`.
   Generated through `bin/npm api run prisma:migrate`, never hand-written SQL (Article III).
2. Backfill: **none.** The table starts empty on every installation. A fresh index is one rebuild
   away, and titles registered before this shipped are reconciled by re-adding them (REQ-18).
3. Seeds: `prisma/seeds/settings.ts` gains `media_server_index_state` (`"never"`),
   `media_server_index_synced_at` (`""`) and `media_server_index_count` (`"0"`), create-only like
   every other row there, and **not** added to `SETTINGS_CATALOG` — `updateSettings` must keep
   rejecting them, exactly as it rejects `torrent_port`.

Reversibility: dropping the table is safe. Nothing else reads it, no foreign key points at it, and
every `Movie`/`Episode` row it ever promoted keeps its status — a rollback loses the ability to
reconcile, never any library state.

## Risks

| Risk | How it fails | Mitigation |
| :-- | :-- | :-- |
| **Prisma transaction timeout on a large library** | `$transaction` defaults to a 5s timeout. A delete-plus-insert of several thousand rows exceeds it, rolls back, and the rebuild fails *every* time on exactly the installations that need it most — while the old index survives, so the symptom is "re-sync does nothing" with no visible damage. | `rebuild()` passes an explicit `timeout` to `$transaction` and chunks `createMany` at 1000 rows. Called out in `api/plan.md`. |
| **A stale `syncing` row after a process death** | The Redis claim expires by TTL; the `media_server_index_state` row stays `"syncing"` forever. Settings shows a spinner that never resolves and the Re-sync button stays disabled — the feature is bricked with no error anywhere. | `state` is **derived**, not read raw: `syncing` is reported only when the Redis claim is actually held. A stored `syncing` with no live claim reports `failed`. One rule, in `readState()`. |
| **A wrong Jellyfin field name yields an empty list** | `ProviderIds.Tmdb`, `ParentIndexNumber`, `IndexNumber`, `LocationType` are hand-typed against an external API with no schema check. A typo produces zero entries, not an error: the index builds "successfully" with 0 items and every title reconciles to `MISSING` — which is also the correct output when the library genuinely has nothing. The two are indistinguishable. | `clients/media-server/jellyfin.spec.ts` pins the mappers against recorded payload shapes (Article IX). Plus REQ-6: the entry count is on screen, so `ready, 0 items` is visible rather than silent. |
| **Virtual episodes promote a title nobody has** | `TvShowsController.GetEpisodes` sets `shouldIncludeMissingEpisodes = … \|\| User.GetIsApiKey()`. This installation authenticates with an API key, so metadata-only episodes come back **unconditionally**. Not filtering them marks every episode of every registered series `COMPLETED`. This is the single most damaging failure in the feature and it produces no error. | `isMissing=false` on the request **and** a defensive `LocationType !== 'Virtual'` filter in the mapper — belt and braces, because the request-side filter is a post-filter in Jellyfin and one upstream change to it is silent. Covered by AC-11 and a spec case. |
| **Reconciliation clobbers an in-flight download** | A read-then-write guard loses to a concurrent `torrentCompleted`, moving a `DOWNLOADING` film to `COMPLETED` with no file. | The guard is `where: { id, status: 'MISSING' }` on `updateMany` — atomic in one statement. AC-9. |
| **A re-added series never re-reconciles** | `ShowsService.register()` only calls `hydrate()` when `seasonsSyncedAt === null`. An already-hydrated series re-added after the index was built would skip reconciliation entirely, quietly defeating REQ-18 — the documented retry would just not work. | The existing-show branch calls `reconcileShow()` directly, outside `hydrate()`. Named explicitly in `api/plan.md` step 8. |
| **The Re-sync button submits the settings form** | The Media Server panel sits *inside* `SettingsForm`'s main `<form>`. A raw `<button>` defaults to `type="submit"`, so pressing Re-sync would silently save every setting on every tab. | Use `@/components/ui/button/Button`, which already defaults to `type="button"`, driven by `useTransition` — never a nested `<form>` (invalid HTML) and never a raw `<button>`. |
| **`media_server_host` reads as "changed" when it was never submitted** | `MediaServerFields` does not render host/port/apiKey while the client is `none`, so those keys are absent from `FormData` and dropped by `EDITABLE_KEYS`. Comparing against an absent key as `""` would fire a pointless rebuild on every save. | The comparison in `SettingsResolver` considers **only keys present in `entries`**, and only when the submitted value differs from the stored one. |

## Verification

```bash
bin/npm api run prisma:migrate
bin/cli api npx --no tsc --noEmit
bin/npm api test
bin/npm api run lint
bin/npm web run build
bin/cli web node scripts/check-messages.mjs
bin/npm web run lint
```

Expected: migration applies clean, `0 errors` from `tsc`, the api suite green with the three new
spec files, `check-messages.mjs` exit 0 (both catalogs carry `errors.mediaServer.not_configured`),
`next build` exit 0.

Then the manual pass, against a real Jellyfin:

1. Settings → Media Server: set `jellyfin`, host, port, API key. Save. The panel shows the index as
   `syncing`, then `ready` with a count and a timestamp — **AC-1**.
   `bin/mysql -e 'select count(*) from media_server_items'` agrees with the count on screen.
2. Search and add a film Jellyfin holds. Detail page shows `COMPLETED`;
   `bin/mysql -e "select status, filePath from movies where title='<it>'"` shows `COMPLETED` / `NULL`
   — **AC-2**.
3. Add a film Jellyfin does not hold → `MISSING` — **AC-3**.
4. Add a series Jellyfin holds partially. After hydration, only the episodes with real files are
   `COMPLETED`; any episode Jellyfin lists as virtual is `MISSING` — **AC-4**, **AC-11**.
5. `bin/mysql -e 'select mediaType, tmdbId, externalId from media_server_items where tmdbId in (select tmdbId from media_server_items group by tmdbId having count(*) > 1)'`
   — any row pair proves the composite key holds — **AC-6**.
6. Point `media_server_host` at a dead host, add a title: the add succeeds, status `MISSING`, one
   warning in `docker compose logs api`, no error in the browser — **AC-7**.
7. Kill the media server mid-rebuild (stop the container during a Re-sync): the row count is
   unchanged, the panel reads `failed` with the **previous** successful timestamp, and adding a
   known-indexed title still reconciles — **AC-8**.
8. Set the client back to `none` and press Re-sync: the inline error renders translated in both `en`
   and `es`; adding a title makes no outbound request — **AC-10**.
9. Add files to Jellyfin, press Re-sync, re-add one of them → `COMPLETED` — **AC-5**.
10. With a film mid-download, have a second user add the same film → still `DOWNLOADING` — **AC-9**.
