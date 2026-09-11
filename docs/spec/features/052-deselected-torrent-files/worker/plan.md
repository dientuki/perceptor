---
title: Deselected torrent files must never be encoded — worker slice
service: worker
last_updated: 2026-09-10
status: Approved
---

# PLAN: Deselected torrent files must never be encoded — `worker` (`worker/plan.md`)

## Scope

The worker owns the *use* of the fact `api` hands it: assembling each enumerated file's path against
the list of downloaded files, narrowing the candidate set before the existing selection rules run, and
reporting a per-file `isDownloaded` flag back with the inventory. Everything happens between
`scanFolder` and `selectMatches` in `src/jobs/source-ready.job.ts`.

The worker does **not** talk to qBittorrent — it has no torrent client and must not grow one
(Constitution, Article II); it reads `downloadedFiles` off the `mediaSource` query it already runs. It
does not decide what an empty match set means: it keeps reporting `matches: []` and `api` picks the
error key (`../api/plan.md`). It does not change any selection rule, any FFmpeg behaviour, or anything
under `src/ffmpeg/` (that territory belongs to the `ffmpeg` agent).

Writes are confined to `services/worker/` and this directory. Anything else is a stop-and-report.

## Files

| File | New / Modified | What changes |
| :-- | :-- | :-- |
| `services/worker/src/scan/mark-downloaded.ts` | New | `InventoriedFile` type + `markDownloaded(files, downloadedFiles, downloadPath)`. |
| `services/worker/src/scan/mark-downloaded.spec.ts` | New | the cases under § Tests. |
| `services/worker/src/scan/select-matches.ts` | Modified | takes `InventoriedFile[]`; the candidate filter becomes `isVideo && isDownloaded`. |
| `services/worker/src/scan/select-matches.spec.ts` | Modified | fixtures gain `isDownloaded`; one new narrowing case. |
| `services/worker/src/jobs/source-ready.job.ts` | Modified | query + local type gain `downloadedFiles`; `markDownloaded` between scan and select; the reported `files` carry `isDownloaded`; the log line. |

`src/scan/scan-folder.ts` is **not** on this list and must not change: it enumerates what is on disk
and knows nothing about torrents (see its header comment, and `../plan.md` § Approach).

## Existing code to reuse

- `src/scan/scan-folder.ts` — `ScannedFile` is the input type `InventoriedFile` extends. Import it;
  do not redeclare its fields.
- `src/paths/is-inside-root.ts` and `src/metadata/container-tags.ts` — the house pattern the new module
  copies: one small pure module, local types, no I/O, its own spec, imported by the job handler rather
  than reaching outward itself.
- `src/scan/select-matches.ts` — both selection rules stay exactly as they are; only the line that
  filters `files` to `videos` changes. Do not touch the `single` reduce or the `bestByEpisode` map.
- `src/jobs/source-ready.job.ts` — the existing `MediaSourceQueryResult` local type, the existing
  `skipped` computation and its `[source-ready] <id>:` log lines are extended in place.
- `node:path`'s `join`/`normalize` — no new dependency for path assembly.

## Steps

1. **`src/scan/mark-downloaded.ts`** — export
   `type InventoriedFile = ScannedFile & { isDownloaded: boolean }` and
   `markDownloaded(files: ScannedFile[], downloadedFiles: string[] | null, downloadPath: string): InventoriedFile[]`.
   - `downloadedFiles === null` → every file `isDownloaded: true` (REQ-4). This is the only branch a
     non-torrent source ever reaches.
   - otherwise → build a `Set` of `normalize(join(downloadPath, entry))` for each entry, and flag each
     file by whether `normalize(file.filePath)` is in it. Normalising **both sides** is what makes a
     `./`-prefixed or double-slashed entry from the client match the absolute path `scanFolder`
     produced.
   - The function is pure: no `fs`, no logging, no `api` call.
2. **`src/scan/select-matches.ts`** — change the parameter to `InventoriedFile[]` and the first line to
   `files.filter((file) => file.isVideo && file.isDownloaded)`. Keep everything below it untouched.
   Taking the narrower type (rather than an optional extra argument) is deliberate: a call site that
   forgets to mark the files fails to compile instead of silently selecting a placeholder.
