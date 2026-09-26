---
title: Plex Media Server Client — Tasks
last_updated: 2026-09-26
status: In Progress
---

# TASKS: Plex Media Server Client (`tasks.md`)

## Legend

| Marker | Meaning |
| :-- | :-- |
| `[api]` `[web]` `[worker]` | Which subagent owns the task. Exactly one per task. |
| `[docs]` | Documentation and the cross-service verification sweep. Owned by the orchestrator. |
| `[P]` | May run in parallel with the other `[P]` tasks in the same group. |
| `→ Tnnn` | Blocked by that task. |

**T001 runs before everything.** `buildOutputPath` has no test today — it is only mocked in
`encode.job.spec.ts` — and REQ-16 freezes its output byte-for-byte. The characterization test is the
only thing that can catch a Jellyfin-path regression introduced by the split in T010, so it is
written against the current implementation first and must not change any production file.

**T011 cannot precede T007.** Selecting a field the schema does not expose is a GraphQL *validation*
error, not a null: a worker that asks for `libraryLayout` before `api` exposes it gets no `processJob`
data at all and every encode fails. The dependency is hard.

**`src/ffmpeg/` is untouched.** No task in this feature enters it. The 3 pre-existing `src/ffmpeg/`
failures recorded in the root `CLAUDE.md` under `058` stay out of scope — "no new failures" is the
bar, not "all green".

## Tasks

### Group 1 — the safety net (`worker`)

- [ ] **T001** `[worker]` Create `src/paths/build-output-path.spec.ts` against the **current**
      implementation, opening with the Article IX header naming the silent failure (a regression
      files a playable file under a subtly different name, the job reports `COMPLETED`, and the
      library quietly forks into two naming schemes with no error anywhere). Pin the real-library
      cases the file's own comment records: `Alita: Battle Angel` → `Alita Battle Angel`,
      `X-Men: First Class` → `XMen First Class`, `Lisey's Story` → `Liseys Story`, and `&`/`.`
      preserved (`Dungeons & Dragons…`, `The Super Mario Bros. Movie`). Add: a film with `year: null`
      → `(0000)`, an episode with and without `episodeTitle`, season 0 → `Season 00`, and
      `seasonNumber`/`episodeNumber` null → throws `ERROR_ENCODE_EPISODE_NUMBERS_MISSING`.
      *Done when:* `bin/npm worker test` passes with the new suite counted and
      `git diff --stat services/worker/src/paths/build-output-path.ts` is empty.

### Group 2 — the contract and the client (`api`)

`api` owns both halves of the delta. T005 unblocks `web`; T007 unblocks `worker`.

- [ ] **T002** `[api]` In `src/clients/media-server/types.ts`, add
      `export type LibraryLayout = 'jellyfin' | 'plex'` and
      `export const DEFAULT_LIBRARY_LAYOUT: LibraryLayout = 'jellyfin'`, and widen the registry
      entry's declared shape to
      `{ label: string; create: MediaServerFactory; layout: LibraryLayout; defaultPort: number; credentialLabel: string; credentialHelpUrl?: string }`.
      Do not touch `MediaServerClient`, `MediaServerConfig` or `MediaServerIndexPort` — all three
      already fit Plex unchanged.
      *Done when:* `bin/cli api npx --no tsc --noEmit` reports 0 errors.
- [ ] **T003** `[api]` Create `src/clients/media-server/plex.ts` following `jellyfin.ts`'s shape
      (`READ_TIMEOUT_MS` 5s, `LIST_LIBRARY_TIMEOUT_MS` 5min, error strings quoting status and body but
      never the request URL). Export three pure mappers — `toLibraryEntries` (TMDB id from
      `Guid[]`'s `tmdb://<id>` or a legacy `guid` `com.plexapp.agents.themoviedb://<id>`, dropping an
      item with neither or a non-positive-integer id, `ratingKey` as `externalId`),
      `toPresentEpisodes` (keep only an episode with a `Media[].Part[].file` and both `parentIndex`
      and `index`), and `chooseSectionForPath` (longest matching `Location.path` prefix on a
      path-separator boundary so `/media/movies-4k` never matches `/media/movies`; `null` when none
      matches) — then `createPlexClient(config, index)` returning the five-method client:
      `refreshLibrary` → `/library/sections/all/refresh`; `createdMedia` → list sections,
      `chooseSectionForPath`, `GET /library/sections/{key}/refresh?path=<url-encoded directory>`,
      falling back to `refreshLibrary()` **and logging that it did** when the chooser returns null;
      `findByTmdbId` → `index.lookup`; `listPresentEpisodes` →
      `/library/metadata/{ratingKey}/allLeaves`; `listLibrary` → every section of type `movie` and
      every section of type `show` (there may be several of each) via
      `/library/sections/{key}/all?includeGuids=1`, paginated with the `X-Plex-Container-Start` /
      `X-Plex-Container-Size` headers. Every request sends `X-Plex-Token` and
      `Accept: application/json` as **headers**, never as query parameters. Add
      `src/clients/media-server/plex.spec.ts` with the Article IX header and the cases in
      `api/plan.md` § Tests, each verified to fail when its rule is removed. → T002
      *Done when:* `bin/npm api test` passes with the new suite counted, and
      `grep -n "X-Plex-Token=" services/api/src/clients/media-server/plex.ts` returns nothing.
