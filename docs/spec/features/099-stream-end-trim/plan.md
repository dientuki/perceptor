---
title: Stream-End Trim — Implementation Plan
spec_version: 0.1.0
last_updated: 2026-10-19
status: Approved
---

# PLAN: Stream-End Trim (`plan.md`)

## Approach

The feature rides the path `098`'s `dub_trim_enabled` cut through all three services a few hours
earlier, so everything but the analysis itself copies a pattern that exists today, beside its twin:

- **`api`** adds a `kind: 'boolean'` entry to `src/settings/settings.catalog.ts`, a create-only
  `"false"` seed row in `prisma/seeds/settings.ts`, and one field on `EncodeJobDetails`
  (`src/process-jobs/entities/encode-job-details.entity.ts`) filled in
  `ProcessJobsService.getEncodeJobDetails()` from the `settingsMap` it already reads, next to
  `dubTrimEnabled`. No migration.
- **`web`** adds one `Switch` + hidden input to `CompressionPanel.tsx` right after the dub-trim
  switch, wires the initial value through `SettingsForm.tsx`, adds the key to `BOOLEAN_KEYS` in
  `src/actions/settings.ts`, and one label to `messages/{en,es}.json`.
- **`worker`** owns the analysis. A new `src/encode/stream-end-trim.ts` follows `dub-trim.ts`'s
  shape — pure, tested rule functions, one AbortSignal-aware probe, a resolver called from
  `encode.ffmpeg.ts` — with three deliberate reuses instead of second copies:
  1. **The spawn.** `src/ffmpeg/capture.ts`'s `runFfmpegCapture` (extracted by `098`) gains the
     ability to run `ffprobe` and keep its stdout, instead of a second spawn-and-kill helper.
  2. **The audio selection.** Which audio tracks "the encode keeps" (spec REQ-7) is decided today
     inside `getAudioParams` (`src/ffmpeg/params.ts`), interleaved with building the arguments.
     That selection is **extracted** into an exported function both `getAudioParams` and the new
     module call, so the trim can never measure a different set of tracks than the encode maps.
  3. **The cut.** `buildFfmpegCommand` already takes `trimAt: number | null` and folds it into the
     single `-t`; `encode.ffmpeg.ts` already folds `trimAt` into the progress denominator. The new
     cut and `098`'s are combined with `min` before that call (spec REQ-10); neither the signature
     nor the progress code changes.

Alternatives considered and rejected:

- **Reading per-track ends from the `getMetadata()` JSON already in hand** (`tags.DURATION`, stream
  `duration`) — free, but spec REQ-6 forbids it: Voltron's NTb source has no per-track tag at all,
  and tags were wrong on files MediaInfo misread. The probe reads packet timestamps instead.
- **One ffprobe per stream** — the probe reads every stream's packets in one demux of the window and
  filters by `stream_index`; a second pass doubles the I/O for nothing.
- **Folding this into `098`'s detector** — different cause, different signal, different switch; the
  spec keeps them independent, and `dub-trim.ts` decodes video while this decodes nothing.
- **Deciding in `api`** — it never reads media.

The analysis lives in the encode driver, not in `encode.job.ts`, so the passthrough path
(`compression_enabled` off) can never reach it — the same structural guarantee `098` relies on.

## Order of Work

| Step | Service | Why it must come here |
| :-- | :-- | :-- |
| 1 | `api` | Exposes `EncodeJobDetails.streamEndTrimEnabled` and makes the Setting editable — `SettingsService.updateMany` refuses an unknown key with `error.setting.not_editable`, which fails the **whole** Compression tab's save. |
| 2a | `web` | Writes the Setting through the existing `updateSettings`; needs step 1's catalog entry. |
| 2b | `worker` | Reads the field; until `api` ships it the value is `undefined`, which NFR-2 reads as off. The extraction refactors and the pure module touch nothing of `api`'s and can start before step 1 lands; only the query edit waits. |
| 3 | `docs` | `docs/spec/graphql-contract.md`'s `EncodeJobDetails` block gains the field; root and `worker` `CLAUDE.md` gain one sentence each in the Transcode row / encode section. |

2a and 2b run fully in parallel once step 1 is merged.

## Contract Freeze

The `## GraphQL Contract Delta` in `spec.md` is frozen as of `status: Approved`. Things an
implementer will be tempted to change and must not:

- **`streamEndTrimEnabled` is not ANDed with `compressionEnabled` in `api`.** It is the raw setting;
  the worker gates it on its own `compressing` flag, as it does `dubTrimEnabled`.
- **No shared "trim mode" enum merging this switch with `dub_trim_enabled`.** Two independent
  booleans; the spec says so (REQ-10).
