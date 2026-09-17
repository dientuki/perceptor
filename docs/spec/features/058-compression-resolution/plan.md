---
title: Compression resolution — Implementation Plan
spec_version: 0.5.0
last_updated: 2026-09-16
status: Implemented
---

# PLAN: Compression resolution (`plan.md`)

## Approach

The setting, its validation and its UI already exist (`044`). This feature extends three seams that
are already there rather than opening any new one:

- **`api`** widens `COMPRESSION_RESOLUTIONS` in `services/api/src/settings/settings.catalog.ts` by
  `480p` — the `enum` validator and `error.setting.expected_enum` pick it up with no other change —
  and flattens the value onto `EncodeJobDetails` in
  `ProcessJobsService.getEncodeJobDetails` (`services/api/src/process-jobs/process-jobs.service.ts`),
  on the exact line that already reads `compression_enabled` off the same `SettingsService.getMap()`
  result. No second settings read, no new resolver, no migration.
- **`web`** adds one entry to `RESOLUTIONS` in `CompressionPanel.tsx` and one label per catalog. The
  hidden-input persistence path is untouched.
- **`worker`** carries the value the way `057` carries `contentKind`: retyped into the local
  `EncodeJobDetails` (`src/jobs/encode.job.ts`), added to the `processJob` selection set, normalized
  once by a small pure module beside `src/encode/content-kind.ts`, threaded through `EncodeInput`
  (`src/encode/types.ts`), and read by `getVideoParams` (`src/ffmpeg/params.ts`) as a parameter.
  `passthrough.ts` ignores it, which is how REQ-16 holds with no new branch.

The substantive work is the video rule in `params.ts`, and it is a **replacement, not an addition**.
Today `getVideoParams` has five return sites that each restate the full
`-c:v libsvtav1 -crf … -preset 4 -pix_fmt … -svtav1-params …` block and differ only in `-vf`, colour
tags and title (`.claude/agents/ffmpeg.md` § Governance already names this). The new rule is one
decision — *copy, or encode with an optional scale* — made from two facts (codec recognized? source
exceeds the box?), followed by **one** argument builder that varies only in the scale filter, the
colour tags (HDR form of the source) and the title. The `is4K` threshold, the per-codec branches and
the doubled `tune=0` on the VC-1 path all disappear with it.

Alternatives rejected:

- **A GraphQL enum for `compressionResolution`.** Rejected in `spec.md` (a hand-edited row would fail
  the whole `processJob` query). Normalized on both sides instead.
- **Keeping the per-codec branches and adding a scale filter to each.** It would be a fourth and
  fifth copy of the same argument block — exactly the degradation Article X and the `ffmpeg` agent's
  governance exist to stop.
- **Deciding the tier by height alone.** A 2.39:1 4K film (3840×1608) would read as "1440p-ish" and a
  scope 1080p film (1920×800) as "720p-ish". Width and height against a box, as REQ-7 states.

### Decisions this plan makes that the spec left open

- **Track title format** (REQ-14). Encoded without scaling: `AV1 (Converted from <CODEC> <HDR>)`,
  e.g. `AV1 (Converted from H264 SDR)`, `AV1 (Converted from HEVC DoVi)`. Downscaled:
  `AV1 (Downscaled from <SOURCE> <CODEC> <HDR>)`, e.g. `AV1 (Downscaled from 4K HEVC DoVi)`, where
  `<SOURCE>` is the label of the smallest tier box the source fits (`4K` for anything above 1080p's
  box, else `1080p`/`720p`/`480p`/`360p`). The title always starts with plain `AV1`; the target tier
  never appears in it. `<CODEC>` is `H264`, `HEVC`, `VC-1` or `AV1`.
- **SDR colour tags are explicit on every AV1 encode** (`-color_range tv -colorspace bt709
  -color_primaries bt709 -color_trc bt709`), as VC-1 and 4K SDR already are today — the single
  builder has one SDR form, not two. H264 SDR encodes gain these four arguments.
- **HDR detection is today's predicate, generalized to every codec**: Dolby Vision = a
  `DOVI configuration record` side-data entry; HDR10 = `color_transfer smpte2084`, `color_primaries
  bt2020`, or mastering-display / content-light side data; HLG = `color_transfer arib-std-b67`,
  split out of the HDR10 predicate so REQ-13 can write its own transfer. An H264 source tagged
  `smpte2084` is therefore HDR10 and gains bt2020 tags.
- **Even dimensions** come from the scale filter itself (`force_original_aspect_ratio=decrease` plus
  `force_divisible_by=2`), with the box as `scale=<W>:<H>` — the same filter family the worker uses
  today, not a computed size.
- **The tier comparison uses ffprobe's coded `width`/`height`**, not display dimensions. An anamorphic
  PAL DVD (720×576) exceeds `480p` and is scaled to fit the box; the scale filter adjusts the sample
  aspect ratio so display aspect is preserved (REQ-9).
- **Worker default constant lives with the normalizer**, not in `src/ffmpeg/`: `src/ffmpeg/` receives
  an already-valid `CompressionResolution`, exactly as it receives a valid `ContentKind`.
