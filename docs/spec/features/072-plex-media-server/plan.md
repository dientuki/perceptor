---
title: Plex media server client — Implementation Plan
spec_version: 0.2.0
last_updated: 2026-09-26
status: Implemented
---

# PLAN: Plex media server client (`plan.md`)

## Approach

This feature is two seams, not one, and the whole plan hangs on keeping them apart.

**The client seam already exists and is reused as-is.** `services/api/src/clients/media-server/registry.ts`
maps an id to a `MediaServerFactory`; `types.ts` declares the five-method `MediaServerClient` port.
A new `clients/media-server/plex.ts` implements that port and the registry gains its entry. Nothing
downstream is touched: `MediaServerService.notifyCreated`, `MediaServerReconcileService` (all four
of `reconcileMovie`/`reconcileShow`/`syncMovie`/`syncShow`), `MediaServerIndexService.rebuild` and
`SettingsResolver`'s rebuild trigger all call `createMediaServerClient` and never learn which
client came back. `MediaServerConfig` (`host`/`port`/`apiKey`) already fits Plex unchanged — its own
comment says so. The shared index is reused rather than bypassed: Plex has no dependable
server-side filter by external GUID, so `plex.ts` implements `listLibrary` and delegates
`findByTmdbId` to the injected `MediaServerIndexPort`, exactly as `jellyfin.ts` does.

**The layout seam is new, and it is deliberately not the client seam.** The worker must not learn
the roster of media servers (NFR-3). So the registry declares a `layout` per entry, `api` resolves
that one string onto `EncodeJobDetails.libraryLayout` inside the existing
`ProcessJobsService.getEncodeJobDetails` — beside `compressionResolution` and
`allowedSubtitleFormats`, off the same `SettingsService.getMap()` call, with no second settings read
— and the worker selects a path builder from a value it treats as opaque data. Two clients may
declare the same layout; that is the mechanism that makes a future Emby entry one line in `api` and
zero lines in the worker.

The alternative considered and rejected was sending rendered naming tokens (`titleIdTag`,
`idTagInFilename`). It is more abstract, but every future divergence between servers — episode
separator, specials folder, id position — adds another field, and the contract drifts into a
template language. A layout is a cohesive whole; naming it is honest.

In the worker, `paths/build-output-path.ts` is **split, not duplicated**. `sanitize()`, `pad2()`
and the `(0000)` year fallback are shared by both layouts; only the folder tag and the episode
filename differ. `buildOutputPath` keeps its exported signature and its `OutputPathInput` type
(widened by one field) so `jobs/encode.job.ts`'s single call site and `withSourceExtension`'s
contract are unchanged.

In `web`, the Settings combo already renders from `mediaServerClients` and never hardcodes ids —
that stays. Three fields are added to the query and `MediaServerFields.tsx` reads them. One real
change of shape: the port input becomes **controlled**, because REQ-3 makes its value depend on the
combo. Per `services/web/CLAUDE.md`, a controlled input in this service is a raw `<input>` with
`InputField`'s Tailwind classes copied in, following `components/settings/PathPicker.tsx` — not
`components/form/input/InputField`, whose props accept `defaultValue` and not `value`.

## Order of Work

| Step | Service | Why it must come here |
| :-- | :-- | :-- |
| 0 | `worker` | Characterization test for the **current** `buildOutputPath`. It has no test today (only a mock in `encode.job.spec.ts`), and REQ-16 freezes its output byte-for-byte. Writing it before the split is the only thing that can catch a Jellyfin-path regression |
| 1 | `api` | Owns both halves of the contract — `MediaServerOption`'s three fields and `EncodeJobDetails.libraryLayout` — plus the registry the layout is declared in |
| 2 | `web` | Cannot select fields the schema does not expose yet |
| 2 | `worker` | The layout split itself; needs the field name (frozen in `spec.md`), not `api`'s code |

**Step 0 runs first and alone.** It is a safety net for step 2, and it is cheap.

**Steps 2 run in parallel.** `web` and `worker` share no file and no type; the contract between them
and `api` is frozen at `status: Approved`. They may both start as soon as `api` has regenerated
`schema.gql`, and `worker` may in fact start earlier — it consumes a field name, not an
implementation.

## Contract Freeze

The `## GraphQL Contract Delta` in `../spec.md` is frozen as of `status: Approved`. Three things an
implementer will be tempted to change and must not:

- **`libraryLayout` is `String!`, not a GraphQL enum.** From inside `api` an enum looks obviously
  right — the values are closed and the registry knows them. It is wrong for the same reason
  `compressionResolution` is a string (`058`): there is no codegen, and a third layout added later
  must reach an older worker as an unrecognised value it degrades on (REQ-18), not as a
  serialization error that fails the whole `processJob` query and with it the encode.
- **`MediaServerOption.defaultPort`/`credentialLabel`/`credentialHelpUrl` are nullable.** From inside
  `web` they look like they should be required — every real client has them. `none` is a real row of
  that list and has none of them; making them non-null forces a fake port onto "Ninguno".
- **`libraryLayout` is resolved at query time, never written onto the `ProcessJob` row.** From inside
  `api` snapshotting it at enqueue looks safer. It is the opposite: `054`'s crash recovery and
  BullMQ's retry both re-read the details, and a snapshot would file a recovered job under the layout
  of a media server the admin has since replaced.

