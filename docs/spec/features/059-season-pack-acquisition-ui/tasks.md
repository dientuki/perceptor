---
title: Season Pack Acquisition UI — Tasks
last_updated: 2026-09-16
status: Done
---

# TASKS: Season Pack Acquisition UI (`tasks.md`)

## Legend

| Marker | Meaning |
| :-- | :-- |
| `[api]` `[web]` | Which subagent owns the task. Exactly one per task. |
| `[docs]` | Documentation and the cross-service verification sweep. Owned by the orchestrator. |
| `[P]` | May run in parallel with the other `[P]` tasks in the same group. |
| `→ Tnnn` | Blocked by that task. |

`worker` is not in this feature. Its diff must stay empty (NFR-4); no task touches `services/worker/`.

## Tasks

### Group 1 — the contract and the status lift (`api`)

- [x] **T001** `[api] [P]` In `src/seasons/seasons.service.ts`, add `addTorrentToSeason(seasonId,
      { infoHash, urls, releaseTitle, force }, userId)`, twin of
      `EpisodesService.addTorrentToEpisode`: `infoHash ?? (await resolveInfoHash(urls))`, then the
      existing private `attachTorrentSource` with `kind: 'TORRENT_SEARCH'` (unchanged). In
      `src/seasons/seasons.resolver.ts`, add the `addTorrentToSeason` mutation, twin of
      `EpisodesResolver.addTorrentToEpisode`, description
      `Envía un release elegido a qBittorrent y lo asocia a la temporada`, no `@AllowService()`. In
      `src/seasons/seasons.service.spec.ts`, add: a null `infoHash` whose resolution throws rejects
      with no `qbittorrent.add` call and no `mediaSource` write; a supplied `infoHash` creates the
      source with `seasonId` and `kind: 'TORRENT_SEARCH'`. See `api/plan.md` steps 1–2.
      *Done when:* `bin/cli api npx --no tsc --noEmit` reports 0 errors; after the dev server
      regenerates it, `git diff services/api/src/schema.gql` shows exactly one added mutation,
      `addTorrentToSeason(seasonId: Int!, infoHash: String, urls: [String!]!, releaseTitle: String, force: Boolean = false): Season!`
      (plus its description); `bin/npm api test` passes with the new cases counted.
- [x] **T002** `[api] [P]` In `src/pipeline-status/pipeline-status.ts`, add a pure exported predicate
      taking the season's sources (`{ status: SourceStatus }[]`), the episode's
      `releaseDate: Date | null` and `now: Date`: true iff some source is neither `ERROR` nor
      `SCANNED`, and `releaseDate !== null && releaseDate <= now`. `deriveTitleStatus` is not modified.
      In `pipeline-status.spec.ts`, a new `describe` with its Article IX header: each of
      `PENDING`/`QUEUED`/`PAUSED`/`DOWNLOADING`/`READY` lifts; `SCANNED`, `ERROR` and no sources do
      not; future and null `releaseDate` do not; `releaseDate` equal to `now` does. See `api/plan.md`
      step 3.
      *Done when:* `bin/npm api test` passes with the new cases counted, and removing the `SCANNED`
      exclusion makes at least one case fail (fault injection, reverted).
- [x] **T003** `[api]` In `src/shows/shows.service.ts`, add
      `mediaSources: { where: { status: { not: 'ERROR' } } }` at the season level of the include in
      both `findOneFromDb` and `setContentKind`, and replace their two identical episode-status
      mappings with one private method that feeds `deriveTitleStatus` an extra `{ status: 'QUEUED' }`
      source when T002's predicate holds (one `new Date()` per call). No write to `Episode.status`
      anywhere; `DownloadsService`, `MediaSourcesService` and `prisma/` untouched. In
      `shows.service.spec.ts`'s `findOneFromDb` block: aired `MISSING` episode under a `DOWNLOADING`
      season source reads `QUEUED`; future-dated reads `MISSING`; `COMPLETED` stays `COMPLETED`;
      stored `ERROR` stays `ERROR`; a `SCANNED` season source lifts nothing; the season include
      carries the filtered `mediaSources`. See `api/plan.md` step 4. → T002
      *Done when:* `bin/cli api npx --no tsc --noEmit` reports 0 errors, `bin/npm api test` passes
      above 517/46, `git status --short services/api/prisma` is empty, and
      `git diff --stat services/api/src/downloads services/api/src/media-sources` is empty.

### Group 2 — consumers (`web`)

