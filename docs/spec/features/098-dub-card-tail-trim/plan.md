---
title: Dub-Card Tail Trim — Implementation Plan
spec_version: 0.1.0
last_updated: 2026-10-19
status: Implemented
---

# PLAN: Dub-Card Tail Trim (`plan.md`)

## Approach

The feature rides the exact path `092`'s `grain_auto_enabled` already cut through all three services,
so every piece but the detector itself is a copy of an existing one-line pattern:

- **`api`** adds a `kind: 'boolean'` entry to `src/settings/settings.catalog.ts`, a create-only
  `"false"` seed row in `prisma/seeds/settings.ts`, and one field on `EncodeJobDetails`
  (`src/process-jobs/entities/encode-job-details.entity.ts`) filled in
  `ProcessJobsService.getEncodeJobDetails()` from the `settingsMap` it already reads — same
  `=== 'true'` idiom as `resolveEffectiveGrainMode` (`src/settings/grain-mode.ts`). No migration.
- **`web`** adds one `Switch` + hidden input to `CompressionPanel.tsx` beside the grain switch, wires
  the initial value through `SettingsForm.tsx`, adds the key to `BOOLEAN_KEYS` in
  `src/actions/settings.ts`, and one label to `messages/{en,es}.json`. The existing
  `updateSettings` path, error rendering and disabled-when-compression-off behaviour are reused
  unchanged.
- **`worker`** owns the detector. It follows `094`'s shape in `src/encode/`: pure, tested rule
  functions in a new module, a resolver called from the encode driver (`encode.ffmpeg.ts`) beside
  `resolveFilmGrain`, an in-process verdict cache, and the AbortSignal-aware FFmpeg spawn that
  `grain-probe.ts` already has (`runProbeFfmpeg`) — **extracted** into `src/ffmpeg/` and shared,
  rather than written a second time. The cut is one more limit on the existing `-t` that
  `buildFfmpegCommand` already emits for `ENCODE_SAMPLE_SECONDS`, and the progress denominator is the
  same `durationSeconds` `encode.ffmpeg.ts` already computes.

Alternatives considered and rejected: cutting in a second FFmpeg pass after the encode (doubles I/O
on multi-GB files, and the encode has already spent CPU on the tail); deciding in `api` (it never
reads media); a per-title override like `grainMode` (the user asked for one installation switch —
spec Out of Scope). Detection lives in the encode driver, not in `encode.job.ts`, so the passthrough
path (`compression_enabled` off) can never reach it, the same structural guarantee `092` REQ-10 relies
on.

## Order of Work

| Step | Service | Why it must come here |
| :-- | :-- | :-- |
| 1 | `api` | Exposes `EncodeJobDetails.dubTrimEnabled` and the Setting the other two read. |
| 2a | `web` | Writes the Setting through the existing `updateSettings`; needs the catalog entry first — `SettingsService.updateMany` refuses an unknown key with `error.setting.not_editable`, which would fail the **whole** Compression tab's save, not just this field. |
| 2b | `worker` | Reads `dubTrimEnabled`; until `api` ships it the field is `undefined`, which NFR-2 reads as off. |
| 3 | `docs` | `docs/spec/graphql-contract.md`'s `EncodeJobDetails` block gains the field; root and `worker` `CLAUDE.md` gain one paragraph each. |

2a and 2b are fully parallel once step 1 is merged — the contract is one boolean. `worker` can even
start before step 1 lands, since its detector and tests touch nothing of `api`'s; only the query edit
waits.

## Contract Freeze

The `## GraphQL Contract Delta` in `spec.md` is frozen as of `status: Approved`. Things an
implementer will be tempted to change and must not:

- **`dubTrimEnabled` is not ANDed with `compressionEnabled` in `api`.** It is the raw setting. The
  worker already gates every compression-only decision on its own `compressing` flag
  (`encode.job.ts`), exactly as it does for `grainMode` — doing it in both places invites the two to
  disagree.
- **No `EffectiveDubTrimMode` enum, no tri-state.** There is no per-title value to inherit from.
  A boolean is the whole decision.