If the contract has to change mid-flight: stop, amend `spec.md`, re-approve, re-brief all three
services (Constitution, Article VIII).

## Migrations

None. No Prisma model, field or enum changes; `MediaServerItem.externalId` is already an opaque
string and holds a Plex `ratingKey` unchanged. `git status --short services/api/prisma` must stay
empty, with one permitted exception: nothing. The `media_server_*` seed rows are not touched either
(NFR-2, NFR-4) — the seeded port stays `8096` and the seeded client stays `none`.

Reversibility: total. Rolling back the images restores the previous behaviour with no data to undo;
files already written under the Plex layout keep their names and are matched by Plex, which is the
point of writing them that way.

## Risks

| Risk | How it fails | Mitigation |
| :-- | :-- | :-- |
| The layout split silently changes Jellyfin paths | An existing installation starts filing under a subtly different folder name — a stray space, a lost `(0000)`, an unpadded season. Both the old and new files exist, both play, nothing errors; the library just quietly forks in two | Step 0's characterization test, written against the current implementation **before** the split, pinning the real-library cases already documented in the file (`Alita: Battle Angel`, `X-Men: First Class`, `Lisey's Story`). AC-8 re-checks it live |
| `worker` never selects `libraryLayout` | The field exists, `api` sends it, the query does not ask for it → REQ-18's fallback fires on every job and every Plex user silently gets Jellyfin paths. No error anywhere; the log line is the only trace | The field must be added to **both** the local `EncodeJobDetails` type and the `processJob` selection set in `src/jobs/encode.job.ts` in the same edit — the standing rule in `services/worker/CLAUDE.md`. AC-6/AC-7 are live checks that cannot pass if the selection is missing |
| A dropped TMDB GUID | A film Plex holds resolves to no `externalId`, the title reads `MISSING` forever and Perceptor re-downloads something already in the library. An empty index is also the correct output for an empty library, so nothing distinguishes the two | Unit tests on the GUID extractor covering both shapes (REQ-9) and the no-id case, in the style of `jellyfin.spec.ts`'s header. AC-3 compares the item count against the real library |
| The section-for-path choice picks the wrong section | Plex scans a folder that does not contain the new file; the file never appears, the encode reported success, no error anywhere | Unit test on the pure chooser: longest-prefix wins, a shared-prefix sibling (`/media/movies-4k` vs `/media/movies`) does not match, no match returns null. Same class of bug `is-inside-root.spec.ts` already defends in the worker |
| Present-episode filter too loose | A series Plex lists but holds no files for reads fully `COMPLETED`, and every episode is silently skipped forever. This is the exact bug `034` hit with Jellyfin's virtual episodes | Unit test on the pure mapper (REQ-11): no `Part`/file → not present, missing `parentIndex`/`index` → not present |
| Plex answers XML | Without `Accept: application/json` the body is XML, `JSON.parse` throws, the rebuild lands in `failed` | Loud enough to notice, and REQ-5 makes the header part of the contract; the client's own tests assert the request headers |
| Token leaks into a log or URL | A `X-Plex-Token=` query string in an error message ends up in `docker compose logs` | REQ-5 puts the token in a header only; error messages quote status and body, never the request URL — the same shape `jellyfin.ts` already uses |

## Verification

```bash
bin/cli api npx --no tsc --noEmit
bin/npm api test
bin/cli worker npx --no tsc --noEmit
bin/npm worker run build
bin/npm worker test
bin/cli web npx --no tsc --noEmit
bin/npm web run build
bin/cli web node scripts/check-messages.mjs
git status --short services/api/prisma   # must be empty
git diff --stat services/api/src/schema.gql
```

The `schema.gql` diff must be exactly the three nullable fields on `MediaServerOption` plus
`libraryLayout: String!` on `EncodeJobDetails` (AC-14).

Then the manual pass, which is the only thing that can prove the two seams meet:

1. Settings → Media server: the combo lists Ninguno / Jellyfin / Plex. Select Plex — the port becomes
   `32400` and the credential reads `Plex token` with a link. Select Jellyfin — `8096` and `API key`.
   Save, reload, confirm the saved port survives (AC-1, AC-2).
2. With a real Plex, host and token filled: press Re-sync, watch it reach `Actualizada`, then
   `bin/mysql -e 'select mediaType, count(*) from MediaServerItem group by mediaType'` against what
   Plex shows (AC-3).
3. Register a film Plex already holds → `COMPLETED`, no download (AC-4). Register a partially-held
   series → only the episodes with files are `COMPLETED` (AC-5).
4. Run one film encode and one episode encode to completion, then `ls` the destinations root: the
   `{tmdb-…}` folder and filename for the film, `Season 01/Show - S01E02 - Title.mkv` for the
   episode, and both visible in Plex without a manual scan (AC-6, AC-7).
5. Switch the client to Jellyfin (or `none`) and run one more encode of each: the paths must be the
   `[tmdbid=…]` ones (AC-8).
6. Failure pass: wrong token → Re-sync leaves `Última sincronización fallida` and the row count
   unchanged (AC-9). Stop Plex → an encode still completes with one `[media-server]` log line and no
   `encodeFailed` (AC-10). A destinations root outside every Plex library location → the full-refresh
   fallback plus its log line (AC-11). A `libraryLayout` of `not-a-layout` (forced through the
   worker's unit test, not a live stack) → Jellyfin path plus a log line (AC-12).