- [ ] **T004** `[api]` In `src/clients/media-server/registry.ts`, fill the commented-out `plex` entry
      and add the four new keys to both entries — `jellyfin`: `layout: 'jellyfin'`,
      `defaultPort: 8096`, `credentialLabel: 'API key'`; `plex`: `layout: 'plex'`,
      `defaultPort: 32400`, `credentialLabel: 'Plex token'`, `credentialHelpUrl:
      'https://support.plex.tv/articles/204059436-finding-an-authentication-token-x-plex-token/'`.
      Carry them through `MEDIA_SERVER_OPTIONS`, with `null` for the `none` row. Leave
      `MEDIA_SERVER_IDS`, `createMediaServerClient` and `src/settings/settings.catalog.ts` alone —
      `media_server_client`'s options already derive from this map. → T003
      *Done when:* `bin/npm api test` passes and
      `bin/cli api node -e "const{MEDIA_SERVER_OPTIONS}=require('./dist/clients/media-server/registry');console.log(JSON.stringify(MEDIA_SERVER_OPTIONS))"`
      lists three rows with `plex` carrying `defaultPort: 32400`.
- [ ] **T005** `[api]` In `src/media-server/entities/media-server-option.entity.ts`, add
      `@Field(() => Int, { nullable: true }) defaultPort: number | null;`,
      `@Field(() => String, { nullable: true }) credentialLabel: string | null;` and
      `@Field(() => String, { nullable: true }) credentialHelpUrl: string | null;`. Nullable is the
      frozen contract — `none` is a real row of this list and has none of them. → T004
      *Done when:* after the dev server regenerates it, `git diff services/api/src/schema.gql` shows
      exactly three added lines inside `type MediaServerOption`, and
      `bin/cli api npx --no tsc --noEmit` reports 0 errors.
- [ ] **T006** `[api]` In `src/media-server/media-server.service.ts`, add
      `resolveLibraryLayout(settingsMap: Record<string, string>): LibraryLayout` returning the
      configured client's declared `layout`, and `DEFAULT_LIBRARY_LAYOUT` when
      `media_server_client` is absent, `MEDIA_SERVER_NONE`, or an id in no registry entry. It takes
      the map as an argument so its caller reuses the single `getMap()` it already has, and it must
      **not** throw for an unknown id — unlike `createMediaServerClient`, whose
      `error.mediaServer.unknown` is correct for a caller trying to *use* the client. Leave
      `notifyCreated` untouched. Add `src/media-server/media-server.service.spec.ts` with the Article
      IX header, covering `jellyfin`, `plex`, `none`, a missing row and an unknown id. → T004
      *Done when:* `bin/npm api test` passes with the new suite counted.
- [ ] **T007** `[api]` Add `@Field() libraryLayout: string;` to
      `src/process-jobs/entities/encode-job-details.entity.ts` (a string, not an enum — the frozen
      contract), and in `ProcessJobsService.getEncodeJobDetails` set
      `libraryLayout: this.mediaServer.resolveLibraryLayout(settingsMap)` inside the existing `base`
      object, beside `compressionResolution`. No second `getMap()`, and nothing written to the
      `ProcessJob` row. `MediaServerService` is already injected. Extend
      `process-jobs.service.spec.ts` with a `getEncodeJobDetails — libraryLayout` describe block
      mirroring the `compressionResolution` one, asserting the value on both the movie and the
      episode branch, including the `none` → `jellyfin` case. → T006
      *Done when:* `git diff services/api/src/schema.gql` shows exactly one added line,
      `libraryLayout: String!`, inside `type EncodeJobDetails`, and `bin/npm api test` passes.

### Group 3 — the consumers (`web`, `worker`)

Both depend on Group 2 producing the fields they select. They share no file and no type, so they run
in parallel.

