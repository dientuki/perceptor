---
title: Reconcile a newly registered title against the media server — Tasks
last_updated: 2026-08-31
status: In Progress
---

# TASKS: Reconcile a newly registered title against the media server (`tasks.md`)

## Legend

| Marker | Meaning |
| :-- | :-- |
| `[api]` `[web]` | Which subagent owns the task. Exactly one per task. |
| `[docs]` | Documentation only. Owned by the orchestrator, not a service agent. |
| `[P]` | May run in parallel with the other `[P]` tasks in the same group. |
| `→ Tnnn` | Blocked by that task. |

No `[worker]` and no `[infra]` task in this feature: the encode pipeline is untouched, and nothing
about the stack, the wrappers, `.env` or any Dockerfile changes. There **is** a Prisma migration —
`git status services/api/prisma/` must show both a modified `schema.prisma` and a new migration
directory once T001 lands (Constitution, Article III).

Group 2 is where the `api` slice fans out; Group 4 (`web`) cannot start until T013 exists, because
there is no codegen and a consumer written against an unbuilt schema diverges silently.

## Tasks

### Group 1 — schema, vocabulary and the client interface (`api`)

- [ ] **T001** `[api] [P]` Add `model MediaServerItem` to `services/api/prisma/schema.prisma` exactly
      as `spec.md` § Data Model Changes freezes it: `id Int @id @default(autoincrement())`,
      `mediaType String @db.VarChar(10)`, `tmdbId Int`, `externalId String @db.VarChar(100)`,
      `createdAt DateTime @default(now())`, `@@unique([mediaType, tmdbId])`, `@@map("media_server_items")`.
      Generate the migration with `bin/npm api run prisma:migrate` — never hand-written SQL. No
      relation to `Movie` or `Show`: the table is a derived index keyed by `tmdbId`, and a foreign key
      would cascade-delete index rows for titles nobody has registered yet.
      *Done when:* `git status services/api/prisma/` shows a modified `schema.prisma` **and** a new
      migration directory, and `bin/mysql -e 'describe media_server_items'` lists the five columns.

- [ ] **T002** `[api] [P]` Add `MEDIA_SERVER_NOT_CONFIGURED: 'error.mediaServer.not_configured'` to
      `services/api/src/i18n/error-keys.ts`, in the "settings, languages, media-server, indexer" block
      beside the existing `MEDIA_SERVER_UNKNOWN`, and its English template to
      `services/api/src/i18n/messages.en.ts`:
      `Configure a media server before syncing the library.` The key string is frozen in
      `spec.md` § GraphQL Contract Delta — match it character for character; `web`'s catalogs key off
      it in T015.
      *Done when:* `bin/npm api test` is green, including the `messages.en` parity suite that fails
      when a key has no template.

- [ ] **T003** `[api] [P]` Add three create-only rows to `services/api/prisma/seeds/settings.ts`:
      `media_server_index_state` = `"never"`, `media_server_index_synced_at` = `""`,
      `media_server_index_count` = `"0"`. Follow the `findUnique`-before-`create` shape every other
      seeder there uses, so re-running never clobbers live state. **Do not add them to
      `settings.catalog.ts`** — they are state the system writes, not configuration a person sets, and
      `updateSettings` must keep rejecting them exactly as it rejects `torrent_port`.
      *Done when:* `bin/mysql -e "select \`key\`, value from settings where \`key\` like 'media_server_index%'"`
      returns the three rows after a seed run, and `updateSettings` with
      `{key: "media_server_index_state", value: "ready"}` fails with `error.setting.not_editable`.

- [ ] **T004** `[api] [P]` Widen the media-server client contract in
      `services/api/src/clients/media-server/types.ts`, per `api/plan.md` step 4: add
      `MediaServerLibraryEntry`, `MediaServerEpisodeRef` and the one-method port
      `MediaServerIndexPort`; add `findByTmdbId(mediaType, tmdbId)` and
      `listPresentEpisodes(externalSeriesId)` as **required** members of `MediaServerClient` and
      `listLibrary?()` as an **optional** one; change `MediaServerFactory` to
      `(config, index) => MediaServerClient`. Forward the port through `createMediaServerClient` in
      `registry.ts` — `MEDIA_SERVERS`, `MEDIA_SERVER_OPTIONS` and `MEDIA_SERVER_IDS` keep their shape,
      one line per server. Update the one existing call site,
      `MediaServerService.notifyCreated`, so the service still compiles; it may pass a port whose
      `lookup` is never reached, since T010 is what gives it a real one. `listLibrary` is optional on
      purpose (REQ-8) — do not promote it to required because Jellyfin happens to need it.
      *Done when:* `bin/cli api npx --no tsc --noEmit` reports 0 errors and `bin/npm api test` is
      green, with `refreshLibrary`/`createdMedia` behaviour unchanged.

