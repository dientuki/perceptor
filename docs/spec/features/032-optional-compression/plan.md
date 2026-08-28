---
title: Optional compression — Implementation Plan
spec_version: 0.1.0
last_updated: 2026-08-28
status: Approved
---

# PLAN: Optional compression (`plan.md`)

## Approach

Three small slices, no new architecture. The flag is an ordinary settings row (`compression_enabled`,
`kind: 'boolean'`) that rides to the worker on a query it already makes, and the worker's skip path
goes behind the seam the worker already has for "how a job turns an input file into a library file".

- **`api`** adds one line to `SETTINGS_CATALOG` (`services/api/src/settings/settings.catalog.ts`), one
  row to `prisma/seeds/settings.ts`, and one field to the `base` object in
  `ProcessJobsService.getEncodeJobDetails` (`services/api/src/process-jobs/process-jobs.service.ts`).
  `SettingsService` is already injected there for `resolveOutputRoot`, and `getMap()` is already the
  house way to read a setting — nothing new is constructed, and no validation code is written:
  `updateMany`'s existing `kind === 'boolean'` branch already rejects anything but `"true"`/`"false"`
  with `error.setting.expected_boolean`.
- **`web`** swaps the checkbox in `CompressionPanel.tsx` for the new
  `src/components/form/switch/Switch.tsx`, keeps the panel's existing local `useState` as the single
  source of truth for "is compression on", feeds that state to the preset radios' already-supported
  `disabled` prop, and adds the hidden-input beside the control — the exact idiom
  `CheckboxField.tsx` uses for `movies_enabled`/`shows_enabled`, because both `Checkbox` and `Switch`
  are controls that render no `name`d input a `<form>` can read. `compression_enabled` joins
  `BOOLEAN_KEYS` in `src/actions/settings.ts` and is therefore always sent explicitly.
- **`worker`** adds a third implementation of the existing `EncodeFn` seam
  (`src/encode/types.ts`), alongside `encode.mock.ts` and `encode.ffmpeg.ts`. `services/worker/CLAUDE.md`
  is explicit that new encode behaviour goes behind that interface and never inline in a job handler,
  and this fits it exactly: same `(input, output, details, onProgress, onProbe)` signature, same
  `{ ffmpegCommand }` return, so `jobs/encode.job.ts` grows one branch choosing which function to call
  and nothing else about the handler moves.

Two alternatives were live and were rejected:

- **A per-job column on `ProcessJob`.** Rejected in the spec (REQ-6): resolving the flag when the
  worker asks for the job is what makes the switch affect already-queued work, and it keeps the
  `ProcessJob` row free for a future *per-title* override, which is the thing that genuinely needs
  storage.
- **Selecting the passthrough through `ENCODE_DRIVER`.** Rejected: `ENCODE_DRIVER` is a per-container
  environment choice (`mock` in dev, `ffmpeg` in prod) and the flag is a per-job, operator-set,
  database-backed decision. Overloading one onto the other would mean an operator's switch could be
  silently overridden by an env var — and per NFR-4 the invocation must stay identical on every host.
  The consequence, stated so no implementer treats it as a bug: with compression off the passthrough
  wins over `ENCODE_DRIVER=mock` too, and a dev stack files the real input file instead of the mock's
  copy. That is the honest behaviour.

## Order of Work

| Step | Service | Why it must come here |
| :-- | :-- | :-- |
| 1 | `api` | Owns the catalog key and the seeded row, and owns `EncodeJobDetails`. Neither consumer can be exercised end to end until the key can be stored and the field is on the wire. |
| 2 | `web` | Cannot save a key the server-side catalog rejects — `updateMany` throws `error.setting.not_editable` for an unknown key, so a `web`-first order fails on the first Save. |
| 2 | `worker` | Cannot select a field the schema does not have: `fetchGraphQL` throws on `json.errors`, so requesting `compressionEnabled` before step 1 fails every encode, not just the new path. |

Steps 2 and 3 are **genuinely parallel** once step 1 is merged: `web` writes only the setting,
`worker` reads only the job field, and they share nothing but the frozen delta in `../spec.md`. They
can also be *written* in parallel with step 1 — the contract is frozen — but neither can be *verified*
until `api` is running with the new field.

## Contract Freeze

The `## GraphQL Contract Delta` in `../spec.md` is frozen as of `status: Approved`. Implementers read
it; they do not edit it (Constitution, Article VIII). Things a slice will be tempted to change and
must not:

- **`compressionEnabled` is non-null (`Boolean!`).** From inside `worker` a nullable field looks
  safer. It is not: nullability would move the "what does absent mean" decision to the wire, where
  both services would answer it independently. The field is always present and always answered;
  `worker`'s `undefined` guard (NFR-2) exists for *version skew*, not for a legitimate null.
- **The key name is `compression_enabled`, the field name is `compressionEnabled`.** Snake in the
  settings row, camel on the GraphQL field, matching `movies_enabled`/`path_movies` and every existing
  field respectively. Neither side may "harmonize" them.
- **`ffmpegCommand: ""` on a skipped job.** From inside `api` an empty string looks like a bug worth
  defaulting away, and from inside `worker` a helpful string like `"skipped"` looks friendlier. Both
  are wrong: `""` is the value that distinguishes "not compressed" from "compressed by a command
  nobody recorded", and no `api` code may substitute for it.
- **The extension rule (REQ-10) is the worker's alone.** `buildOutputPath` keeps returning `.mkv`.
  `api` does not learn about containers, and nobody teaches `buildOutputPath` a second output format.