- **Empty `PERCEPTOR_SOURCE` (REQ-17, added in 0.5.0) is fixed in `buildSourceTag`, not in
  `isInsideRoot`.** `isInsideRoot` counting path equality as "inside" is correct for its other
  caller — `jobs/cleanup-source.ts`, the guard that nothing outside `downloadsRoot` is ever deleted
  (`047` REQ-12) — and changing it there is a safety change nobody asked for. `buildSourceTag` instead
  treats "`downloadPath` resolves to the input file itself" as a loose file and returns its base name
  before trying the folder-relative branch. The base name, not `imports/<uploadId>/<name>`, because
  the upload id identifies an upload, not a release; it is the same value the existing last-resort
  fallback already produces. The torrent (folder) branch and both fallbacks keep their current output.

## Order of Work

| Step | Service | Why it must come here |
| :-- | :-- | :-- |
| 1 | `api` | Owns the catalog (`480p` must validate before `web` can save it) and the field the worker selects — a worker selecting `compressionResolution` against an api without it fails every `processJob` query. |
| 1 | `web` | Parallel with `api`: one array entry and two catalog labels, no GraphQL shape change. Saving `480p` only succeeds once step 1 `api` is deployed, which is a verification dependency, not an implementation one. |
| 2a | `worker` (worker agent) | `CompressionResolution` type + normalizer, `EncodeInput` field, `EncodeJobDetails` field, selection set, log line, both `EncodeInput` literals. Must precede 2b: the rule functions import the type. |
| 2b | `worker` (**`ffmpeg` agent**) | `src/ffmpeg/params.ts` rule replacement, `buildCommand.ts` pass-through, `params.spec.ts`/`buildCommand.spec.ts`, and a compile-only touch to `cases.spec.ts`. The corpus JSON files are not touched. `src/ffmpeg/` belongs to this agent, not the worker agent. |
| 3 | `[docs]` | `docs/spec/graphql-contract.md` section, root `CLAUDE.md` Transcode row, `.claude/agents/ffmpeg.md` § Rules V2–V6 rewritten. |
| 4 | `worker` (worker agent) | Added in 0.5.0 (REQ-17): `src/metadata/container-tags.ts` loose-file branch and `container-tags.spec.ts` brought to the three-argument signature. Independent of steps 1–3 (no contract, no `src/ffmpeg/`), ordered last only because it was found after they shipped. `src/metadata/` is the `worker` agent's, not the `ffmpeg` agent's. |
| 5 | `[docs]` | `services/worker/CLAUDE.md` `sourceTag` paragraph, root `CLAUDE.md` Current state (the `TS2554` pair recorded as resolved), then close the feature again. |

`api` and `web` run in parallel. `worker` 2a can start in parallel with `api` too — the contract is
frozen — but the worker typecheck is only green after 2b, since `buildCommand.spec.ts`/`cases.spec.ts`
build an `EncodeInput` and fail to compile the moment 2a adds a required field. 2a and 2b are therefore one
batch as far as "typecheck clean" is concerned.

## Contract Freeze

`## GraphQL Contract Delta` in `spec.md` is frozen as of `status: Approved`. Things an implementer
will be tempted to change and must not:

- **`compressionResolution: String!`, not an enum.** From inside `api` a `registerEnumType` looks
  tidier and matches `ContentKind`. It would turn a bad row into a failed encode. Keep the string and
  normalize.
- **The values are lowercase `4k`, not `4K`.** They are the stored setting values, verbatim. The
  worker compares against exactly these five strings.
- **No description on the field in `schema.gql`.** Its sibling `compressionEnabled` has none, and
  Article XI forbids the docblock that would produce one.
- **`web` does not select `EncodeJobDetails.compressionResolution`.** It reads the setting through
  `settings` like every other key.
- **A failed AV1 encode is not retried as copy** (spec § Out of Scope). The `ffmpeg` agent will see
  the copy builder right next to the encode builder; wiring a fallback between them is a contract
  change, not a refactor.

## Migrations

None. `compression_resolution` is an existing row. `480p` is a new accepted value; every stored value
today (`4k`/`1080p`/`720p`/`360p`) stays valid. The seed is create-only, so no existing installation's
row is touched.

Reversibility: rolling `api` back while a row holds `480p` makes that value invalid to the old
catalog; the old `api` does not expose the field, so the old worker is unaffected, and the Settings
screen shows the old default selection until the administrator saves again.

## Risks

