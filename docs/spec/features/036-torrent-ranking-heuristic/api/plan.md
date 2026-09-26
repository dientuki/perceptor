---
title: Torrent Ranking Heuristic — api slice
service: api
spec_version: 0.8.0
last_updated: 2026-09-26
status: Approved
---

# PLAN: Torrent Ranking Heuristic — `api` (`api/plan.md`)

## Scope

`spec_version` 0.8.0 only — REQ-8's codec ranks by resolution tier, and the narrowing of REQ-11's
criterion-4 skip to tier 5. Everything else in this feature shipped in `web` between `0.1.0` and
`0.7.0` and is described in `web/plan.md`, which is left as the record of a module that no longer
lives there: `073-automatic-episode-acquisition` moved the heuristic to
`services/api/src/indexer/ranking.ts` and deleted `services/web/src/lib/torrent-ranking.ts`. This is
the first slice of `036` that `api` owns, and it is a **correction to an implemented requirement**,
not new behaviour.

No GraphQL field, no Prisma column, no migration, no new module, no i18n key. `codecRank` and
`codecLabel` already exist on `ReleaseRanking`; the labels do not change and the rank does not change
type. `web` and `worker` are out of scope — an agent editing either has left its slice.

## Files

| File | Change |
| :-- | :-- |
| `services/api/src/indexer/ranking.ts` | `codec()` takes the resolution tier and returns the tier's rank table; `buildRanking()` passes it; `compareCandidates()` gates criterion 4's disc-source skip on the tier. One new constant for the 4K tier. |
| `services/api/src/indexer/ranking.spec.ts` | Two existing tests rewritten (they assert the pre-`0.8.0` result), five acceptance criteria added. |

Nothing else. In particular **not** `ranking-context.service.ts` (what arms the ranking does not
change), `indexer.service.ts`, `indexer.resolver.ts`, `entities/torrent-result.entity.ts`,
`schema.gql`, `prisma/`, or `src/clients/indexer/score.ts` — still dead, still untouched
(`spec.md` § Out of Scope).

## Existing code to reuse

- `resolution(title)` already runs first inside `buildRanking` and already returns the tier REQ-8
  now needs. Nothing re-parses the title; the value is passed, not recomputed.
- `DISC_SOURCE_MIN_RANK` is the pattern for the new tier constant — a module-level `const` named
  after the rule, not a literal `5` inside two expressions.
- `compareCandidates`'s existing `bothFromDisc` local is the precedent for reading a value off `a`
  alone: rows 1–3 have already tied by the time row 4 is reached, so the tier is the same on both
  sides (`spec.md` REQ-11, as amended).
- The three codec regexes stay exactly as they are. This amendment changes no parse — only what the
  parse is worth at a given tier — and the labels it returns are the same three strings.

## Steps

### `spec_version` 0.8.0 — the codec ranks depend on the tier

1. **The constant.** Add `const UHD_RESOLUTION_TIER = 5;` beside `DISC_SOURCE_MIN_RANK`. Both
   decisions below read it, so the tier number appears once.

2. **The rank table.** `codec(title, resolutionTier)`. Detect HEVC and AVC with the existing
   regexes, then return per REQ-8: at `resolutionTier >= UHD_RESOLUTION_TIER`, HEVC 3 / AVC 2 /
   unrecognised 0; below it, AVC 3 / unrecognised 2 / HEVC 1. Labels unchanged in both branches.
   Prefer a shape where the two tables are visible side by side over one with arithmetic in it — a
   reader must be able to check this function against REQ-8's table by eye.

3. **The call site.** `buildRanking` already holds `const res = resolution(title)` two lines above
   the `codec(...)` call. Pass `res.tier`. Nothing else in that function moves.

4. **The comparator.** Criterion 4's arm becomes conditional on the tier as well as on disc-ness —
   the skip now needs `bothFromDisc && a.ranking.resolutionTier >= UHD_RESOLUTION_TIER`. Criterion
   6 (audio) keeps `bothFromDisc` alone. The two arms no longer read alike, and that is the
   requirement: do not factor them back together (`spec.md` REQ-10, REQ-11; `plan.md` § Contract
   Freeze).

## Contract obligations

`spec.md` § GraphQL Contract Delta is **None** and stays None. `ReleaseRanking.codecRank` keeps its
name and its `Int!` type; `codecLabel` keeps its exact three values. `web` retypes this schema by
hand with no codegen (Article VIII), so a field rename here would fail at runtime with no compile
error anywhere — there is no reason to touch one.

The one thing an implementer must record rather than assume: `codecRank` is **no longer comparable
across tiers**. A 1080p `x264` and a 2160p `x265` both report 3. Nothing in `web` renders the number
(it selects `codecRank` and displays `codecLabel`), and the sweep reads `candidateRank`, so no
consumer breaks — but the number's meaning changed, which is why a test pins it (T025).

## Tests

`api` has jest, which is the whole reason this correction is cheap where the `0.5.0`–`0.7.0`
amendments were expensive: `web/plan.md` § Tests recorded the missing runner as the feature's main
risk and named moving the heuristic to `api` as the fix. That already happened.

`services/api/src/indexer/ranking.spec.ts`, via the existing `release()` / `ordered()` helpers:

| Case | Asserts |
| :-- | :-- |
| 1080p `WEB-DL` pair, the `x265` **larger** → `x264` leads | **AC-19** |
| 2160p `WEB-DL` pair, the `x265` **smaller** → `x265` leads | **AC-20** |
| 1080p `BluRay` pair, the `x265` **larger** → `x264` leads | **AC-21** |
| 2160p `UHD BluRay Remux` pair, terse and **larger** vs `x265 TrueHD Atmos` → terse leads | **AC-22** |
| three 1080p `BluRay` releases → `x264`, untagged, `x265` | **AC-23** |
| `codecRank` read directly: 1080p `x264` → 3, 2160p `x265` → 3 | the tier dependency, § Contract obligations |

Two existing tests assert the pre-`0.8.0` result and must be **rewritten, not deleted**:
`'skips codec and audio between two disc sources'` (its pair is 1080p, where codec now decides — it
becomes the 2160p case above) and `'still compares codec between two web sources'` (it expects the
1080p `x265` to lead — the expectation inverts). Rewriting them is the evidence the rule changed;
deleting them loses the only assertions that would catch it changing back.

## Done when

```bash
bin/npm api run test -- src/indexer
```

```bash
bin/cli api npx --no tsc --noEmit
```

- Every suite green, each of AC-19 … AC-23 traceable to a named test, suite/test counts stated
  before and after.
- Typecheck at the baseline 0 errors.
- `git status --short services/api/prisma` empty, `services/api/schema.gql` absent from
  `git diff --name-only`, `git diff --stat services/web services/worker` empty.
- `git diff --stat services/api` names exactly two files.