- **No new settings query for the worker.** `Query.settings` stays administrator-only.

## Migrations

**None.** No Prisma schema change: `compression_enabled` is a new **row** in the existing `Setting`
table, added by `prisma/seeds/settings.ts`, whose create-only loop (`findUnique` → `create`) never
overwrites a configured value on a later run.

Existing rows: untouched. Existing installs that never re-run the seed have no row at all, which
`getEncodeJobDetails` reads as `true` (REQ-7) — the same behaviour they have today. Reversibility:
deleting the row restores today's behaviour exactly; reverting the code is safe in any order, because
an `api` still sending the field to an older `worker` is ignored, and a `worker` selecting a field an
older `api` lacks fails loudly at the GraphQL layer rather than silently skipping compression.

## Risks

| Risk | How it fails | Mitigation |
| :-- | :-- | :-- |
| Version skew, or a field added to `EncodeJobDetails` but not to the worker's local type / query selection | `compressionEnabled` arrives `undefined`. Read as falsy, the worker stops compressing an entire library, and nothing about the resulting files says they were meant to be re-encoded — discovered months later, by disk usage | NFR-2: the worker branches on `=== false`, never on falsiness. Covered by a test in `encode.job.spec.ts`, the same defence `allowedLanguageTags` already has |
| A `.mp4` source filed under a `.mkv` name | The move succeeds, the job completes, the library looks right — and the media server chokes on a container that does not match its extension, or worse, plays it and fails on seek. No error in this pipeline, ever | REQ-10 + a pure `withSourceExtension` unit with its own spec file |
| Cross-filesystem move | `rename()` throws `EXDEV` (downloads on one disk, library on another is the *normal* deployment here, per `encode.ffmpeg.ts`'s own comment). Without a fallback every uncompressed job fails; with a naive fallback, a half-copied multi-GB file sits in the library under its final name | REQ-11: copy to a `.part` sibling in the destination, then `rename` (atomic within one filesystem), then unlink the source — the discipline `ffmpeg/runner.ts` already enforces. AC-7 exercises the failure |
| Saving Settings from another tab flips the key | `movies_enabled` has this exact scar: a boolean not sent explicitly is indistinguishable from "unchecked", so a save from the General tab would write `false` and silently disable compression for the whole install | REQ-2 + `BOOLEAN_KEYS`, plus AC-3, which saves from a tab the user never opened |
| Moved file keeps the source's mode | `rename`/`copyFile` preserve the source's permissions instead of respecting the worker's `umask(0o002)`, so a library file lands `644` where the encode path produces `664`. A media server running as another uid in the same group then cannot write its sidecars — it fails in *its* logs, not ours | The worker chmods the placed file to `0o664`, the same correction `encode.mock.ts` already applies after `copyFile` and for the same reason |
| The disabled preset radios only *look* disabled | REQ-3 satisfied visually but not functionally; a click still mutates state, which is harmless today (the presets persist nothing) and stops being harmless the moment a later spec wires them | `Radio` already takes `disabled` and guards its own `onChange`; pass the prop rather than styling around it |
| Cleanup fails on an already-moved input | `deleteInputFile` targets a path the move emptied. A throw here cannot fail the job (`cleanupSource` never rethrows) but would log a false alarm on every uncompressed job | `cleanupSource` already uses `rm(..., { force: true })`, which is a no-op on a missing path. Verified, not changed — REQ-14 is a "confirm it holds", not a code change |

## Verification

```bash
bin/cli api npx --no tsc --noEmit
bin/npm api run test
bin/cli worker npx --no tsc --noEmit
bin/npm worker test
bin/npm web run lint
bin/npm web run build
bin/cli web node scripts/check-messages.mjs
```

Then the database and the manual pass:

```bash
bin/dbreset
bin/mysql -e 'select `key`, value from Setting where `key`="compression_enabled"'
```

Manual, in order — this is the path through every acceptance criterion in `../spec.md`:

1. `/settings` → **Compresión**: the enable control is a sliding switch (AC-1). With it off, the three
   preset radios do not respond to a click and render disabled; toggle the switch on and they respond
   again, with no save and no reload.
2. Turn the switch off, **Save**, reload, reopen the tab — still off; the `Setting` row reads `false`
   (AC-2).
3. Switch to **General**, Save without opening the Compression tab, re-check the row — still `false`
   (AC-3).
4. Send `updateSettings` with `{ key: "compression_enabled", value: "maybe" }` as an administrator
   from `bin/bash api` — `error.setting.expected_boolean`, and the row is unchanged (AC-4).
5. With compression off, acquire a film whose source is an `.mp4`. Watch the worker log: no
   `[ffmpeg] ejecutando:` line. The file lands as `<library>/<Title> (<year>) [tmdbid=N]/<Title> (<year>).mp4`,
   same byte size as the source, source gone, torrent gone from qBittorrent, `ProcessJob` row
   `COMPLETED` / `progress=100` / empty `ffmpegCommand` (AC-5).
6. Repeat with a series source and check the `Season NN/<Title> SNNENN <Episode Title>.<ext>` layout,
   episode title from the api (AC-6).
7. `chmod 500` the destination title folder and run another uncompressed job: `FAILED` with
   `error.encode.move_failed`, source still in place, no file bearing the final name in the library
   (AC-7).
8. Turn compression back on, run the same job: an `ffmpegCommand` is recorded and the output is
   `.mkv` (AC-8).
9. Queue a job with compression on, `docker compose stop worker` before it starts, turn the switch
   off, start the worker — the job is filed without compression (AC-9).