3. **`src/jobs/source-ready.job.ts`** —
   - add `downloadedFiles` to the GraphQL query **and** to `MediaSourceQueryResult` as
     `downloadedFiles: string[] | null` — both in the same edit. There is no codegen across this seam;
     a field in one and not the other is the standing silent failure this service's `CLAUDE.md` warns
     about.
   - after `scanFolder`, call `markDownloaded(files, mediaSource.downloadedFiles, mediaSource.downloadPath)`
     and pass the result to `selectMatches`.
   - send the marked files as the `files` argument of `sourceScanned` — every file, including the ones
     flagged `false` (REQ-5). The extra `isDownloaded` key rides along on the same objects; do not
     build a second array.
   - logging: keep the existing count line, add one line stating whether narrowing was applied and
     with how many entries — e.g.
     `[source-ready] <id>: el cliente de torrents reportó N archivo(s) bajado(s)` versus
     `[source-ready] <id>: sin información de archivos bajados — se consideran todos`. This line is
     what AC-5 (client outage) and AC-1 are read from, so it must print on **both** paths. Match the
     surrounding Spanish log prose in this file — comments and identifiers stay English (Article VI).
   - distinguish the existing "archivo de video no resuelto" line from a file skipped because it was
     never downloaded, so a human reading the log sees which of the two happened.

## Contract obligations

From `../spec.md` § GraphQL Contract Delta, read-only. The worker consumes:

- **`MediaSource.downloadedFiles: [String!]`** — paths **relative to `downloadPath`**; the worker owns
  the join. `null` means *unknowable* (not a torrent, unknown hash, client unreachable) and must be
  treated as "no narrowing", never as "nothing was downloaded". `[]` means the client answered and
  nothing is downloadable — every video is flagged `false`, `matches` comes out empty, and `api` fails
  the source; the worker itself reports no error and throws nothing.
- **`SourceFileInput.isDownloaded: Boolean!`** — required on every entry of the `files` argument. A
  payload missing it is rejected by `api`'s `ValidationPipe` and `fetchGraphQL` throws, failing the
  job — which is the intended loud failure, not something to catch.

The worker adds no new error key and transcribes none: the REQ-7 key is stored by `api` on the row and
never travels back as a GraphQL error, so `src/i18n/error-keys.ts` is untouched.

## Tests

- `src/scan/mark-downloaded.spec.ts` (new) — defends the path assembly, which fails silently and
  totally (`../plan.md` § Risks):
  - `null` list → every file flagged downloaded, including non-video files.
  - a list naming one of two videos → exactly that one flagged, the other `false`, both still returned.
  - an entry inside a nested folder (`Release.Name/file.mkv`) joined against the `downloadPath`
    matches the absolute path `scanFolder` would have produced.
  - a list matching nothing → every video flagged `false` (the input to `api`'s REQ-7 branch).
  - `[]` behaves as "nothing downloaded", **not** as `null`.
- `src/scan/select-matches.spec.ts` (modified) — existing fixtures gain the flag; add the AC-7 case:
  two videos where the **larger** is `isDownloaded: false` and the smaller `true`, asserting the
  smaller is selected. Verify it fails when the `isDownloaded` term is removed from the filter, per the
  house fault-injection technique; the same case in `season` mode is worth having, since the
  `bestByEpisode` map has its own size comparison.

Not owed: `src/jobs/source-ready.job.ts` itself. It has no spec today, mocking `fetchGraphQL` for the
whole handler is a larger lift than this feature, and both rules it now composes are covered as pure
functions above. This is an accepted risk, recorded in `../plan.md` § Risks — AC-2's
`has_unmatched_files = 0` is the end-to-end check that the flag actually reached `sourceScanned`.

## Done when

```bash
bin/cli worker npx --no tsc --noEmit
bin/npm worker test
bin/npm worker run build
```

0 typecheck errors, `build` exits 0, and the suite shows only the **two pre-existing, unrelated**
failures recorded in the root `CLAUDE.md` § Current state (`ffmpeg/2.json`'s stale track-title string
and `buildCommand.spec.ts`'s CRF mismatch). Both live in `src/ffmpeg/` — the `ffmpeg` agent's
territory, out of scope here. A third failure is this slice's.
