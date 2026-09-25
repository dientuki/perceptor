---
title: Subtitle Format Selection — Implementation Plan
spec_version: 0.2.0
last_updated: 2026-09-25
status: Approved
---

# PLAN: Subtitle Format Selection (`plan.md`)

## Approach

Every seam this feature needs already exists for `compression_resolution` (`058`); this feature
follows that path end to end rather than opening a new one:

- **`api`** adds the two format catalogs as constants beside `COMPRESSION_RESOLUTIONS` in
  `services/api/src/settings/settings.catalog.ts`, five catalog entries, and one new `SettingKind`
  (`enum_list`) validated in `SettingsService.updateMany` next to the existing `enum` and
  `languages` branches — `languages` already establishes "a comma-separated list where `""` is the
  empty list", and `enum_list` copies that shape with a fixed option set instead of a language
  lookup. `ProcessJobsService.getEncodeJobDetails` resolves `allowedSubtitleFormats` from the same
  `SettingsService.getMap()` result it already reads `compression_enabled`/`compression_resolution`
  from — no second settings read — through one small pure function, so the resolution is testable
  without Prisma. Five seed rows, create-only.
- **`web`** extends `CompressionPanel.tsx` with the subtitles section, reusing the panel's existing
  idiom verbatim: local state, controls with no `name`, hidden inputs carrying the value, disabled
  while the compression switch is off. `updateSettingsAction` (`src/actions/settings.ts`) gets a list
  path beside `BOOLEAN_KEYS`, because `EDITABLE_KEYS` filters blank values and an empty list must be
  sent.
- **`worker`** carries the field the way `058` carried `compressionResolution`: retyped into
  `EncodeJobDetails` (`src/jobs/encode.job.ts`), selected, normalized once by a pure module beside
  `src/encode/compression-resolution.ts`, threaded through `EncodeInput` into `getSubtitleParams`.
  `passthrough.ts` never reads it (REQ-12 holds with no new branch).

The substantive work is `getSubtitleParams` in `services/worker/src/ffmpeg/params.ts`, owned by the
`ffmpeg` agent. `TEXT_SUBTITLE_CODECS`/`isTextSubtitle` are **replaced**, not joined by a second
list: one `codec_name → { id, group }` map covering REQ-1's seven entries, one filter "codec maps to
an allowed id", the existing S2–S5 pipeline run unchanged, then per language the text-before-image
cut (REQ-9) as one more narrowing step, `preferring(streams, isImageGroup)` from `variants.ts`
— it already expresses "keep the preferred subset if non-empty, else everything", which is exactly
REQ-9. Output arguments differ only in `-c:s:N srt` vs `-c:s:N copy`, decided from the group; the
title line is shared.

Alternatives rejected:

- **Sending the five raw settings to the worker.** The worker would re-derive "no subtitles" and the
  group toggles, a second copy of REQ-7's logic in a service with no access to the rows. One
  effective list keeps the rule in `api` (spec § Contract).
- **Exposing the catalog over GraphQL for `web`.** Spec § Out of Scope; `web` keeps a local list the
  way it keeps `RESOLUTIONS`.
- **A GraphQL enum list.** Spec § Contract, same reasoning as `058`.

### Decisions this plan makes that the spec left open

