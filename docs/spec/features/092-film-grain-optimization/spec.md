---
title: Film Grain Optimization
spec_version: 0.1.0
author: Juan "Dientuki" Farias
created_at: 2026-10-15
last_updated: 2026-10-15
status: Implemented
services: [api, web, worker]
---

# SPEC: Film Grain Optimization (`spec.md`)

## Context & Goal

Every AV1 encode this project produces today is grain-free. `services/worker/src/ffmpeg/params.ts`
builds one `-svtav1-params` string per job, and all three `contentKind` branches of
`svtav1KindParams()` end in the same hardcoded `film-grain=0`. For a grainy source — a film shot on
stock, a scan of an older print, and plenty of older anime — that is the wrong call twice over:
SVT-AV1 spends bitrate encoding the grain as detail instead of synthesising it, and what survives
the downscale looks smeared rather than filmic. The parameters that would handle it,
`film-grain=8:film-grain-denoise=1`, exist in the encoder and are simply never reachable.

This feature makes that choice configurable at two levels, mirroring the shape
`057-content-kind-classification` already established for `contentKind`. An installation-wide
Settings → Compression switch, **Automatic Grain Optimization**, says what to do when nobody has
decided for a specific title. Each film, short and series carries its own **Grain Optimization**
control on its detail page, below the "register as short" switch, with three values —
inherit / on / off — and the title's own value always wins over the installation's. An episode is
never classified on its own: it reads its series' value, exactly as `contentKind` does.

The decision reaches FFmpeg the way every other encode-shaping value does. `api` resolves the
per-title override over the installation setting at `getEncodeJobDetails` time and hands the worker
one already-effective tri-state on `EncodeJobDetails`; the worker turns that into the two SVT-AV1
parameters. `AUTO` — the state that only survives when the title inherits *and* the installation
switch is on — is resolved **inside the worker** by a function that, in this feature, unconditionally
answers "no grain". That stub is deliberate: refining it into a real source-analysis heuristic is the
whole subject of the next spec, and keeping it in the worker is what lets that spec touch exactly one
service and read the source file it will need. Pipeline stages touched: **Transcode** (the parameter
branch) and, for the stored values, **Register title in DB**. No stage changes status.

## Requirements

### Functional Requirements

- [ ] **REQ-1 (Installation switch)**: Settings → Compression must carry a boolean
      **Automatic Grain Optimization** control, persisted as the `grain_auto_enabled` Setting, saved
      through the same `updateSettings` call as every other field on that screen. It is a single
      yes/no control with no sub-options.
- [ ] **REQ-2 (Default off)**: An installation that predates this feature, or one whose row is
      absent, must read as **off** — the `=== 'true'` idiom `shorts_enabled` uses, never
      `!== 'false'`. A heuristic nobody has enabled must not switch itself on at upgrade.
- [ ] **REQ-3 (Per-title override)**: A film's and a series' detail page must carry a
      **Grain Optimization** control, placed below the short switch in the right-hand column, with
      exactly three values: inherit (the default), on, off. It writes `Movie.grainMode` /
      `Show.grainMode` and takes effect on the next encode, never on a file already written.
- [ ] **REQ-4 (Shorts included)**: A film registered as a short is a `Movie` and carries the same
      control on the same page. There is no separate short-only behaviour.
- [ ] **REQ-5 (Episodes inherit the series)**: An episode has no grain setting of its own and no
      control anywhere. Its encode reads its series' `grainMode`, the same rule `contentKind`
      follows.
- [ ] **REQ-6 (Resolution order)**: `api` must resolve, per encode job: a title whose `grainMode` is
      `ON` or `OFF` yields that value outright; a title on `INHERIT` yields `AUTO` when
      `grain_auto_enabled` is on and `OFF` when it is off. The installation switch is never consulted
      for a title that decided for itself.
- [ ] **REQ-7 (Worker parameters)**: With the effective value `ON`, the job's `-svtav1-params` must
      carry `film-grain=8:film-grain-denoise=1` in place of `film-grain=0`; with `OFF` it must carry
      `film-grain=0` and no `film-grain-denoise` term at all. Every other parameter in the string is
      unchanged.
- [ ] **REQ-8 (All three content kinds)**: The substitution applies to the `LIVE_ACTION`, `ANIME` and
      `CGI` branches alike — an older anime can be grainy. The three branches stay independently
      editable, as `057` left them; this is one substitution applied in three places, not a
      collapse of the three into one.
