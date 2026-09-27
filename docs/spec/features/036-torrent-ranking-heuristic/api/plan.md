---
title: Torrent Ranking Heuristic — api slice
service: api
spec_version: 0.9.0
last_updated: 2026-09-27
status: Approved
---

# PLAN: Torrent Ranking Heuristic — `api` (`api/plan.md`)

## Scope

`spec_version` 0.8.0, its `0.8.1` correction and the `0.9.0` amendment that supersedes that
correction at tier 5 — REQ-8's codec ranks by resolution tier, REQ-4d's 4K AVC veto, REQ-8's inferred
tier-5 label, **REQ-7b's tier-decided UHD-ness** (`0.9.0`'s second pass, 2026-09-27), and the
narrowing of REQ-11's criterion-4 skip to tier 5. Everything else in this feature shipped in `web` between `0.1.0` and
`0.7.0` and is described in `web/plan.md`, which is left as the record of a module that no longer
lives there: `073-automatic-episode-acquisition` moved the heuristic to
`services/api/src/indexer/ranking.ts` and deleted `services/web/src/lib/torrent-ranking.ts`. This is
the first slice of `036` that `api` owns, and it is a **correction to an implemented requirement**,
not new behaviour.

**What is already on disk** (normalized 2026-09-27 — `0.8.0` shipped in `de41706` on 2026-09-26, in
the commit that wrote the amendment, which is why its tasks read as pending): steps 1, 3 and 4 below
are **done**, step 2 is done for `0.8.0`'s numbers, and `0.8.1`'s numbers were never written. What
remains is `0.9.0` — the tier-5 unrecognised branch (step 2's last clause), the veto (step 2b) and
`source()`'s tier (step 5) — plus the tests in § Tests that carry AC-20 and AC-24 … AC-31. Read
§ "The `0.9.0` delta, in one place" and treat it as the task list.

No GraphQL field, no Prisma column, no migration, no new module, no i18n key. `codecRank`,
`codecLabel`, `sourceRank` and `sourceLabel` already exist on `ReleaseRanking`; none changes type.
`codecLabel`'s three values are unchanged; `sourceLabel`'s eight are unchanged as *strings* — REQ-7b
changes only which row gets which one. `web` and `worker` are out of scope — an agent editing either has left its slice.

## Files

| File | Change |
| :-- | :-- |
| `services/api/src/indexer/ranking.ts` | `codec()` takes the resolution tier and returns the tier's rank table, **inferring `HEVC` at tier 5 when nothing is recognised** (`0.9.0`); **`source()` takes the same tier and decides UHD-ness from it rather than from a `uhd` token** (`0.9.0` second pass, REQ-7b); `buildRanking()` passes the tier to both; `rankTorrentResults()`'s pass-1 filter gains REQ-4d, which is the one predicate that reads a *parsed* value (`resolutionTier` + `codecLabel`) rather than the raw title; `compareCandidates()` gates criterion 4's disc-source skip on the tier. One new constant for the 4K tier. |
| `services/api/src/indexer/ranking.spec.ts` | One existing test rewritten — the AC-20 case, green today on `0.8.0`'s outcome — and eight acceptance criteria added (AC-24 … AC-31). The two tests `0.8.0` rewrote are already rewritten. **Check the existing source-rank cases before writing AC-29/AC-30**: any case that relies on a `uhd` token to reach rank 8 or 6 keeps passing, but a case that relies on its *absence* to stay at 7 or 5 at tier 5 now fails and is asserting the defect. |

Nothing else. In particular **not** `ranking-context.service.ts` (what arms the ranking does not
change), `indexer.service.ts`, `indexer.resolver.ts`, `entities/torrent-result.entity.ts`,
`schema.gql`, `prisma/`, or `src/clients/indexer/score.ts` — still dead, still untouched
(`spec.md` § Out of Scope).

## Existing code to reuse

- `resolution(title)` already runs first inside `buildRanking` and already returns the tier REQ-8
  and REQ-7b now need. Nothing re-parses the title; the value is passed, not recomputed — and it is
  passed to **two** callees now, which is the whole shape of REQ-7b: it is step 11's edit applied a
  second time, to the function one rung up.
- `DISC_SOURCE_MIN_RANK` is the pattern for the new tier constant — a module-level `const` named
  after the rule, not a literal `5` inside two expressions.
- `compareCandidates`'s existing `bothFromDisc` local is the precedent for reading a value off `a`
  alone: rows 1–3 have already tied by the time row 4 is reached, so the tier is the same on both
  sides (`spec.md` REQ-11, as amended).
- The three codec regexes stay exactly as they are. This amendment changes no parse — only what the
  parse is worth at a given tier — and the labels it returns are the same three strings.

## Steps

### `spec_version` 0.8.0/`0.8.1` — the codec ranks depend on the tier

1. **The constant** *(done on disk)*. Add `const UHD_RESOLUTION_TIER = 5;` beside `DISC_SOURCE_MIN_RANK`. Both
   decisions below read it, so the tier number appears once.

2. **The rank table.** `codec(title, resolutionTier)`. Detect HEVC and AVC with the existing
   regexes, then return per REQ-8 **as amended in `0.9.0`**: at
   `resolutionTier >= UHD_RESOLUTION_TIER`, HEVC 3 and *nothing recognised* also 3 **with the label
   `HEVC`**; below it, AVC 3 / unrecognised 2 / HEVC 1 with their own labels. AVC keeps its `AVC`
   label at both tiers — REQ-4d reads that label, so replacing it with the inference would delete the
   evidence the veto runs on. A reader must be able to check this function against REQ-8's table by
   eye, so prefer two visible branches over arithmetic.
   **`0.8.1` is superseded here and was never implemented.** `ranking.ts` on disk carries `0.8.0`'s
   numbers (`uhd ? 3 : 1` for HEVC, `uhd ? 2 : 3` for AVC, `uhd ? 0 : 2` for unrecognised). Do not
   stage anything through `0.8.1`'s `uhd ? 1 : 3` / `2`: at tier 5 the AVC rank is unreachable
   (vetoed) and the unrecognised rank is 3, so **the only edit this step still needs is the last
   branch** — `uhd ? 0 : 2` becomes 3 with the label `HEVC` at tier 5. The HEVC and AVC branches are
   already what this step asks for, labels included.

2b. **The veto (REQ-4d).** In `rankTorrentResults`, add one predicate to the `survivors` filter:
   drop an entry whose `ranking.resolutionTier >= UHD_RESOLUTION_TIER` **and** whose
   `ranking.codecLabel === 'AVC'`. It belongs in that filter and not in `codec()` — a rank function
   that removed rows would hide a pass-1 decision inside a pass-2 helper. Order inside the filter is
   free (the predicates are independent), but it must stay **inside** `survivors`, i.e. before
   `maxTier` is computed: that is the property AC-27 asserts, and moving it after the tier pass turns
   a demotion into an empty candidate set.

3. **The call site** *(done on disk)*. `buildRanking` already holds `const res = resolution(title)`
   two lines above the `codec(...)` call. Pass `res.tier`. Nothing else in that function moves.

4. **The comparator** *(done on disk — `skipCodec` is already gated on the tier; `0.9.0` does not
   edit this function at all)*. Criterion 4's arm becomes conditional on the tier as well as on disc-ness —
   the skip now needs `bothFromDisc && a.ranking.resolutionTier >= UHD_RESOLUTION_TIER`. Criterion
   6 (audio) keeps `bothFromDisc` alone. The two arms no longer read alike, and that is the
   requirement: do not factor them back together (`spec.md` REQ-10, REQ-11; `plan.md` § Contract
   Freeze).

### `spec_version` 0.9.0 second pass — UHD-ness comes from the tier

5. **`source(title, resolutionTier)`** (REQ-7b). Replace the first line of `source()` —
   `const uhd = /\buhd\b/.test(title);` — with `const uhd = resolutionTier >= UHD_RESOLUTION_TIER;`
   and pass `res.tier` at the call site in `buildRanking`, exactly as step 3 did for `codec()`. The
   `uhd` local keeps its name and every `uhd ? … : …` expression below it is untouched, so the ladder
   is visibly the same ladder.

   **Replace the test, do not widen it.** `|| resolutionTier >= UHD_RESOLUTION_TIER` would leave the
   token able to promote a 1080p release on its own, which is the second half of the bug (AC-30, and
   four real rows in the corpus `spec.md` records). The regex leaves `source()` entirely — grep for
   `uhd` in the file afterwards and the only survivors should be `UHD_RESOLUTION_TIER` and the four
   label strings.

   **Do not touch `familyCeiling` or `adjustSourceRank`.** REQ-22's promotion becoming inert for
   tier-5 disc sources is a *consequence* of the ranks converging on their ceilings, and `spec.md`
   REQ-22 accepts it in that form. Rewriting the ceilings to restore a promotion at tier 5 would
   reintroduce exactly what REQ-7b removes — a language match buying a rung that describes the disc.

## Contract obligations

`spec.md` § GraphQL Contract Delta is **None** and stays None. `ReleaseRanking.codecRank` keeps its
name and its `Int!` type; `codecLabel` keeps its exact three values. `web` retypes this schema by
hand with no codegen (Article VIII), so a field rename here would fail at runtime with no compile
error anywhere — there is no reason to touch one.

`sourceRank` and `sourceLabel` likewise keep their names and types. REQ-7b changes which value a
given release gets, not the vocabulary: the eight labels and the eight ranks are the same eight.
`web` renders `sourceLabel` and never the number, and `076`'s sweep compares the number against its
own floor — see § REQ-7b and `076` below for the one place that matters.

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
| 1080p `WEB-DL` pair, the `x265` **larger** → `x264` leads | **AC-19** — *on disk, green* |
| 2160p `WEB-DL` pair → since `0.9.0` the `x264` peer is **absent**, not outranked | **AC-20** — *on disk asserting the superseded outcome; rewrite it* |
| 1080p `BluRay` pair, the `x265` **larger** → `x264` leads | **AC-21** — *on disk, green* |
| 2160p `UHD BluRay Remux` pair, terse and **larger** vs `x265 TrueHD Atmos` → terse leads | **AC-22** — *on disk, green* |
| three 1080p `BluRay` releases → `x264`, untagged, `x265` | **AC-23** — *on disk, green* |
| three 2160p `WEB-DL` releases → the `x264` absent, the other two by size, both labelled `HEVC` | **AC-24** (rewritten by `0.9.0`) |
| a 2160p `BluRay x264` larger than every other disc row → absent from the candidates | **AC-25** |
| a 2160p untagged row labelled `HEVC`, a 1080p untagged row labelled `—`, in one list | **AC-26** |
| a set whose only 2160p rows are `x264` → candidates non-empty, drawn from 1080p, no 2160p row | **AC-27** (the failure path) |
| a 2160p `AV1` row → absent, and never labelled `HEVC` | **AC-28** |
| `codecRank` read directly: 1080p `x264` → 3, 2160p `x265` → 3 | the tier dependency, § Contract obligations — *on disk, green* |
| two 2160p remuxes, one naming `uhd` and one not → both `sourceRank` 8, label `UHD BluRay Remux`, larger leads | **AC-29** (`0.9.0` second pass, REQ-7b) |
| a 1080p release naming `UHD BluRay` vs a 1080p `BluRay Remux` → the first is rank 5 `BluRay`, the remux leads | **AC-30** (the failure direction) |
| one list ranked before and after → identical `candidate` set and identical best tier, only `candidateRank`/`sourceRank`/`sourceLabel` differ | **AC-31** (REQ-7b resizes nothing) |

**One existing test changes result and must be rewritten, not deleted:**
`'still prefers a smaller HEVC over AVC between two 2160p web sources (AC-20)'`. It is green today
and asserts that the `x264` peer is present and merely outranked; under `0.9.0` that row is vetoed, so
the assertion becomes a one-row candidate set. Rewriting it is the evidence the rule changed; deleting
it loses the only assertion that would catch the veto being removed. *The two tests `0.8.0` itself
rewrote — the 1080p/2160p disc pair and the web pair — were rewritten in `de41706` and are the
AC-21/AC-22/AC-19 rows above; nothing is left to do there.*

**A gap this normalization found and did not close:** AC-4f (REQ-4c's no-false-positives case —
`DTS-HD MA`, `Ghosts`, `Catch`, `Camelot`) has **no test**. The cinema veto's token list is exercised
only through `HDCAM`, and a false positive there *removes* a release. It belongs to Group 6, not to
this slice, but `ranking.spec.ts` is where it goes — `tasks.md`'s T022b, the one `[api]` task
outside Groups 7 and 8.

## Done when

```bash
bin/npm api run test -- src/indexer
```

```bash
bin/cli api npx --no tsc --noEmit
```

- Every suite green, each of AC-20 and AC-24 … AC-31 traceable to a named test, suite/test counts
  stated before and after. AC-19 and AC-21 … AC-23 are already traced (`spec.md`
  § Checkbox Normalization) and their tests must still be green.
- Typecheck at the baseline 0 errors.
- `git status --short services/api/prisma` empty, `services/api/schema.gql` absent from
  `git diff --name-only`, `git diff --stat services/web services/worker` empty.
- `git diff --stat services/api` names exactly two files.

## The `0.9.0` delta, in one place

§ Steps describes the whole `0.8.0`+`0.9.0` end state, and `0.8.0` is already on disk. **These four
points are the entire remaining diff**, none of them larger than a few lines:

1. `codec()` at tier 5 returns `{ rank: 3, label: 'HEVC' }` where it used to return the unknown
   label — the inference. Below tier 5, untouched.
2. `rankTorrentResults`'s `survivors` filter drops tier-5 `AVC` rows — the veto.
3. `source()` takes the tier and reads `uhd` off it instead of off the title — REQ-7b, added by
   `0.9.0`'s second pass on 2026-09-27. Two lines plus the call site.
4. Nothing else. `compareCandidates` is **not** edited by `0.9.0`: criterion 4 becomes inert at tier
   5 as a consequence, and REQ-11's skip stays exactly as `0.8.0` narrowed it (`plan.md` § Decisions
   records why it is kept although redundant). `familyCeiling`/`adjustSourceRank` are **not** edited
   either, for the reason step 5 gives.