- **`enum_list` normalizes before storing**: split on `,`, trim, drop empty segments, dedupe, then
  re-order into catalog order — so `"ass, srt,srt"` stores `srt,ass` (REQ-5's "catalog order, no
  duplicates"). Validation runs on the de-duplicated set; `""` is valid and stores `""`. The kind is
  excluded from the "value required" check in `updateMany`, as `languages` is.
- **Missing-row defaults in `api`**: `subtitles_enabled` and `subtitles_text_enabled` read as on
  unless the row is exactly `"false"` (the `compression_enabled` posture); `subtitles_image_enabled`
  reads as on only when exactly `"true"`. A missing list row resolves to its NFR-1 default; a present
  empty row resolves to empty. Never `=== 'true'` for the first two — that turns a missing row into
  "no subtitles", a silent library regression.
- **Effective list order** is text ids then image ids, each in catalog order. Order carries no
  meaning on the wire; fixing it just makes logs and tests deterministic.
- **Seed exemption**: the seed's "backfill a row that is still empty" branch
  (`services/api/prisma/seeds/settings.ts`) gets a per-entry opt-out used only by the two list rows
  (NFR-1). Not a new seed mechanism — one boolean on the existing entry shape.
- **UI controls**: "no subtitles" and both group toggles are `Checkbox` (`components/form/input/
  Checkbox.tsx`, already controlled, already used in Settings); format checkboxes indented under
  their group. The "no subtitles" checkbox is the inverse of `subtitles_enabled`; the hidden input
  writes `subtitles_enabled`, never a `subtitles_disabled` key.
- **Worker default** (NFR-3) is `['srt','ass','webvtt','mov_text']`, declared once with the
  normalizer in `src/encode/subtitle-formats.ts`. The id union type lives there too; `src/ffmpeg/`
  imports the type, as it imports `CompressionResolution`.
- **Corpus unchanged**: `src/ffmpeg/cases.spec.ts` passes a case's `input.allowedSubtitleFormats`
  when present and otherwise `['srt','mov_text']` — the exact pre-`070` codec set (`subrip`,
  `mov_text`, `tx3g`). Every existing `services/worker/ffmpeg/*.json` therefore keeps its expected
  argument array byte for byte, which is the proof the rewrite changed nothing but the filter. New
  behaviour is proven in `params.spec.ts` with synthetic streams, as the `ffmpeg` agent's corpus
  rules require.
- **Log line** for REQ-11: `[ffmpeg] subtitles disabled by settings (allowedSubtitleFormats empty).`,
  emitted instead of (not beside) the existing "no text subtitle … survived" line, which is reworded
  to drop "text" since image now participates.

## Order of Work

| Step | Service | Why it must come here |
| :-- | :-- | :-- |
| 1 | `api` | Owns the catalog, the validation `web` saves through, the seed rows, and the field the worker selects. A worker selecting `allowedSubtitleFormats` against an `api` without it fails **every** `processJob` query ("Cannot query field"), not just subtitles. |
| 1 | `web` | Parallel with `api`: no GraphQL shape change, only five more keys through `updateSettings`. Saving only succeeds once step 1 `api` runs — a verification dependency, not an implementation one. |
| 2a | `worker` (worker agent) | `SubtitleFormat` type + normalizer + default, `EncodeInput` field, `EncodeJobDetails` field, selection set, log line, both `EncodeInput` literals in `encode.job.ts`. Precedes 2b: the rule imports the type. |
| 2b | `worker` (**`ffmpeg` agent**) | `getSubtitleParams` rewrite, `buildCommand.ts` pass-through, `params.spec.ts`/`buildCommand.spec.ts`, `cases.spec.ts` default. `src/ffmpeg/` is this agent's, not the worker agent's. |
| 3 | `[docs]` | `docs/spec/graphql-contract.md` section; root `CLAUDE.md` Transcode row; `services/worker/CLAUDE.md` § audio/subtitle rules; `.claude/agents/ffmpeg.md` § Subtitles S1 rewritten (image formats, REQ-9 as a new rule, output codec per group); `services/api/CLAUDE.md` / `services/web/CLAUDE.md` where they list settings kinds or Compression tab controls. |

`api` and `web` run in parallel. Worker 2a can start alongside them (the contract is frozen), but the
worker typecheck is only green after 2b — `buildCommand.spec.ts`/`cases.spec.ts` build an
`EncodeInput` and stop compiling the moment 2a adds a required field — so 2a and 2b are one batch for
"typecheck clean".

**Deploy order matters**: `api` must be running the new schema before a new `worker` starts
consuming jobs. With published images that is automatic (one `PERCEPTOR_TAG`); on a dev stack,
restart `api` first.

## Contract Freeze

`## GraphQL Contract Delta` in `spec.md` is frozen as of `status: Approved` (spec 0.2.0). Things an
implementer will be tempted to change and must not:

- **`[String!]!`, not an enum list.** Normalize on both sides instead.
- **The list is already effective.** The worker must not receive, select or reason about
  `subtitles_enabled` or the group toggles. The `api` slice must not "helpfully" also expose the raw
  settings on `EncodeJobDetails`.
- **No description on the field** in `schema.gql` (Article XI; siblings carry none).
- **`web` does not select `EncodeJobDetails.allowedSubtitleFormats`.** It reads the five settings via
  `settings`.
- **Text is always SRT** (spec § Out of Scope). The `ffmpeg` agent will see that `ass` could be
  copied natively into MKV; doing so is a contract change, not an optimisation.
- **REQ-9 is per language, not global.** A Spanish SRT must not suppress an English PGS.

## Migrations

None. Five new `Setting` rows, created by the seed (`services/api/prisma/seeds/settings.ts`, create-
only, run by `api` before it listens under `PERCEPTOR_AUTO_MIGRATE`, and by `bin/dbreset`). Existing
rows are untouched. Rollback: an older `api` ignores the five rows (they are not in its catalog, so
`updateSettings` refuses them, and nothing reads them); an older `worker` never selects the field.

## Risks

| Risk | How it fails | Mitigation |
| :-- | :-- | :-- |
| Seed re-fills an empty list on boot | Admin unchecks every text format, saves; next `api` restart silently restores defaults. No error; subtitles reappear. | Seed opt-out for the two list rows (NFR-1); AC-3 restarts `api` and re-checks the row. |
| `web` filters the empty list out | Uncheck all, Save succeeds, row unchanged — no error anywhere. | List keys go through their own path, never `EDITABLE_KEYS`' blank filter; AC-3. |
| Missing boolean row read as `false` | An install whose seed has not run yet resolves to "no subtitles"; every encode loses subtitles silently. | `!== 'false'` for `subtitles_enabled`/`subtitles_text_enabled`; `api` unit test on the resolver covers every missing-row combination. |
| `subtitles_image_enabled` read as on when missing | PGS copied into every file from an older install. Silent, and the files are permanent (Article XII). | `=== 'true'` for this one key; same unit test. |
| REQ-9 applied across languages | A Spanish SRT suppresses the English PGS; silently fewer tracks. | `params.spec.ts` case mirroring AC-7. |
| Image stream given `-c:s srt` | FFmpeg fails ("Subtitle encoding currently only possible from text to text") — loud, not silent, but every PGS job fails. | `params.spec.ts` asserts `copy` for each image id; AC-8 live. |
| Codec → id map missing an entry | That format is never selected even when checked. Silent. | The map is typed against the `SubtitleFormat` union (a `Record` keyed by id), so a missing id is a compile error; a test per REQ-1 row. |
| Corpus behaviour drifts | An existing case's subtitle selection changes without anyone deciding it. | `cases.spec.ts` default pins the pre-`070` set; corpus JSON not edited. |
| ASS typesetting flattened to SRT | Anime signs/karaoke appear as stray overlapping lines. Visible, accepted by the spec. | Spec § Out of Scope; mentioned in the root `CLAUDE.md` Transcode row so it is not rediscovered as a bug. |
| Worker ahead of `api` | Every `processJob` query fails. Loud. | Deploy order (above); single `PERCEPTOR_TAG` in production. |

## Verification

```bash
bin/cli api npx --no tsc --noEmit
bin/npm api run test
bin/cli web npx --no tsc --noEmit
bin/npm web run build
bin/cli web node scripts/check-messages.mjs
bin/cli worker npx --no tsc --noEmit
bin/npm worker run build
bin/npm worker test
git status --short services/api/prisma
git diff services/api/src/schema.gql
```

Expected: 0 typecheck errors in all three; `api` tests green; `worker` tests green except the three
pre-existing `src/ffmpeg/` failures recorded in the root `CLAUDE.md` (and no new ones);
`check-messages` reports no drift; `git status --short services/api/prisma` shows only
`prisma/seeds/settings.ts` (no migration); the `schema.gql` diff is exactly
`allowedSubtitleFormats: [String!]!` on `EncodeJobDetails`.

Manual pass (maps to AC-1 … AC-10):

1. `bin/dbreset`, then `bin/mysql -e "select \`key\`, value from Setting where \`key\` like 'subtitles_%'"` — five NFR-1 rows (AC-1).
2. Settings → Compression: toggle "no subtitles", toggle each group, confirm locking and that
   disabled checkboxes keep their state; Save, reload (AC-2).
3. Uncheck all text formats, Save, `bin/mysql` the row, `docker compose restart api`, `bin/mysql`
   again — still empty (AC-3).
4. Send the two refused `updateSettings` calls from AC-4 against `api` with an admin token; confirm
   the error key/params and that the row did not change. Hand-edit `subtitles_image_formats` to
   `pgs,garbage`, enable image, and query `processJob` with the `SERVICE_TOKEN` (AC-5).
5. Encode one release with ASS + PGS (defaults) and one with Spanish SRT + Spanish PGS + English PGS
   (both groups on); `bin/cli worker ffprobe -v error -show_streams -of json <output>` and compare
   with AC-6/AC-7. One PGS-only release with only images allowed (AC-8). One encode under "no
   subtitles", checking `docker compose logs worker` for the REQ-11 line (AC-9). Queue a job, switch
   to "no subtitles" before it starts (AC-10) — `ENCODE_SAMPLE_SECONDS` keeps these short.