- [ ] **T008** `[web] [P]` Add `defaultPort?: number | null`, `credentialLabel?: string | null` and
      `credentialHelpUrl?: string | null` to `MediaServerOption` in `src/types/media-server.ts`
      (optional, for the same reason `state` is a loose `string` there); add the three fields to
      `MEDIA_SERVER_CLIENTS_QUERY` in `src/actions/media-server.ts`; and in
      `src/components/settings/MediaServerFields.tsx` hold the port in state seeded from the `port`
      prop, replace it with the newly selected option's `defaultPort` on combo change when that is
      non-null (leaving it untouched when null), render the credential `<Label>` from the selected
      option's `credentialLabel` falling back to `t("apiKeyLabel")`, and render a
      `target="_blank" rel="noopener noreferrer"` link beside the credential field when
      `credentialHelpUrl` is present. The port input becomes a **raw `<input>`** with `InputField`'s
      Tailwind classes copied in, following `src/components/settings/PathPicker.tsx` — `InputField`
      accepts `defaultValue` and not `value`. Keep `name="media_server_port"` so the FormData
      contract is unchanged, and keep the "fields not rendered while `none` → not submitted →
      previous values preserved" behaviour its comment documents. Add one key for the link text to
      `messages/en.json` and `messages/es.json` (`es` in the Rioplatense register);
      `credentialLabel` is **not** a message key — it arrives from `api` as a literal, like `label`.
      → T005
      *Done when:* `bin/cli web npx --no tsc --noEmit` reports 0 errors,
      `bin/npm web run build` exits 0, `bin/cli web node scripts/check-messages.mjs` reports no
      `en`/`es` drift, and `grep -rn "'plex'\|\"plex\"" services/web/src` returns nothing.
- [ ] **T009** `[worker] [P]` Create `src/paths/library-layout.ts` exporting
      `export type LibraryLayout = 'jellyfin' | 'plex'`, `LIBRARY_LAYOUT_VALUES`, and
      `normalizeLibraryLayout(raw: string | null | undefined): LibraryLayout` returning `'jellyfin'`
      with a `console.warn` for an absent, null or unrecognised value and never throwing — copy the
      shape and the explanatory comment of `src/encode/content-kind.ts`. It lives in `src/paths/`,
      not `src/encode/`, because the path builder consumes it. Add
      `src/paths/library-layout.spec.ts` covering `undefined`, `null`, `''`, `'not-a-layout'` and
      both valid values. → T001
      *Done when:* `bin/npm worker test` passes with the new suite counted.
- [ ] **T010** `[worker]` Widen `OutputPathInput` in `src/paths/build-output-path.ts` with
      `layout: LibraryLayout` and split the body into `jellyfinPath(details)` and `plexPath(details)`
      behind the unchanged exported `buildOutputPath`, keeping `sanitize()`, `pad2()`, the `(0000)`
      year fallback and the `ERROR_ENCODE_EPISODE_NUMBERS_MISSING` guard shared at module scope. The
      Jellyfin branch is the current code **moved, not rewritten**. The Plex branch: film →
      `<outputRoot>/<Title> (<Year>) {tmdb-<id>}/<Title> (<Year>) {tmdb-<id>}.mkv`; episode →
      `<outputRoot>/<Title> (<Year>) {tmdb-<id>}/Season <NN>/<Title> - S<NN>E<NN> - <Episode title>.mkv`,
      dropping ` - <Episode title>` entirely when there is none. Do not change `sanitize()` to
      preserve dashes — it strips them from titles, which is what makes the ` - ` separators
      unambiguous. Extend `build-output-path.spec.ts` with the Plex cases; the Jellyfin cases from
      T001 must pass **unchanged**. → T001, T009
      *Done when:* `bin/npm worker test` passes, every T001 assertion is byte-identical to what it
      was, and `git diff services/worker/src/paths/with-source-extension.ts` is empty.
- [ ] **T011** `[worker]` In `src/jobs/encode.job.ts`, add `libraryLayout: string;` to the local
      `EncodeJobDetails` type **and** `libraryLayout` to the `processJob` selection set, in the same
      edit. Resolve it with `normalizeLibraryLayout(details.libraryLayout)` beside the existing
      `normalizeContentKind`/`normalizeCompressionResolution` calls, include it in the single
      `[encode]` log line, and pass it into the existing `buildOutputPath(details)` call.
      → T007, T010
      *Done when:* `bin/cli worker npx --no tsc --noEmit` reports 0 errors,
      `bin/npm worker run build` exits 0, and `bin/npm worker test` shows no new failures beyond the
      3 pre-existing `src/ffmpeg/` ones.

### Group 4 — verification and docs

