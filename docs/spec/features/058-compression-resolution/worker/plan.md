---
title: Compression resolution — worker slice
service: worker
last_updated: 2026-09-16
status: Implemented
---

# PLAN: Compression resolution — `worker` (`worker/plan.md`)

## Scope

`worker` reads `compressionResolution` off the `processJob` payload, normalizes it, and makes the
video rule honour it: every recognized codec (`h264`, `hevc`/`h265`, `vc1`, `av1`) becomes AV1,
downscaled to fit the chosen box when the source exceeds it by more than 2%, never upscaled; stream
copy only for AV1 that fits and for unrecognized codecs; HDR colour tags preserved on every encode.
It does not read settings, choose defaults for anything but a malformed payload, or touch
`passthrough.ts`'s behaviour (compression off ignores the value — REQ-16).

Since 0.5.0 the slice also fixes the empty `PERCEPTOR_SOURCE` tag on uploaded files (REQ-17), in
`src/metadata/` — Part C below, `worker` agent.

**This slice is two agents.** Parts A and C are the `worker` agent (`src/jobs/`, `src/encode/`,
`src/metadata/`). Part B is the **`ffmpeg` agent** (`src/ffmpeg/`), which owns that directory —
the `worker` agent stops and reports rather than editing them. Part A lands first; Part C is
independent of both and touches neither `src/ffmpeg/` nor the contract.

Writes are confined to `services/worker/` and this directory.

## Files

### Part A — `worker` agent

| File | New / Modified | What changes |
| :-- | :-- | :-- |
| `src/encode/compression-resolution.ts` | New | `CompressionResolution` union, `COMPRESSION_RESOLUTION_VALUES`, `normalizeCompressionResolution(raw)` → valid value or `'1080p'` with one `console.warn` |
| `src/encode/compression-resolution.spec.ts` | New | Degradation cases |
| `src/encode/types.ts` | Modified | `EncodeInput.compressionResolution: CompressionResolution` (required) |
| `src/jobs/encode.job.ts` | Modified | `EncodeJobDetails.compressionResolution: string`; add to the `processJob` selection set; normalize once beside `normalizeContentKind`; print it on the `[encode] <id>:` line; set it in **both** `EncodeInput` literals (encode and passthrough) |
| `src/jobs/encode.job.spec.ts` | Modified | Selection + forwarding cases |
| `services/worker/CLAUDE.md` | Modified | Short section beside the `contentKind` one: the field, its normalizer, the `1080p` fallback |

### Part B — `ffmpeg` agent

| File | New / Modified | What changes |
| :-- | :-- | :-- |
| `src/ffmpeg/params.ts` | Modified | `getVideoParams(videoStream, contentKind, compressionResolution, quality)`; the per-codec branches, `is4K` and `HDR_DOWNSCALE_VF` are replaced by: a copy/encode decision, an exceeds-box predicate, an HDR-form classifier, and one AV1 argument builder |
| `src/ffmpeg/buildCommand.ts` | Modified | Passes `details.compressionResolution` |
| `src/ffmpeg/params.spec.ts` | Modified | The tier matrix (see Tests); existing video cases updated to the new signature and to explicit SDR tags / new titles |
| `src/ffmpeg/buildCommand.spec.ts` | Modified | Fixture gains `compressionResolution` |
| `src/ffmpeg/cases.spec.ts` | Modified | Compile-only: whatever the new required `EncodeInput` field needs to typecheck (e.g. passing `'1080p'`). No corpus JSON under `ffmpeg/` is edited, and its results are not a done signal |

### Part C — `worker` agent (REQ-17, added in 0.5.0)

| File | New / Modified | What changes |
| :-- | :-- | :-- |
| `src/metadata/container-tags.ts` | Modified | `buildSourceTag`: when `downloadPath` resolves to the same path as `inputFilePath`, return `basename(inputFilePath)` before the folder-relative branch. Every other branch unchanged |
| `src/metadata/container-tags.spec.ts` | Modified | Existing `buildSourceTag` cases moved to the three-argument signature (clears the two `TS2554` errors); new cases per § Tests |
| `services/worker/CLAUDE.md` | Modified | The `046` `sourceTag` paragraph names the three branches — loose file → base name, folder → relative to `downloadPath`, else `downloadsRoot`-relative or base name |

Not touched: `src/paths/is-inside-root.ts` and its spec (shared with `jobs/cleanup-source.ts`'s
deletion guard), `jobs/encode.job.ts` (the call site already passes all three arguments),
`src/ffmpeg/buildCommand.ts`, and `api`'s `uploads.service.ts` (storing the file as `downloadPath` is
what `scan-folder.ts` relies on for `LOCAL_FILE`; the tag adapts to it, not the other way round).