The contract is frozen in `spec.md`. T004/T005 touch no GraphQL document and run beside Group 1;
T006 onward sends `addTorrentToSeason` and waits for T001.

- [x] **T004** `[web] [P]` In `src/types/media.ts`, add the `"season"` branch to `AcquisitionTarget`
      (`season: Season` from `@/actions/shows`, `showTitle`, `audioMandatory`, `audioLanguages`),
      export `FileAcquisitionTarget = Exclude<AcquisitionTarget, { kind: "season" }>`, and — after
      confirming by grep that no caller reads `id`/`status` off a success — narrow
      `AcquisitionResult`'s success branch to `{ success: true }`. Create
      `src/lib/acquisition-target.ts` with `isAcquisitionTargetCompleted(target)` and the target
      label builder (season label formatter passed in), exhaustive `switch`, no `default`. Switch
      `importFileModal.tsx` and `createUploadTicketAction` (`src/actions/uploads.ts`) to
      `FileAcquisitionTarget`, and replace the local label/completed ternaries in `importFileModal.tsx`
      and `SearchTorrentModal.tsx` with the helpers. `SearchTorrent.tsx`/`importMagnetModal.tsx` may
      get only the minimum needed to compile here (T007 gives them their season branch). See
      `web/plan.md` steps 1–3, 5–6.
      *Done when:* `bin/cli web npx --no tsc --noEmit` reports 0 errors and
      `bin/npm web run lint` is clean on the touched files.
- [x] **T005** `[web] [P]` Add under `errors` in `messages/en.json` and `messages/es.json`:
      `season.not_found` (`Season {id} does not exist` / `La temporada {id} no existe`),
      `magnet.already_attached`, `magnet.not_a_magnet`, `magnet.invalid_infohash`,
      `magnet.v2_unsupported` — English copied from `services/api/src/i18n/messages.en.ts` with the
      same `{param}` names, Spanish in the existing Rioplatense register. See `web/plan.md` step 11.
      *Done when:* `bin/cli web node scripts/check-messages.mjs` reports no `en`/`es` drift.
- [x] **T006** `[web]` In `src/actions/shows.ts`, add `addTorrentToSeasonAction(seasonId, infoHash,
      urls, releaseTitle, force)` (`infoHash` sent as `string | null`, no `?? ''`) and
      `addMagnetToSeasonAction(seasonId, magnet, force)`, twins of the episode actions, documents
      selecting only `id`, returning `AcquisitionResult` via `toActionError`/
      `redirectIfUnauthenticated`. See `web/plan.md` step 4. → T001, T004
      *Done when:* `bin/cli web npx --no tsc --noEmit` reports 0 errors, and both mutation documents
      match the argument lists in `spec.md` § GraphQL Contract Delta character for character.
- [x] **T007** `[web]` In `src/components/search/SearchTorrent.tsx`: season prefill
      `${cleanShowTitle} S${pad(seasonNumber)}`; `titleAudio`/`preferredGroups` treat `"season"` like
      `"episode"`; `submitTorrent` calls `addTorrentToSeasonAction`; `isCompleted`/label via the
      helpers. In `src/components/import/importMagnetModal.tsx`: season branch calls
      `addMagnetToSeasonAction`; `isCompleted`/label via the helpers. Replace flow and
      `ALREADY_COMPLETED_KEYS` unchanged. See `web/plan.md` steps 7–8. → T006
      *Done when:* `bin/cli web npx --no tsc --noEmit` reports 0 errors and
      `grep -n 'kind === "movie"' services/web/src/components/search/SearchTorrentModal.tsx services/web/src/components/import/importFileModal.tsx`
      prints nothing (labels go through the helper).
- [x] **T008** `[web]` Create `src/components/shows/SeasonAcquisitionButtons.tsx` (one component:
      search, **disabled** import-file with no handler, magnet — same order, icons, sizes and title
      keys as `EpisodeRow`). In `src/components/shows/SeasonAccordion.tsx`, replace `activeEpisode`
      with `activeTarget: AcquisitionTarget | null` set by the episode handlers and two new season
      handlers, pass `activeTarget?.kind === "season" ? null : activeTarget` to `ImportFileModal`, and
      restructure the header so the toggle `<button>` and `<SeasonAcquisitionButtons>` are siblings,
      never nested. Add no other component to `SeasonAccordion.tsx`. See `web/plan.md` steps 9–10.
      → T007
      *Done when:* `bin/cli web npx --no tsc --noEmit` reports 0 errors, `bin/npm web run build` exits
      0, `grep -cE "^(export default )?function [A-Z]" services/web/src/components/shows/SeasonAcquisitionButtons.tsx`
      prints `1`, and on `/shows/<id>` each season header shows the three buttons with import-file
      disabled and a click on search/magnet opening its modal without toggling the accordion (AC-1).