- [x] **T012** `[docs]` Update `docs/spec/graphql-contract.md` with a `072` section in the shape of
      the `058`/`070` ones: the three nullable `MediaServerOption` fields (why nullable — `none` is a
      real row) and `EncodeJobDetails.libraryLayout` (why `String!` and not an enum, why resolved at
      query time and never snapshotted, and the consumer obligations — `worker` retypes it and adds
      it to the selection set, `web` does not select it at all). → T008, T011
      *Done when:* the section exists and its SDL matches `spec.md` § GraphQL Contract Delta exactly.
- [ ] **T013** `[docs]` Run every command in `plan.md` § Verification. Confirm
      `git status --short services/api/prisma` is empty and the `schema.gql` diff is exactly the four
      fields (AC-14). → T012
      *Done when:* each command produces its expected result, with the `worker` suite carrying only
      the 3 pre-existing `src/ffmpeg/` failures.
- [ ] **T014** `[docs]` Live manual pass on a running stack, following `plan.md` § Verification
      steps 1–6: AC-1 and AC-2 (combo, port swap, credential label and link, saved port survives a
      reload), AC-3 (Re-sync reaches `Actualizada`, count matches Plex), AC-4 and AC-5 (register a
      held film and a partially-held series), AC-6 and AC-7 (one film and one episode encode, the
      `{tmdb-…}` paths on disk and visible in Plex without a manual scan), AC-8 (switch to Jellyfin
      or `none`, the `[tmdbid=…]` paths return), AC-9 (wrong token → `Última sincronización fallida`,
      row count unchanged), AC-10 (Plex stopped → encode still `COMPLETED`, one `[media-server]` log
      line, no `encodeFailed`), AC-11 (destinations root outside every Plex location → full-refresh
      fallback plus its log line), AC-13 (after the switch, `MediaServerItem` holds numeric rating
      keys and old files keep their names). AC-12 is covered by T009's unit test, not live. → T013
      *Done when:* each listed AC is observed as stated in `spec.md`, or recorded under Blocked with
      what was seen instead.
- [ ] **T015** `[docs]` Update the root `CLAUDE.md`: the **Notify media server** row (a second
      client behind the same surface, index-backed, path-scoped section scan with a full-refresh
      fallback) and the **Transcode** row (the destination is layout-aware; the worker receives
      `libraryLayout` and knows naming conventions, never clients), plus a Current state entry with
      the measured test counts and any AC T014 could not reach. Add the `layout` key to
      `services/api/CLAUDE.md`'s `clients/media-server/` description and the new `src/paths/` files
      to `services/worker/CLAUDE.md`'s module map. → T014
      *Done when:* both rows name `072`, and the Current state entry records the counts from T013.
- [ ] **T016** `[docs]` Walk the acceptance criteria in `spec.md`, tick each box T013/T014 observed,
      set `status: Implemented` on `spec.md`, `plan.md` and every `<svc>/plan.md`, and `status: Done`
      here. → T015
      *Done when:*
      `grep -n "^status" docs/spec/features/072-*/{spec,plan,tasks}.md docs/spec/features/072-*/*/plan.md`
      shows `Implemented`/`Done` everywhere, and any unobserved AC is named in the root `CLAUDE.md`
      Current state as not run.

## AC coverage

| AC | Task |
| :-- | :-- |
| AC-1 | T004 (registry values), T008 (render), T014 (live) |
| AC-2 | T008 (render + port swap), T014 (live, incl. reload) |
| AC-3 | T003 (`listLibrary` + mappers), T014 (live) |
| AC-4 | T003 (`findByTmdbId`), T014 (live) |
| AC-5 | T003 (`listPresentEpisodes`), T014 (live) |
| AC-6 | T003 (`createdMedia`), T010 (Plex film path), T011 (wiring), T014 (live) |
| AC-7 | T010 (Plex episode path), T011, T014 (live) |
| AC-8 | T001 (characterization), T010 (branch unchanged), T014 (live) |
| AC-9 | T003 (errors as outcomes), T014 (live) |
| AC-10 | T014 (live) — `notifyCreated`'s existing try/catch is untouched by T003 |
| AC-11 | T003 (fallback + log), T014 (live) |
| AC-12 | T009 (unit) |
| AC-13 | T014 (live) — the wholesale `deleteMany` in `MediaServerIndexService.rebuild` is untouched |
| AC-14 | T005, T007 (the two `schema.gql` diffs), T013 (the sweep) |

## Blocked

| Task | Service | What blocked it | Needs |
| :-- | :-- | :-- | :-- |

Contract problems always land here (Constitution, Article VIII): an agent that finds the GraphQL
delta wrong stops and reports, it does not amend the delta from inside its slice.