### REQ-7b and `076`'s quality floors — read this, change nothing

`076-automatic-movie-acquisition` arms `RankingContext.minSourceRank` (digital ≥ 4, physical ≥ 6) as a
veto inside the same `survivors` filter step 2b edits. REQ-7b moves a value that floor reads: a
**tier-5 non-remux disc** release that does not name `uhd` goes 5 → 6 and so begins to clear the
physical floor. That is correct — a 4K Blu-ray rip *is* the physical release — and it is the floor
doing its job, not a regression.

It is recorded here **only so an implementer recognises it rather than rediscovering it as a
surprise**. Do not adjust `acquisition-window.ts`, do not add a compensating condition, and do not
widen this slice into `scheduler/`. `036` owns no requirement, task or acceptance criterion over those
floors and `076` needs no amendment (`spec.md` § Post-Implementation Amendments, second pass,
consequence 3). An agent that edits `src/scheduler/` on this task has left its slice.

What `0.9.0` does **not** touch, restated because the temptation is real: no new `ranking` field to
report the veto (`candidate: false` with the row absent from the candidate list is the whole report),
no marking of the inferred label, no `schema.gql` change, no Prisma migration, and nothing under
`services/web/` or `services/worker/` — the chip text changes because the string `api` sends changes.
No `IMAX` token, no edition token, and no new criterion: REQ-7b was found while asking whether IMAX
should rank, and the answer recorded in `spec.md` is no.