### Group 3 — verification and docs

- [x] **T009** `[docs]` Cross-service verification sweep: run `plan.md` § Verification
      (both typechecks, `bin/npm api test`, `bin/npm web run lint`, `check-messages`,
      `bin/npm web run build`, `git status --short services/api/prisma`,
      `git diff --stat services/worker`, `git diff services/api/src/schema.gql`), then the manual pass
      for AC-1 through AC-9 in `plan.md`'s list. Record each result; a failed AC goes to § Blocked with
      the owning service, it is not fixed from here. → T003, T005, T008
      *Done when:* every command matches its expected output in `plan.md` and AC-1…AC-9 are each
      observed in the running stack, or listed under § Blocked.
- [x] **T010** `[docs]` In `docs/spec/graphql-contract.md`, add a `059-season-pack-acquisition-ui`
      section: the `addTorrentToSeason` SDL and its error table (pointing at `spec.md`), `web` as the
      first consumer of `addMagnetToSeason`, `Episode.status` now able to read `QUEUED` with no source
      or job of its own and why (read-time lift, never stored), consumer obligations. Amend `013`'s
      "has no web UI by design" sentence to point at `059`. → T001, T003
      *Done when:* the section's SDL matches the final `schema.gql` line for `addTorrentToSeason`
      exactly.
- [x] **T011** `[docs]` Update `CLAUDE.md` files: root — remove the "season pack is api-only" gap,
      extend the **Find release** and **Download** rows (season search/magnet from `web`, `059`) and
      the **Browse library** row (episodes read `QUEUED` under an in-flight pack), append a Current
      state entry with the numbers T009 measured; `services/api/CLAUDE.md` — `seasons/` now two
      mutations and "No web UI by design" removed, `pipeline-status/` gains the season-pack lift and
      `ShowsService`'s single episode-status mapper; `services/web/CLAUDE.md` — `AcquisitionTarget`
      section with the `"season"` branch, `FileAcquisitionTarget`, `src/lib/acquisition-target.ts`,
      and the `/shows/[id]` paragraph's season header buttons. → T009
      *Done when:* `grep -n "api-only" CLAUDE.md` prints nothing and
      `grep -n "No web UI by design" services/api/CLAUDE.md` prints nothing.
- [x] **T012** `[docs]` Walk the acceptance criteria in `spec.md` against T009's record, tick each
      box (and each REQ/NFR box), set `status: Implemented` on `spec.md`, `plan.md`, `api/plan.md`,
      `web/plan.md`, and `status: Done` here. → T009, T010, T011
      *Done when:* `grep -n "\- \[ \]" docs/spec/features/059-season-pack-acquisition-ui/spec.md`
      prints nothing and every `status:` in the feature reads `Implemented`/`Done`.

## Blocked

| Task | Service | What blocked it | Needs |
| :-- | :-- | :-- | :-- |
| ~~AC-9 (partial)~~ **RESOLVED 2026-09-17** | web | `services/web/src/lib/graphql-error.ts`'s `translateGraphQLError` did `JSON.parse(rawParams)`, but `api`'s `i18nError.*` factories (`services/api/src/i18n/i18n-error.ts`) attach `extensions.i18n.params` as a raw JS object, never `JSON.stringify`'d. `JSON.parse` on a non-string threw, so **every** keyed error that carried params (`error.season.not_found` `{id}`, `error.magnet.already_attached` `{title}`) silently fell back to the English `message` regardless of UI locale — confirmed live on both the season path (this feature) and the pre-existing movie path (`addMagnetToMovie`), so it predated `059` and was not a regression it introduced. A param-less key (`error.magnet.not_a_magnet`, tested live in `es`) translated correctly. | Fixed directly (no `060` spec needed per Article VII — single file, single service, no schema/contract change; `docs/spec/graphql-contract.md`'s error envelope example and `importFileModal.tsx`'s REST-path reading of the same shape both already treated `params` as a plain object, confirming `graphql-error.ts` was the sole outlier): `GraphQLErrorLike.params` retyped to `Record<string, unknown>`, `JSON.parse` removed. Re-verified live in `es`; typecheck/lint/build all clean. |
