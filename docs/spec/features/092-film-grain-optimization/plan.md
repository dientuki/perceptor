---
title: Film Grain Optimization — Implementation Plan
spec_version: 0.1.0
last_updated: 2026-10-15
status: Implemented
---

# PLAN: Film Grain Optimization (`plan.md`)

## Approach

This feature is `057-content-kind-classification` run a second time, with one deliberate
difference at the end of the chain. Everything up to the worker is the shape `057` already proved:
a Prisma enum column on `Movie` and `Show` with a safe default, a GraphQL enum registered once in
`src/media/entities/`, one `set*` mutation per media type following
`setMovieContentKind`/`setShowContentKind` byte for byte (including their asymmetry — the film's
ownership gate lives in `MoviesService`, the series' in `ShowsResolver`), a controlled `<select>` in
`web` cloned from `ContentKindSelect.tsx`, and a field on `EncodeJobDetails` the worker normalizes
defensively before use.

The difference is that `contentKind` is a single value read straight off the title, while
`grainMode` is a **two-level resolution** — the title's override over the installation's switch —
and the result still carries a third state the worker must decide for itself. So the chain splits
in two, at two places that already exist:

- **`api` resolves the override over the setting**, in a new pure function
  `services/api/src/settings/grain-mode.ts`, directly modelled on
  `settings/subtitle-formats.ts`'s `resolveAllowedSubtitleFormats` — same directory, same
  "pure function fed `settingsMap`, called once from `getEncodeJobDetails`" shape, same reason (the
  worker authenticates as a service principal and cannot read the admin-only `settings` query). It
  collapses three inputs into the two-valued-plus-`AUTO` `EffectiveGrainMode` the contract freezes.
  `INHERIT` never crosses the wire.
- **`worker` resolves `AUTO`**, in a new `services/worker/src/encode/grain-mode.ts` that mirrors
  `encode/content-kind.ts` exactly: a locally-retyped union, a `normalizeGrainMode` that degrades an
  absent/unrecognised value to `OFF` and logs, and — the part that is new — a `resolveFilmGrain`
  that answers the boolean question. In this feature `resolveFilmGrain` returns `false` for `AUTO`
  unconditionally. It is the single seam the next spec replaces.

**Where `resolveFilmGrain` is called is the one real design choice here, and it is not where the
other `normalize*` calls live.** `encode.job.ts` normalizes `contentKind`, `compressionResolution`,
`libraryLayout` and `allowedSubtitleFormats` the moment the query returns — but at that point the
worker has not probed the file, and a grain heuristic that cannot see the source is not a
heuristic. `buildFfmpegCommand` (`src/ffmpeg/buildCommand.ts`) already receives the parsed `ffprobe`
`metadata` alongside `details`, so the resolution happens there, one line above the existing
`getVideoParams` call, and the boolean is what reaches `params.ts`. `EncodeInput` therefore carries
the tri-state `grainMode`, not a boolean, and `params.ts` stays boolean-driven and pure. The next
spec gets the probed metadata handed to it for free and touches one function in one service.

That placement also satisfies REQ-10 structurally rather than by a check someone has to remember:
with `compression_enabled` off the worker takes the `passthrough` path, which never calls
`buildFfmpegCommand` and ignores `EncodeInput` entirely, so the grain mode is never resolved and no
`[grain]` line is ever printed. The one place that could still speak out of turn is
`normalizeGrainMode` in `encode.job.ts`, which runs before the branch — so it is gated on the
existing `compressing` boolean, and the control in `web` is locked the same way the subtitle
controls already are when compression is off.

Inside `params.ts` the change is the smallest one that satisfies REQ-8: `svtav1KindParams` takes a
second `filmGrain: boolean` parameter and each of its three `case` arms substitutes its trailing
`film-grain=0` for `film-grain=8:film-grain-denoise=1`. The three arms stay three arms — `057` split
them on purpose and this feature is not the one that merges them.

Reused rather than rebuilt: `settings/subtitle-formats.ts` (the resolver shape),
`media/entities/content-kind.enum.ts` (the `registerEnumType` placement),
`MediaCapabilitiesService.assertEnabled` (the type gate, before the ownership read),
`MoviesService.findOneFromDb` / `ShowsService.findOneFromDb` (the ownership gate),
`withDerivedStatus` / `deriveSeasonEpisodeStatuses` (the mutation return shapes),
`web`'s `ContentKindSelect.tsx` (the controlled-select-with-revert), `CompressionPanel.tsx`'s
`Switch` + hidden-input idiom, `actions/settings.ts`'s `BOOLEAN_KEYS`, and the worker's
`content-kind.ts` normalizer.

## Order of Work

`api` first and alone: it owns the migration, the two enums and the resolved field, and neither
consumer can be typechecked against a schema that does not have them yet. `web` and `worker` then
run **in parallel** — they share no file, and the contract between them and `api` is frozen by this
document. The docs step closes.

| Step | Service | Why it must come here |
| :-- | :-- | :-- |
| 1 | `api` | Owns the Prisma enum + two columns, the `GrainMode`/`EffectiveGrainMode` GraphQL enums, the two mutations, the catalog entry and the seed. Everything below reads what this step publishes. |
| 2a | `web` | Cannot render `Movie.grainMode` or call `setMovieGrainMode` before step 1 exists. Independent of 2b. |
| 2b | `worker` | Cannot select `EncodeJobDetails.grainMode` before step 1 exists. Independent of 2a. |
| 3 | `docs` | A `092` section in `docs/spec/graphql-contract.md` recording the two-enum split and why `INHERIT` never crosses the wire, plus the three `CLAUDE.md` touch-ups. Written once both consumers are real. |

2a and 2b may genuinely overlap. Nothing before step 1 may, and neither consumer may start by
"temporarily" adding the field it wants to `api`.

## Contract Freeze

The `## GraphQL Contract Delta` in `../spec.md` is frozen as of `status: Approved`. Three things an
implementer will be tempted to change and must not:

- **Two enums, not one.** `GrainMode` (`INHERIT`/`ON`/`OFF`) is what a title stores and what the two
  mutations accept; `EffectiveGrainMode` (`AUTO`/`ON`/`OFF`) is what `EncodeJobDetails` exposes. From
  inside `api` this looks like duplication worth collapsing into one four-valued enum. It is not:
  a single enum would make `INHERIT` and `AUTO` both reachable on the wire in both directions, and
  the worker would have to decide what an unresolved `INHERIT` means — which is exactly the decision
  this split moves to `api`, where the Settings row lives. The `worker` slice must treat a literal
  `INHERIT` on the payload as unrecognised (→ `OFF` + log), never as "look up the setting".
- **`EncodeJobDetails.grainMode` is non-null.** It is always resolvable: a title always has a
  `grainMode` column and the setting always reads as a boolean. Do not make it nullable to express
  "compression is off" — `compressionEnabled` already says that, and the worker's passthrough path
  ignores `EncodeInput` entirely.
- **No `Episode.grainMode`.** The episode arm of `getEncodeJobDetails` resolves its **series'**
  value, exactly as it does for `contentKind`. Adding a per-episode column, or a per-episode control
  in `web`, is out of contract.

If the contract turns out to be wrong: stop, amend `spec.md`, re-approve, re-brief all three
services (Article VIII). Never patch it from inside one slice.

## Migrations

1. `add_grain_mode` — `enum GrainMode { INHERIT ON OFF }`, plus
   `Movie.grainMode GrainMode @default(INHERIT)` and `Show.grainMode GrainMode @default(INHERIT)`,
   both non-null. Generated through `bin/npm api run prisma:migrate` (Article III); a modified
   `schema.prisma` without a new migration directory, or the reverse, is the violation that article
   names.
2. Backfill: **none**. The column default covers every existing row, and NFR-2 is satisfied by
   construction — every pre-existing title reads `INHERIT`, which with `grain_auto_enabled` absent
   (REQ-2) resolves to `OFF`, which is byte-identical to today's `film-grain=0` output.
3. Seed: `{ key: 'grain_auto_enabled', value: 'false' }` appended to
   `prisma/seeds/settings.ts`'s list. Create-only like every other key there, so re-running never
   clobbers an administrator's choice.

Reversibility: dropping the two columns and the enum is safe as long as the `worker` and `web`
slices go with them — a `web` that still sends `setMovieGrainMode` against a rolled-back `api` gets
a GraphQL validation error, loudly, which is the acceptable failure. A `worker` that still selects
`grainMode` would fail its whole `processJob` query, which is **not** acceptable: roll the worker
back first, or never roll back past step 1.

## Risks

| Risk | How it fails | Mitigation |
| :-- | :-- | :-- |
| The absent `grain_auto_enabled` row is read with `!== 'false'` | An upgraded installation reads as *on* while the Settings tab, which reads `=== 'true'`, renders the switch *off* — the stored state and the displayed state disagree, and saving any unrelated tab writes the displayed value back | REQ-2 names `=== 'true'` as the one rule, on both sides; `api`'s `grain-mode.spec.ts` covers the absent row and the `'maybe'` row as fault injection (flip the operator, watch the case fail) |
| The episode arm reads an episode-level value that does not exist, or falls back to the default | Every episode of a series set to `ON` encodes grain-free. No error anywhere — the file is produced, just wrong | The episode arm reuses the exact line `contentKind` already uses (`show.grainMode`); `process-jobs.service.spec.ts` gains a case asserting the series' value reaches an episode job |
| `grainMode` is added to `EncodeJobDetails` but not to the worker's hand-written query string in `encode.job.ts` | `details.grainMode` is `undefined`, `normalizeGrainMode` degrades it to `OFF`, and the encode succeeds producing today's output. **There is no codegen and no compile error** — the feature simply never works, in exactly the way that looks like it works | NFR-3's warning is mandatory, not optional. The decision itself is taken while the FFmpeg command is built, so `resolveFilmGrain` logs the mode it resolved there — on the compressing path only, beside the command that proves it — and AC-3's live pass reads that line |
| `film-grain-denoise=1` is left in the string when grain is off | A denoise pass runs with no grain synthesis — softer output, smaller file, no error | REQ-7 states it as an absence, not just a value; `params.spec.ts` asserts `not.toContain('film-grain-denoise')` on the off path for all three kinds |
| The resolution is snapshotted onto `ProcessJob` for "consistency" | A title's value changes and the next job still uses the old one, indefinitely | NFR-4 forbids it; the plan resolves inside `getEncodeJobDetails`, which is called per job per worker request, the same moment `048` resolves the short root |
| `MediaCapabilitiesService.assertEnabled` is called after the ownership read | A caller with the type disabled learns whether an id exists | The comment in `setShowContentKind` already states the ordering; both new mutations copy it |

## Verification

```bash
bin/cli api npx --no tsc --noEmit
bin/npm api test
bin/cli api npx --no prisma migrate status
bin/cli web npx --no tsc --noEmit
bin/cli web node scripts/check-messages.mjs
bin/cli worker npx --no tsc --noEmit
bin/npm worker test
bin/comments api && bin/comments web && bin/comments worker
git status --short services/api/prisma
git diff services/api/src/schema.gql
```

`git status --short services/api/prisma` must show a modified `schema.prisma` **and** one new
migration directory. The `schema.gql` diff must match `../spec.md` § GraphQL Contract Delta and
nothing else (Article VIII's Check).

The manual pass, against `bin/dev`:

1. `/settings` → Compression: the **Automatic Grain Optimization** switch renders off on an
   upgraded database. Save the tab; `bin/mysql -e "select value from settings where \`key\` =
   'grain_auto_enabled'"` reads `false` (**AC-9**).
2. A film's detail page shows **Grain Optimization** below the short switch, on *inherit*. Encode
   it and read the `[encode]` log line plus the FFmpeg command: `film-grain=0`, no
   `film-grain-denoise` (**AC-1**).
3. Set it to **on**, re-encode, diff the two `-svtav1-params` strings: only the grain terms differ
   (**AC-2**).
4. Turn the Settings switch **on**, set the film back to *inherit*, re-encode: still `film-grain=0`,
   and the worker logs that it resolved `AUTO` (**AC-3**). Set the film to **off** with the switch
   still on: `film-grain=0` (**AC-4**).
5. Set a series to **on**, encode one episode: grain parameters present, and no episode row anywhere
   offers a control (**AC-5**). Repeat with an `ANIME` series and compare the kind terms (**AC-6**).
6. Call `setMovieGrainMode` for a film the caller does not own (a second user's library, from the
   GraphQL playground): `error.movie.not_found`, and `bin/mysql -e "select grainMode from movies
   where id = <id>"` still shows the previous value (**AC-7**).
7. Point the worker at an `api` returning `null` for `grainMode` (or hand-edit the query to drop the
   field): the encode completes, produces `film-grain=0`, and logs exactly one `[grain]` warning
   (**AC-8**).
8. Start an encode, change the film's value mid-flight, let it finish: the running job's command is
   unchanged; the next one picks the new value up (**AC-10**).
9. Turn `compression_enabled` **off**: the Automatic Grain Optimization switch renders disabled at
   its stored value and saving the tab leaves the row unchanged. Encode a film set to **on**: the
   file is moved with no FFmpeg invocation, and the worker log carries no `[grain]` line at all
   (**AC-12**).