## Existing code to reuse

- `src/encode/content-kind.ts` — the exact template for `compression-resolution.ts`: a local union, a
  values array, a type guard, a normalizer that warns and defaults, never throws. Copy its shape; no
  comments in the new file (Article XI).
- `normalizeContentKind`'s call site in `handleEncode` — normalize at the same place, once, and pass
  the resolved value into both `EncodeInput` literals. Never re-validate inside `src/ffmpeg/`.
- The existing `[encode] <id>:` log line — append `compressionResolution=<value>`; do not add a second
  log line.
- `svtav1KindParams`, `getQuality`, `isRemux` in `params.ts`/`remux-detection.ts` — unchanged, reused
  by the single builder. CRF stays exactly as it is.
- Today's Dolby Vision / HDR10 side-data predicates in `getVideoParams` — lift them into the HDR-form
  classifier; do not rewrite detection from scratch. Split HLG (`arib-std-b67`) out as its own form.
- `.claude/agents/ffmpeg.md` § Governance — one argument builder, named predicates, deleting beats
  adding. The stale corpus (`ffmpeg/1.json`, `2.json`) is **not** a reference for this feature — do not
  read its expectations, run it as a guard, or update it (spec § Out of Scope).

## Steps

### Part A — `worker` agent

1. `src/encode/compression-resolution.ts` + its spec, modelled on `content-kind.ts`.
2. `src/encode/types.ts`: add the required field.
3. `src/jobs/encode.job.ts`: type field, selection set, normalize, log, both literals.
4. `src/jobs/encode.job.spec.ts`: cases below.
5. Update `services/worker/CLAUDE.md`.
6. Report. `tsc` will show errors in `src/ffmpeg/*.spec.ts` / `cases.spec.ts` for the new required
   `EncodeInput` field — expected, owned by Part B; do not fix them.

### Part B — `ffmpeg` agent

1. **Refactor with no rule change first.** Collapse `getVideoParams`' return sites into one builder
   parametrized by scale filter, colour tags and title. `params.spec.ts` must produce the
   same arguments as before this step (the doubled `:tune=0` on VC-1 may go; say so).
2. **Then the rule.** Add the `compressionResolution` parameter and implement, in this order of
   decision:
   - codec not in `h264`/`hevc`/`h265`/`vc1`/`av1` → copy (`-c:v copy`, title `Video (Direct Copy)`),
     `console.warn` naming the codec and that the ceiling was not applied when the source exceeds the
     box;
   - exceeds box? Boxes `4k` none, `1080p` 1920×1080, `720p` 1280×720, `480p` 854×480, `360p` 640×360;
     exceeds when `width > boxW × 1.02` or `height > boxH × 1.02`, on ffprobe's coded `width`/`height`;
   - `av1` and not exceeding → copy;
   - otherwise AV1 encode; when exceeding, `-vf scale=<boxW>:<boxH>:force_original_aspect_ratio=decrease:force_divisible_by=2`.
3. Colour tags by HDR form: DoVi / HDR10 → `-color_range tv -colorspace bt2020nc -color_primaries bt2020
   -color_trc smpte2084`; HLG → same with `-color_trc arib-std-b67`; SDR → `-color_range tv
   -colorspace bt709 -color_primaries bt709 -color_trc bt709`. Applied to every AV1 encode.
4. Titles (decided in `../plan.md`): `AV1 (Converted from <CODEC> <HDR>)` without scaling;
   `AV1 (Downscaled from <SOURCE> <CODEC> <HDR>)` with scaling — always plain `AV1`, never the target
   tier. `<CODEC>` ∈ `H264`/`HEVC`/`VC-1`/`AV1`; `<HDR>` ∈ `DoVi`/`HDR10`/`HLG`/`SDR`;
   `<SOURCE>` = label of the smallest box the source fits within tolerance, `4K` when it fits none
   below `4k`.