- [ ] **REQ-9 (AUTO is the worker's to resolve)**: The worker must resolve `AUTO` through a single
      named function of its own, which in this feature returns "no grain" for every input, with no
      source inspection, no ffprobe read and no configuration. It is the only thing the next spec
      replaces.
- [ ] **REQ-10 (Compression off means no grain at all)**: With `compression_enabled` off nothing in
      this feature runs. The worker runs no FFmpeg (`032`), so the grain mode is never resolved, no
      grain parameter is produced and no `[grain]` log line appears. The Settings control is locked
      the way the subtitle controls already are — disabled, state preserved, never cleared — so
      re-enabling compression restores the administrator's choice untouched.

### Non-Functional & Operational Requirements

- [ ] **NFR-1 (No new round trip)**: The effective value must ride the `settings.getMap()` call and
      the title row `getEncodeJobDetails` already reads. No extra query, no extra Setting read, no
      extra TMDB or torrent-client call.
- [ ] **NFR-2 (Backfill-free migration)**: `Movie.grainMode` / `Show.grainMode` are added with a
      default of `INHERIT`, so every existing row reads as inherit with no data migration and the
      installation's own (off, per REQ-2) answer applies to the whole library on day one.
- [ ] **NFR-3 (The worker trusts nothing)**: An absent, null or unrecognised `grainMode` on the
      payload must degrade to `OFF` and log once, never throw and never fail an encode — the same
      posture `normalizeContentKind` and `normalizeCompressionResolution` already take.
- [ ] **NFR-4 (No snapshot)**: The effective value is resolved at the moment the worker asks for the
      job's details, never stored on `ProcessJob`. Changing a title's value while a job is in flight
      leaves that job with whatever it was already handed — the `048` short-root rule.

## GraphQL Contract Delta

```graphql
enum GrainMode {
  INHERIT
  ON
  OFF
}

"""The value the worker consumes — already resolved, never INHERIT."""
enum EffectiveGrainMode {
  AUTO
  ON
  OFF
}

type Movie {
  grainMode: GrainMode!
}

type Show {
  grainMode: GrainMode!
}

type EncodeJobDetails {
  grainMode: EffectiveGrainMode!
}

type Mutation {
  setMovieGrainMode(movieId: Int!, grainMode: GrainMode!): Movie!
  setShowGrainMode(showId: Int!, grainMode: GrainMode!): Show!
}
```

No new `Setting` type or argument: `grain_auto_enabled` is an ordinary `kind: 'boolean'` catalog
entry, read and written through the existing `settings` / `updateSettings` pair.

| Condition | HTTP / GraphQL error | Message the user sees |
| :-- | :-- | :-- |
| `setMovieGrainMode` for an id the caller does not own, or that does not exist | `NotFoundException`, key `error.movie.not_found` | `La película {id} no existe` |
| `setShowGrainMode` for an id the caller does not own, or that does not exist | `NotFoundException`, key `error.show.not_available` | `Recurso no disponible para este usuario` |
| `setMovieGrainMode` while `movies_enabled` is off | `BadRequestException`, key `error.media.type_disabled` | `Las películas están deshabilitadas en esta instalación` |
| `setShowGrainMode` while `shows_enabled` is off | `BadRequestException`, key `error.media.type_disabled` | `Las series están deshabilitadas en esta instalación` |
| `updateSettings` with `grain_auto_enabled` set to anything but `"true"`/`"false"` | `BadRequestException`, key `error.setting.expected_boolean` | `"grain_auto_enabled" debe ser "true" o "false"` |

Every key above already exists (`error.movie.not_found`, `error.show.not_available`,
`error.media.type_disabled`, `error.setting.expected_boolean`); this feature introduces none. The
ordering is the one `setShowContentKind` established: `assertEnabled` **before** the ownership read,
so a caller with the type disabled never learns whether the id exists. Consumers:

- **`web`** — both mutations are called from a controlled `<select>` and revert to the previous value
  on a refusal, rendering the translated message inline beside the control (never `alert()`). It
  copies `ContentKindSelect`'s controlled shape, **not** the shorts `Switch`'s key-remount trick.
  `web` never selects `EncodeJobDetails.grainMode`.
- **`worker`** — adds `grainMode` to `encode.job.ts`'s `EncodeJobDetails` query and normalizes it per
  NFR-3. An `api` that has not shipped this field yet yields `undefined`, which NFR-3 turns into
  `OFF`: today's behaviour exactly.

## Data Model Changes

| Model | Change | Nullable / default | Backfill needed? |
| :-- | :-- | :-- | :-- |
| *(enum)* | `enum GrainMode { INHERIT, ON, OFF }` | — | no |
| `Movie` | `+ grainMode GrainMode` | non-null, `@default(INHERIT)` | no (NFR-2) |
| `Show` | `+ grainMode GrainMode` | non-null, `@default(INHERIT)` | no (NFR-2) |
| `Episode` | none — reads its series (REQ-5) | — | — |

`EffectiveGrainMode` is a GraphQL-only enum; it is never stored. One migration, one new Prisma enum,
two columns. The `grain_auto_enabled` Settings row is created by the production seed as `"false"`,
create-only like every other seeded key — and REQ-2 means an install that never receives it behaves
identically.

## Acceptance Criteria

- [x] **AC-1**: With `grain_auto_enabled` off and a film on `INHERIT`, encoding that film logs an
      FFmpeg command whose `-svtav1-params` contains `film-grain=0` and no `film-grain-denoise`.
- [x] **AC-2**: Setting that same film's Grain Optimization to **on** and re-encoding it produces
      `-svtav1-params …:film-grain=8:film-grain-denoise=1`, with `keyint=10s:scd=1:enable-overlays=1:tune=0:input-depth=10`
      and the kind-specific terms byte-identical to AC-1's.
- [x] **AC-3**: With `grain_auto_enabled` **on** and the film back on `INHERIT`, the encode still
      produces `film-grain=0` — the stub answers "no grain" (REQ-9) — and the worker logs that it
      resolved `AUTO`.
- [x] **AC-4**: With `grain_auto_enabled` on and the film set to **off**, the encode produces
      `film-grain=0`: the title's own value wins over the installation switch (REQ-6).
- [x] **AC-5**: Setting a series to **on** and encoding any episode of it produces the grain
      parameters; no episode row anywhere exposes a control of its own (REQ-5).
- [x] **AC-6**: A series whose `contentKind` is `ANIME`, set to **on**, encodes with
      `scm=2:aq-mode=2:enable-qm=1:qm-min=4:sharpness=2:film-grain=8:film-grain-denoise=1` — the
      kind's own terms unchanged, only the grain pair substituted (REQ-8).
- [x] **AC-7** *(failure path)*: `bin/cli api npx --no ts-node -e` — or any direct GraphQL call —
      invoking `setMovieGrainMode` for a film id the caller does not own returns
      the `error.movie.not_found` message with `extensions.i18n.key = "error.movie.not_found"`, and
      `bin/mysql -e "select grainMode from movies where id = <id>"` still shows the previous value.
- [x] **AC-8** *(failure path)*: With compression on and the worker's `EncodeJobDetails` query
      hand-edited to request a field `api` does not send (or `api` stubbed to return `null` for
      `grainMode`), an encode still completes, produces `film-grain=0`, and logs one `[grain]`
      warning naming the unrecognised value — it does not throw (NFR-3).
- [x] **AC-9**: `bin/mysql -e "select value from settings where \`key\` = 'grain_auto_enabled'"` on a
      database upgraded from before this feature returns no row or `false`, and the Compression tab
      renders the switch off (REQ-2).
- [x] **AC-10**: Changing a film's Grain Optimization while one of its encodes is already running
      leaves that running job's command untouched; the next job picks up the new value (NFR-4).
- [x] **AC-11**: `bin/npm api test`, `bin/cli api npx --no tsc --noEmit`, `bin/cli web npx --no tsc
      --noEmit`, `bin/cli worker npx --no tsc --noEmit` and `bin/cli web node
      scripts/check-messages.mjs` all pass, the last confirming `en.json`/`es.json` parity after the
      new keys.
- [x] **AC-12** *(failure path)*: With `compression_enabled` off, the Compression tab renders the
      Automatic Grain Optimization switch disabled at whatever value it already held, saving the tab
      leaves `grain_auto_enabled` unchanged in the database, and encoding a film set to **on**
      produces no FFmpeg invocation, no grain parameter and no `[grain]` line anywhere in the
      worker log (REQ-10).

## Out of Scope

- **The automatic heuristic itself.** REQ-9's function returns "no grain" and nothing else. Detecting
  grain from the source — ffprobe statistics, a sample decode, a per-title analysis cache — is the
  next spec's entire subject, and this one exists partly to give that spec a single seam to replace.
- **A per-title grain *strength*.** `film-grain=8` and `film-grain-denoise=1` are constants. A
  control that exposes the 0–50 range, or a per-`contentKind` strength, would multiply the decision
  surface before anyone knows whether 8 is right.
- **Re-encoding anything already in the library.** Changing a value never touches a file already
  written (Article XII), and this feature adds no bulk re-encode path.
- **A per-user preference.** Grain is a property of the source and the installation's taste, not of
  whoever happens to own the title — the same reasoning that keeps `contentKind` and `isShort` off
  the per-user ownership rows.
- **Deriving an initial value at registration.** Unlike `isShort` and `contentKind`, `grainMode`
  starts at `INHERIT` for every title and is never inferred from TMDB. There is no TMDB field that
  would answer this.