- **No error key for an analysis failure, and none for REQ-9's out-of-window keep.** Both are
  worker-local log outcomes (NFR-1, REQ-13). Reporting a broken source is explicitly out of scope.
- **`web` does not select `EncodeJobDetails.streamEndTrimEnabled`.**

If the contract has to change mid-flight: stop, amend `spec.md`, re-approve, re-brief `api`, `web`
and `worker` (Article VIII).

## Migrations

None. `stream_end_trim_enabled` is a `Setting` row created by the production seed as `"false"`,
create-only. An install that has not reseeded reads the row as absent, which REQ-2 defines as off.
Rolling back leaves an unused row behind, harmless.

## Risks

| Risk | How it fails | Mitigation |
| :-- | :-- | :-- |
| The trim measures a different audio set than the encode maps | A dropped long dub keeps a file whole that should be cut, or a kept track gets cut mid-sentence; no error anywhere | Selection extracted and shared, never re-implemented (Approach §2); a test where a dropped track is the longest (NFR-5); AC-3 |
| A damaged source is cut to its shortest track | The Darkest Hour shape: an 89-min film written as 44 min, silently | REQ-9 guard — no packet in the 300 s window means keep; test + AC-5 |
| Track end read from tags/container instead of packets | Voltron's NTb source (no tags) is kept whole; a wrong tag cuts real content | Probe reads `pts_time + duration_time`; test with packet lines whose last pts disagrees with any tag; AC-1 runs on that exact source |
| Window-relative vs absolute time mix-up | The cut lands hundreds of seconds off | `-read_intervals` uses absolute timestamps and so does every packet line; the pure functions take and return absolute seconds; AC-1/AC-2 check real lengths |
| `min(098, 099)` composed wrongly | One cut silently wins over an earlier one, or a `null` is read as 0 and truncates the file | Composition in one place in `encode.ffmpeg.ts`, nulls filtered before `min`; AC-9 |
| Extracting the audio selection changes `011`/`031` behaviour | Track choice regresses silently on every encode | Move-only refactor; `params.spec.ts`, `cases.spec.ts`, `variants.spec.ts` must pass unchanged before the new module is written |
| Duplicate `[ffmpeg] allowed language … has no audio track` warning | Calling the selection twice logs the warning twice — noise, not harm | The extracted function returns the missing languages instead of logging; only `getAudioParams` logs |
| Generalising `runFfmpegCapture` changes `094`/`098` | Grain probe or dub-trim detection regress | Existing call sites keep their exact behaviour (stdout counted, not kept); `grain-probe.spec.ts`, `dub-trim.spec.ts` pass unchanged |
| Probe outlives a cancel | Orphan ffprobe after a `047` delete / `097` stop | Same AbortSignal path as `098`; AC-7 |

## Verification

```bash
bin/cli api npx --no tsc --noEmit
bin/npm api test
bin/cli web npx --no tsc --noEmit
bin/cli web node scripts/check-messages.mjs
bin/cli worker npx --no tsc --noEmit
bin/npm worker test
bin/comments
```

Manual pass (live stack, `ENCODE_DRIVER=ffmpeg`):

1. **AC-11** — `bin/mysql -e "select value from settings where \`key\` = 'stream_end_trim_enabled'"`
   → no row or `false`; Settings → Compression shows the switch off.
2. **AC-8** — switch off, encode the Voltron NTb S01E01 source: output 4121.8 s, no `[streamtrim]`
   in `docker compose logs worker`, no `-t` in the logged FFmpeg command.
3. **AC-1/AC-12** — switch on, encode the same source: one `[streamtrim]` line with `cut≈4101.1`;
   `ffprobe` on the output shows container ≈ 4101.1 s and audio/video ending within 0.1 s; progress on
   `/downloads` reaches 100%.
4. **AC-2/AC-3/AC-5** — build the synthetic shapes inside the worker container (`bin/cli worker
   ffmpeg -f lavfi -i testsrc=d=120 -f lavfi -i sine=d=60 …`, and the inverse, the two-audio
   They-Will-Kill-You shape, and a 900 s video with a 300 s audio for the Darkest Hour shape), import
   each and check the output lengths and log outcomes the ACs name.
5. **AC-4** — a Voltron S02 NTb source: full length, `[streamtrim] … keep`.
6. **AC-6** — a source with no audio track (or `ffprobe` temporarily shadowed by a failing script in
   the container): full length, no `[streamtrim]` line, no warning.
7. **AC-7** — delete (`047`) / stop (`097`) a source while its probe runs: `docker compose exec
   worker ps` shows no ffprobe left.
8. **AC-9** — both switches on, a source both detectors cut: cut at the earlier point, both log lines.
9. **AC-10** — compression off: switch disabled at its value, saving leaves the row unchanged, a moved
   file logs no `[streamtrim]`.