5. `buildCommand.ts`: pass `details.compressionResolution`.
6. `cases.spec.ts`: compile-only change for the new required field. Do not edit `ffmpeg/*.json`.
7. Report which rules changed so the orchestrator can rewrite `.claude/agents/ffmpeg.md` § Rules V2–V6
   (outside this agent's write scope).

### Part C — `worker` agent

1. Tests first, red: update `container-tags.spec.ts` to the three-argument signature and add the loose-file
   case, which must fail against today's code (it returns `''`).
2. `container-tags.ts`: add the loose-file check, reusing `resolve` from `node:path` for the equality —
   the same normalization `isInsideRoot` applies — so `/a/./b.mkv` and `/a/b.mkv` compare equal.
   No comment (Article XI).
3. Update `services/worker/CLAUDE.md`'s `sourceTag` paragraph.
4. Report the real typecheck output — it should now be 0 errors.

## Contract obligations

Consumes, from `../spec.md` § GraphQL Contract Delta:

```graphql
type EncodeJobDetails { compressionResolution: String! }
```

- Expected values `4k`, `1080p`, `720p`, `480p`, `360p` (lowercase `k`).
- Absent (`undefined` — an older `api`), `null`, or any other string → `1080p`, one warning, encode
  continues. Never a `KeyedError`, never `encodeFailed` on account of this field.
- Against an `api` that does not define the field, the `processJob` query itself errors (GraphQL
  validation) and `fetchGraphQL` throws — existing behaviour for any unknown field; deploy order
  (`api` first) is what prevents it, not a code path here.
- No new error key. FFmpeg failures while scaling go through the existing `encodeFailed` path. A
  failed encode is never retried as copy.

## Tests

- `src/encode/compression-resolution.spec.ts` — **owed**. A normalizer that throws fails every encode
  against an older `api`; one that passes an invalid string through makes `src/ffmpeg/` pick no box
  silently. Cases: each valid value verbatim; `undefined`, `null`, `''`, `'4K'`, `'garbage'` → `1080p`.
- `src/jobs/encode.job.spec.ts` — **owed**. The field dropped from the selection set or one literal
  compiles clean and encodes at `1080p` forever. Cases: the query text selects `compressionResolution`;
  a payload of `'480p'` reaches the `EncodeInput` handed to the driver; an absent value reaches it as
  `'1080p'`.
- `src/ffmpeg/params.spec.ts` — **owed**, the core of NFR-2. Synthetic streams (no real file needed):
  - every tier × source below the box, exactly the box, box +2% (fits), box +2% +1px on width only and
    on height only (exceeds): scale present only when exceeding;
  - `4k` with a 4096×2160 and a 7680×4320 source: never scaled;
  - scope 1920×800 under `1080p` (fits), 2560×1440 under `1080p` (exceeds), 720×480 under `480p` (fits);
  - codecs: `h264`/`hevc`/`vc1` fitting → encoded, no `-vf`; `av1` fitting → copy; `av1` exceeding →
    encoded with scale; `mpeg2video` exceeding → copy, warning logged;
  - HDR: DoVi, HDR10, HLG (`arib-std-b67` transfer), SDR tag sets — including an `av1` HDR source
    exceeding the box;
  - titles for converted and downscaled forms, asserting the downscaled one starts `AV1 (` with no tier.
- `ffmpeg/1.json`, `ffmpeg/2.json` via `cases.spec.ts` — **not used**. Stale, excluded from this feature;
  real-file validation happens later, separately.
- `src/ffmpeg/buildCommand.spec.ts` — fixture update only; its pre-existing CRF mismatch is not this
  feature's.
- `src/metadata/container-tags.spec.ts` — **owed** (NFR-5). An empty or wrong provenance tag fails
  nothing and is only noticed when someone needs it. Cases, all with explicit three arguments:
  - loose file: `downloadPath` === `inputFilePath` (`/downloads/imports/abc/Some.Release-GRP.mkv`) →
    `Some.Release-GRP.mkv`, non-empty, no slash;
  - same, with a non-normalized but equivalent `downloadPath` → same base name;
  - folder: `downloadPath` `/downloads/Some.Release-GRP`, input inside it → path relative to that folder;
  - `downloadPath` null, input inside `downloadsRoot` → `downloadsRoot`-relative (046 AC-4);
  - `downloadPath` not containing the input → `downloadsRoot`-relative;
  - input outside `downloadsRoot`, `downloadPath` null → base name, no slash (046 AC-5).

## Done when

```bash
bin/cli worker npx --no tsc --noEmit
bin/npm worker run build
bin/npm worker test
```

After Part B: typecheck shows only the 2 pre-existing `src/metadata/container-tags.spec.ts` errors.
After Part C: typecheck shows 0 errors, and `git diff --stat services/worker/src/paths` is empty;
build exits 0; `bin/npm worker test` passes except the pre-existing `buildCommand.spec.ts` CRF
mismatch and `src/ffmpeg/cases.spec.ts`, whose result is ignored. Report real suite and test counts.