- **No error key for detection failure.** NFR-1: a failed detection is silent and never reaches `api`.
  A `worker` implementer adding an `encodeFailed` report or a `KeyedError` for it is out of contract.
- **`web` does not select `EncodeJobDetails.dubTrimEnabled`.** It reads the Setting row like every
  other Compression field.

If the contract has to change mid-flight: stop, amend `spec.md`, re-approve, re-brief `api`, `web`
and `worker` (Article VIII).

## Migrations

None. `dub_trim_enabled` is a `Setting` row created by the production seed as `"false"`, create-only.
An install that has not reseeded reads the row as absent, which REQ-2 defines as off. Rolling the
feature back leaves an unused row behind, harmless.

## Risks

| Risk | How it fails | Mitigation |
| :-- | :-- | :-- |
| The classifier cuts real content | A static final shot or card-style original credits get removed; no error anywhere, the file just ends early | REQ-7's 2.002 s-multiple rule; worker tests replay the recorded Chernobyl run (56 cards, 5% multiples) and must keep it; switch defaults off (REQ-2) |
| Cut point lands on the first 2 s card instead of the run start | Leading fade/odd card survives — a few seconds of garbage kept, silently | REQ-8 test on `voltron-s03e01`, `war-machine`, `wrecking-crew` fixtures, whose runs open with non-2 s segments |
| Window measured against container, not video | A source whose container outlasts its video (Voltron S01E01) never shows a run reaching "the end" — tail kept silently | `videoEndSeconds` test with stream `duration=N/A` + Matroska `DURATION` tag, and with tag shorter than `format.duration` |
| Window-relative vs absolute time mix-up | Cut lands 300 s off, or before the window — output truncated mid-episode with no error | Resolver returns an absolute time; test asserts `windowStart + runStart` against fixture numbers; AC-1 checks real cut points |
| Verdict cached per `mediaSourceId` | Every file of a season pack gets the first episode's cut point — wrong lengths, silently | Cache keyed by input path (REQ-11); test with two inputs under one `mediaSourceId` |
| Progress denominator not updated | Progress stalls below 100% then jumps — cosmetic but looks like a hang | REQ-10; `encode.ffmpeg.ts` passes the trimmed duration to `runFfmpeg` |
| Detection process outlives a cancel | An orphan FFmpeg decode keeps running after `047` delete / `097` stop | Shared AbortSignal-aware spawn helper (the one `094` already proved), AC-7 |
| Extracting `runProbeFfmpeg` changes `094` | Grain probe regresses | Move-only refactor; `grain-probe.spec.ts` / `grain-mode.spec.ts` must pass unchanged |

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

1. **AC-9** — `bin/mysql -e "select value from settings where \`key\` = 'dub_trim_enabled'"` → no row
   or `false`; Settings → Compression shows the switch off.
2. **AC-5** — switch off, import Neagley S01E01 (or re-attach it): output full length, no `[dubtrim]`
   in `docker compose logs worker`, no `-t` in the logged FFmpeg command.
3. **AC-1/AC-3** — switch on, encode the AC-1 list (at minimum Neagley S01E01, Voltron S03E01, War
   Machine): one `[dubtrim]` line with the cut point each; `ffprobe -show_entries
   stream=codec_type,duration:stream_tags=DURATION` on the output shows every stream ending within
   1 s of it; the last frames are a logo or end of credits.
4. **AC-2** — Chernobyl S01E01, Reacher S01E01, Foundation S01E01, Voltron S01E01, Alita: full-length
   outputs, `[dubtrim] … keep`.
5. **AC-4** — watch `/downloads` during step 3: progress reaches 100%.
6. **AC-6** — point an encode at a source whose video cannot be decoded at the window (or temporarily
   break the detection command): full-length output, no `[dubtrim]` line, no warning.
7. **AC-7** — delete (`047`) / stop (`097`) a source during its detection: `docker compose exec worker
   ps` shows no FFmpeg left.
8. **AC-8** — compression off: switch disabled at its value, saving leaves the row unchanged, a moved
   Neagley episode logs no `[dubtrim]`.
9. **AC-10** — a season pack with dubbing tails: one `[dubtrim]` line per file, each its own cut.