| Risk | How it fails | Mitigation |
| :-- | :-- | :-- |
| `compressionResolution` dropped from the worker's hand-typed selection set, or from one of the two `EncodeInput` literals | Every encode silently runs at `1080p` whatever the administrator chose; the file looks fine | Normalizer logs a warning on absence; the value is printed on the existing `[encode] <id>:` line; `encode.job.spec.ts` asserts the query selects it and the resolved value reaches `EncodeInput`. |
| Upscale by construction — a scale filter applied to a source smaller than the box | Output larger than source, no error | The scale filter is only emitted when the exceeds-box predicate is true; `params.spec.ts` covers sources below and at each box and asserts no `-vf`. `force_original_aspect_ratio=decrease` never enlarges on its own either. |
| Tolerance applied the wrong way (e.g. `≥` vs `>`, or 2% of the source instead of the box) | 1920×1088 re-scaled to 1906×1080, or a 1960×1100 source left un-scaled | Boundary cases in `params.spec.ts`: exactly the box, box +2%, box +2% +1px, per dimension. |
| HDR tags lost on a codec path that never had them (H264/AV1 HDR) | File plays washed out; FFmpeg exits 0 | Single argument builder takes the HDR form as input for every codec; `params.spec.ts` covers DoVi, HDR10, HLG and SDR for H264, HEVC and AV1 sources, scaled and not. Real-file validation is a later pass (spec § Out of Scope). |
| HEVC below 4K now re-encoded on CPU at `preset 4` | Encode queue time grows sharply for 1080p HEVC releases; not an error, but visible to users | Intended (spec NFR-1). Called out in the root `CLAUDE.md` Transcode row so it is not debugged as a regression. |
| Unrecognized codec above the ceiling is copied | A 4K MPEG-2/VP9 file lands in a `720p` library at 4K | Intended (REQ-12); the worker logs codec and "ceiling not applied" so it is findable. |
| New `api` + old `worker`, or old `api` + new `worker` during a rolling update | Old worker ignores the field (fine). New worker against old api: `processJob` query **errors** on the unknown field, failing encodes | Deploy `api` before `worker` (the images share one `PERCEPTOR_TAG`, so a normal `docker compose pull && up -d` does this; a mixed tag is already unsupported per root `CLAUDE.md`). |
| REQ-17 fix applied to `isInsideRoot` instead of `buildSourceTag` | Source cleanup's containment guard changes meaning; a regression there deletes or refuses to delete source residue, with no error | Fix confined to `buildSourceTag`; `is-inside-root.ts` and its spec untouched — checked with `git diff --stat services/worker/src/paths` being empty. |
| Loose-file branch also swallows a torrent whose `downloadPath` is a single file | A single-file torrent's tag becomes its base name — the same release name, just without a folder, which is correct | Accepted: the tag is a provenance record, and the base name of a single-file release is its release name. |
| Unit expectations written to match whatever the new code emits | `params.spec.ts` goes green while encoding a rule nobody asked for | Expectations are derived from `spec.md` REQ-6…REQ-14 and this plan's decisions, not from running the code; the stale corpus is explicitly not a reference. |

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
```

Expected: `api` and `web` typecheck at 0 errors; `api` tests pass with the new `getEncodeJobDetails`
cases; `web` build exits 0 and `check-messages` reports no drift; `worker` typecheck reports 0
errors once step 4 lands (before it, only the 2 `src/metadata/container-tags.spec.ts` `TS2554` errors) and
`worker` tests pass except the pre-existing `buildCommand.spec.ts` CRF mismatch and whatever
`src/ffmpeg/cases.spec.ts` reports — the corpus is stale and excluded from this feature's checks
(spec § Out of Scope); `git status --short services/api/prisma` is empty.

Manual pass (AC references are `spec.md`):

1. Settings → Compression: `480p` appears between `720p` and `360p` in `en` and `es`; select it, Save,
   reload; `bin/mysql -e "select value from settings where \`key\`='compression_resolution'"` prints
   `480p` (AC-1).
2. `bin/mysql -e "update settings set value='garbage' where \`key\`='compression_resolution'"`, then
   query `processJob` for any job id with the `SERVICE_TOKEN` — `compressionResolution` is `1080p`
   (AC-10). Send `updateSettings` with `540p` — `error.setting.expected_enum`, row unchanged (AC-11).
3. Set `720p`, `ENCODE_DRIVER=ffmpeg`, `ENCODE_SAMPLE_SECONDS=10`; import a 1080p H264 file by magnet or
   upload. `docker compose logs worker` shows `compressionResolution=720p` on the `[encode]` line;
   `bin/cli worker ffprobe -v error -show_streams -of json <library file>` shows AV1 ≤1280×720 (AC-3,
   AC-2). Repeat with a 1080p HEVC at `1080p` (AC-4), a 1080p source at `4k` (AC-5), a 4K HDR10 HEVC
   at `4k` (AC-6), a 1080p AV1 at `1080p` then `480p` (AC-7), a 4K DoVi at `360p` (AC-8), an MPEG-2
   file at `720p` (AC-9).
4. Enqueue at `720p`, change to `360p` before the encode starts, confirm ≤640×360 (AC-13).
5. `compression_enabled=false` with `360p`: `cmp` source and library file (AC-12).
6. Upload a file through the import flow and encode it: the `[ffmpeg] ejecutando:` line carries
   `-metadata PERCEPTOR_SOURCE=<file name>`, non-empty, with no `imports/` prefix; a torrent source
   still carries its path relative to its release folder (AC-15).