- [ ] **T005** `[docs] [P]` Record the delta in `docs/spec/graphql-contract.md`: a new section,
      `### The media-server index is admin-only and rebuilt out of band (034-jellyfin-library-reconciliation)`,
      carrying the `MediaServerIndexStatus` SDL, both operations, the `state` vocabulary
      (`never` | `syncing` | `ready` | `failed`), the fact that `resyncMediaServerIndex` returns
      immediately and that a rebuild already in flight is **not** an error, and the new
      `error.mediaServer.not_configured` key in the § "UI internationalization" vocabulary. State
      explicitly that `addMedia` is unchanged and that `Movie`/`Show`/`Episode` gain no field — the
      reconciliation is invisible on the wire, which is the thing a future reader will not guess.
      *Done when:* the contract document describes every operation in `spec.md` § GraphQL Contract
      Delta, and `state` is documented as `String!` rather than an enum.

### Group 2 — the Jellyfin reach and the index (`api`)

- [ ] **T006** `[api] [P]` Implement the three new methods in
      `services/api/src/clients/media-server/jellyfin.ts`, per `api/plan.md` step 5, keeping the pure
      payload mappers as exported functions so T007 can drive them without HTTP. `findByTmdbId`
      delegates to the injected port and nothing else — Jellyfin has no provider-id filter, and the
      one permitted comment above it is the URL `https://github.com/jellyfin/jellyfin/issues/16192`
      (Article XI's external-documentation exception). `listLibrary` runs two paged enumerations
      (`includeItemTypes=Movie`, then `Series`) with
      `recursive=true&hasTmdbId=true&fields=ProviderIds&excludeLocationTypes=Virtual&enableImages=false&enableUserData=false`,
      paging `startIndex`/`limit` at 500, keeping only entries whose `ProviderIds.Tmdb` parses to a
      positive integer. `listPresentEpisodes` calls
      `GET /Shows/{id}/Episodes?isMissing=false` and **additionally** drops any item with
      `LocationType === 'Virtual'`, an empty `Path`, or a null `ParentIndexNumber`/`IndexNumber` —
      the second filter is not redundant, see the risk table in `plan.md`. Reads get a 5s
      `AbortSignal.timeout`; `listLibrary` gets 5 minutes (NFR-2). Do not send `userId`: it is
      optional under API-key auth.
      *Done when:* `bin/cli api npx --no tsc --noEmit` is clean and `JellyfinClient` satisfies
      `MediaServerClient` including the optional member.

- [ ] **T007** `[api]` Add `services/api/src/clients/media-server/jellyfin.spec.ts`, opening with a
      paragraph naming the failure it defends against: these mappers are hand-typed against an
      external API with no schema check, and a wrong field name yields an **empty list, not an
      error** — the index then builds "successfully" with zero entries and every title reads
      `MISSING`, which is also the correct output for an empty library. Cases, written
      fault-injection style (each must fail when its rule is removed): an item with no `Tmdb` provider
      id is dropped; a non-numeric or zero `Tmdb` is dropped; a `LocationType: "Virtual"` episode is
      dropped **even though the request asked for `isMissing=false`**; an episode with a null
      `IndexNumber` is dropped; a well-formed film and series map to `mediaType` `movie` and `show`
      respectively. → T006
      *Done when:* `bin/npm api test` is green with the new suite, and deleting the `Virtual` filter
      from `jellyfin.ts` makes exactly one case fail.

- [ ] **T008** `[api] [P]` Add `services/api/src/media-server-index/` — `media-server-index.module.ts`
      importing **only** `PrismaModule` and `RedisModule`, and `media-server-index.service.ts` per
      `api/plan.md` step 6. The module's isolation is load-bearing, not tidiness: `SettingsResolver`
      must trigger a rebuild and `MediaServerModule` already imports `SettingsModule`, so an index
      living inside `media-server/` would make those two circular. **Never import `SettingsModule`
      here** — `rebuild(clientId, config)` receives the config, and `readState()` reads the three
      `Setting` rows through `prisma.setting` directly. Three members: `lookup` (`findUnique` on the
      composite key); `rebuild` (Redis `SET … NX` claim on `mediaserver:index:rebuild` following
      `ShowsService.hydrate`'s idiom — `try`/`catch`/`finally`, claim released in `finally`, TTL as
      the backstop; returns early when the client has no `listLibrary`; one
      `$transaction([deleteMany, ...createMany chunks])` with an **explicit `timeout`** and chunks of
      1000; writes the state rows on success and `failed` on error, leaving the table and
      `media_server_index_synced_at` untouched); and `readState`, which **derives** `state` — `syncing`
      only while the claim is actually held, a stored `syncing` with no live claim reporting `failed`.
      The `$transaction` timeout is not optional: the 5s default will not survive a real library and
      the symptom is "Re-sync does nothing". → T001, T004
      *Done when:* `bin/cli api npx --no tsc --noEmit` is clean and
      `grep -rn "SettingsModule\|SettingsService" services/api/src/media-server-index/` returns
      nothing.

- [ ] **T009** `[api]` Add `services/api/src/media-server-index/media-server-index.service.spec.ts`,
      opening with the failure it defends against: a collapsed key silently marks the wrong title
      `COMPLETED`, and a half-applied rebuild is indistinguishable from a complete one. Cases: a film
      and a series with the **same** `tmdbId` coexist and `lookup` returns each one's own `externalId`
      (drop `mediaType` from the key and this must fail); a rebuild whose enumeration throws leaves
      both the previous rows and `media_server_index_synced_at` untouched and records `failed`; a
      second `rebuild()` does not start while the claim is held; a stored `syncing` with no live claim
      reads back as `failed`. → T008
      *Done when:* `bin/npm api test` is green with the new suite, and removing `mediaType` from the
      `findUnique` key makes the first case fail.

### Group 3 — reconciliation and the GraphQL surface (`api`)

- [ ] **T010** `[api]` Add `services/api/src/media-server/media-server-reconcile.service.ts` per
      `api/plan.md` step 7, and wire it: `MediaServerModule` imports `MediaServerIndexModule` and
      exports the new service, and `MediaServerService.notifyCreated` now builds its client with the
      real port. A private `client()` helper resolves settings → client and returns `null` for `none`
      or an empty host (REQ-20), mirroring `notifyCreated`'s early returns. `reconcileMovie` and
      `reconcileShow` promote **only** through
      `updateMany({ where: { id, status: 'MISSING' }, data: { status: 'COMPLETED' } })` — the
      `status: 'MISSING'` in the `where` is the never-downgrade guard (REQ-15) and makes the promotion
      atomic against a concurrent `torrentCompleted`; a `findUnique`-then-`update` passes tests and
      loses the race. Never write `filePath`, never write `MISSING`. `reconcileShow` resolves each
      `(seasonNumber, episodeNumber)` against the show's own rows, does not filter season 0 (REQ-13),
      and skips an unknown episode number silently. Both wrapped so nothing escapes (NFR-1).
      → T006, T008
      *Done when:* `bin/cli api npx --no tsc --noEmit` is clean, and
      `grep -n "findUnique\|findFirst" media-server-reconcile.service.ts` shows no read-then-write
      around a status promotion.

- [ ] **T011** `[api] [P]` Add
      `services/api/src/media-server/media-server-reconcile.service.spec.ts`, opening with the failure
      it defends against: a wrong promotion marks a film `COMPLETED` that nobody has, and the user
      finds out only when they try to play it — nothing in any log says anything went wrong. Cases: a
      `DOWNLOADING` film the server holds stays `DOWNLOADING`, and likewise `ENCODING` and `ERROR`; a
      `MISSING` film becomes `COMPLETED` with `filePath` still null; an episode the server reports but
      the show does not have is skipped without throwing; season 0 reconciles like any other; no path
      ever writes `MISSING`; a client that throws does not propagate out of `reconcileMovie`.
      → T010
      *Done when:* `bin/npm api test` is green with the new suite, and dropping `status: 'MISSING'`
      from the `updateMany` `where` makes the `DOWNLOADING` case fail.

- [ ] **T012** `[api] [P]` Wire the three trigger points per `api/plan.md` step 8.
      `MoviesService.register()` **awaits** `reconcileMovie` before returning, on both the
      existing-row and new-row branches — it costs one indexed DB read and no HTTP (NFR-3), so the
      user sees the right status immediately. `ShowsService.hydrate()` calls `reconcileShow` at the
      very tail, **after** the `show.update({ seasonsSyncedAt })` write, so a reconcile failure can
      never make the next `register()` re-fetch the whole catalog (REQ-19). And
      `ShowsService.register()`'s **existing-show branch** calls `reconcileShow` directly, detached —
      without this, re-adding an already-hydrated series skips reconciliation entirely and REQ-18's
      documented retry silently does nothing. `MoviesModule` and `ShowsModule` import
      `MediaServerModule`; confirm nothing under `media-server*/` imports `movies/` or `shows/`.
      → T010
      *Done when:* `bin/npm api test` is green with no existing `movies.service.spec.ts` /
      `shows.service.spec.ts` case changed, and the app boots — a module cycle fails at boot, not at
      typecheck.

- [ ] **T013** `[api]` Add `services/api/src/media-server/entities/media-server-index-status.entity.ts`
      (`@ObjectType` with `state: String!`, `itemCount: Int!`, nullable `syncedAt: DateTime`) and the
      two operations to `media-server.resolver.ts`, each carrying its **own**
      `@UseGuards(AdminGuard)` — per method, the `ffprobe-logs.resolver.ts` precedent, never at class
      level, since the existing `mediaServerClients` query must stay unguarded.
      `resyncMediaServerIndex` reads the config off `SettingsService`, throws
      `MEDIA_SERVER_NOT_CONFIGURED` for `none` or an empty host, starts `rebuild()` **detached**
      (`void`, never awaited — NFR-6) and returns `readState()` immediately. `state` is a plain
      `String!` — **do not `registerEnumType`**; `Movie.status` and `Show.status` cross as strings for
      the same reason. A rebuild already in flight returns the in-progress status, not an error.
      → T010
      *Done when:* `git diff services/api/src/schema.gql` shows exactly `MediaServerIndexStatus`,
      `mediaServerIndexStatus` and `resyncMediaServerIndex` and nothing else, and the query answers a
      non-admin with `error.auth.admin_required`.

- [ ] **T014** `[api]` Fire a rebuild from `SettingsResolver.updateSettings` per `api/plan.md`
      step 10: capture `getMap()` **before** `updateMany`, then after the write compare
      `media_server_client`, `media_server_host`, `media_server_port` and `media_server_api_key`,
      considering **only keys present in `entries`** and only when the submitted value differs from
      the stored one — `MediaServerFields` does not render host/port/apiKey while the client is
      `none`, so those keys are absent from the submission and must not read as "changed to empty".
      Place it immediately after the existing `changedDownloadsPath` block, which is the precedent for
      firing a side effect from the resolver rather than the service. `SettingsModule` imports
      `MediaServerIndexModule` — the leaf, never `MediaServerModule`, which would be circular.
      → T008
      *Done when:* saving Settings with an unchanged media-server config leaves
      `media_server_index_synced_at` untouched, and changing only the host triggers a rebuild
      (`state` moves to `syncing`).

### Group 4 — the Settings panel (`web`)

Everything here depends on Group 3: `web` retypes the schema by hand and there is no codegen, so a
consumer written before T013 exists diverges with no compile error anywhere.

- [ ] **T015** `[web] [P]` Add the new copy to **both** `services/web/messages/en.json` and
      `messages/es.json`, same keys in each: `errors.mediaServer.not_configured` (the `es` string in
      the existing Rioplatense register — `Configurá un media server antes de sincronizar la
      biblioteca`), plus the panel's own keys under `settings.mediaServer` for the status line, the
      four `state` values, the entry count, the timestamp label and the Re-sync button. Without the
      error entry `translateGraphQLError` falls back to api's English string and the Spanish page
      silently shows English. → T002
      *Done when:* `bin/cli web node scripts/check-messages.mjs` exits 0.

- [ ] **T016** `[web]` Add `MediaServerIndexStatus` to `services/web/src/types/media-server.ts`
      (`state: string` — **not** a union of the four literals; there is no codegen, and narrowing here
      means a fifth state added later fails to compile against a value the api legitimately sends),
      then `getMediaServerIndexStatus()` and `resyncMediaServerIndexAction()` in
      `src/actions/media-server.ts`, following `getMediaServerOptions()` immediately above and
      `src/actions/downloads.ts` for the action shape. The read function `throw`s; the action returns
      `{ error, errorKey? } | { status }` via `toActionError`, calling `redirectIfUnauthenticated`
      first. It is not a `useActionState` form action and takes no arguments. → T013
      *Done when:* `bin/npm web run build` exits 0 and the query document names exactly `state`,
      `itemCount` and `syncedAt`.

- [ ] **T017** `[web]` Render it. Fetch the status in `settings/page.tsx`'s existing `Promise.all`,
      thread it through `SettingsForm` into `MediaServerFields` as `indexStatus`, and in
      `MediaServerFields.tsx` render the status line and a Re-sync button below the three connection
      fields, **inside** the existing `selected !== NONE` block. Use
      `@/components/ui/button/Button` (which already defaults to `type="button"`) driven by
      `useTransition`, following `DownloadsPanel.tsx` — **never a nested `<form>`** (invalid HTML,
      which is why `LanguagePicker` was moved out of the main form) and **never a raw `<button>`**
      (it defaults to `type="submit"`, so pressing Re-sync would silently save every setting on every
      tab). Disable while `state === "syncing"` or `isPending`; render `failed` as a warning whose
      timestamp is the last **successful** rebuild's, not "failed at"; errors inline, never
      `alert()`. → T015, T016
      *Done when:* `bin/npm web run build` exits 0, `bin/npm web run lint` is clean, and pressing
      Re-sync on `/settings` → Media Server does not save the form.

### Group 5 — verification and docs

- [ ] **T018** `[docs]` Update the `CLAUDE.md` files this feature falsifies. Root `CLAUDE.md`: the
      **Register title in DB** row of the pipeline table gains the media-server reconciliation with
      spec `034`; the **Notify media server** row is no longer write-only, since `api` now reads the
      library too. `services/api/CLAUDE.md`: the `media-server/` module-map entry (today one line,
      "post-encode notification") gains the reconcile service and the index, the new
      `media-server-index/` module with the sentence explaining *why* it is separate (the
      `SettingsModule` cycle), the widened `MediaServerClient` interface with `listLibrary` optional,
      and the three non-catalog `Setting` rows beside the `torrent_port` precedent in `settings/`.
      Re-measure the model count (`grep -c "^model " prisma/schema.prisma`) and the migration count
      rather than citing the stale numbers. `services/web/CLAUDE.md`: the Media Server tab now holds
      a control that is **not** part of the main form's save, beside the existing `LanguagePicker`
      note. → T012, T014, T017
      *Done when:* no `CLAUDE.md` still describes `clients/media-server/` as write-only or
      `media-server/` as notification-only, and the root pipeline table cites `034`.

- [ ] **T019** `[docs]` Walk every acceptance criterion in `spec.md` against the running stack —
      including the three failure paths, which need a real dead host (AC-7), a media server killed
      mid-rebuild (AC-8) and a `none` client (AC-10) — tick each box, and set `status: Implemented` on
      `spec.md`, `plan.md`, `api/plan.md` and `web/plan.md`. Re-measure the `api` test count rather
      than citing the root `CLAUDE.md`'s. → T018
      *Done when:* AC-1 … AC-12 are all ticked from an observed run, and
      `bin/npm api run prisma:migrate`, `bin/cli api npx --no tsc --noEmit`, `bin/npm api test`,
      `bin/npm api run lint`, `bin/npm web run build`,
      `bin/cli web node scripts/check-messages.mjs` and `bin/npm web run lint` all pass.

## Blocked

| Task | Service | What blocked it | Needs |
| :-- | :-- | :-- | :-- |

Contract problems always land here (Constitution, Article VIII): an agent that finds the GraphQL
delta wrong stops and reports, it does not amend the delta from inside its slice.
