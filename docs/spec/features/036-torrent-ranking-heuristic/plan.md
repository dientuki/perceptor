---
title: Torrent Ranking Heuristic — Implementation Plan
spec_version: 0.9.0
last_updated: 2026-09-27
status: Implemented
---

# PLAN: Torrent Ranking Heuristic (`plan.md`)

> **Three amendments are folded in here.** `spec_version` 0.4.0 replaced the weighted score with a
> lexicographic comparator; this plan was never updated for it and described `qualityScore` long
> after the code had stopped computing one. `spec_version` 0.5.0 adds the mandatory-audio
> promotion. Both are reflected below — the 0.4.0 text is a correction of documentation drift, not
> new work, and nothing in § Order of Work for it remains to be done. `spec_version` 0.6.0
> (REQ-4b, the upscale veto) is implemented — step 9 below is done. `spec_version` 0.7.0
> (REQ-4c, the cinema-capture veto) is implemented — step 10 is done, and its live pass (T022) is
> what remains of it. **`spec_version` 0.8.0 (REQ-8 by resolution tier) is step 11 and is also
> implemented**, in `de41706` on 2026-09-26, the same commit that wrote the amendment — which is why
> every document here called it outstanding until the 2026-09-27 normalization (`spec.md`
> § Checkbox Normalization). `0.8.1` was never implemented and `0.9.0` supersedes it. **The
> outstanding work is steps 12 and 13, which land together** — `0.9.0`'s second pass (2026-09-27)
> added REQ-7b to the same unimplemented amendment rather than opening a `0.10.0`, so there is one
> edit to `ranking.ts` carrying all three rules and one verification over the lot.
>
> **One thing below is stale everywhere and is left as the record.** This plan describes the
> heuristic as a module of `web` (`src/lib/torrent-ranking.ts`). It is not one any more:
> `073-automatic-episode-acquisition` moved it to `services/api/src/indexer/ranking.ts` and deleted
> the `web` file, which is the follow-up § Risks' last row named. Read every "`web`" in § Approach,
> § Order of Work steps 1–10 and § Contract Freeze as the service that owned the code when the step
> ran. Step 11 is `api`, and its verification commands are `api`'s.

## Approach

One service, one module, one modified component. The selection is a **pure function over the
array `web` already holds** — `services/web/src/lib/torrent-ranking.ts` — and
`services/web/src/components/search/SearchTorrent.tsx` holds a boolean of state, a button, and the
parsed labels on each row while the candidate view is active. No server action, no query, no field,
no migration. `searchTorrents` is untouched on both sides of the boundary.

The module exports one function: `TorrentResult[]` in — plus, since 0.5.0, an **optional audio
requirement** (`spec.md` REQ-25) — and the surviving candidates out in rank order, each paired with
its parsed `ranking`. It returns **fewer items than it was given** — that is the whole point of
`spec.md` REQ-3 — and the component keeps the original array so toggling off restores it (REQ-16).

**Three passes, then a comparator.** An earlier draft ordered the full list with a single
comparator whose first keys were veto and tier. That produces the same top rows, and it was the
wrong shape: this button is a **harness for a future automatic picker**, so the table must show the
candidate set the picker would consider and nothing else. A demoted 1080p release at the bottom of
the table is a release the picker will never look at, and rendering it makes the harness lie. The
passes are also the simpler code once the survivors are all that matter — filter, take the max
tier, filter again, sort. Nothing has to decide what to do with a remainder, because there is no
remainder.

```
candidates = results.filter(not vetoed and not dead swarm)   // REQ-4, REQ-4a
tier       = max resolution tier among candidates            // empty set stays empty, no -Infinity
candidates = candidates.filter(tier matches)
candidates = [...candidates].sort(lexicographic comparator)  // REQ-11
```

**The ordering is lexicographic, not a sum** (`spec.md` § Why Not A Score). Each criterion is
consulted only when everything above it tied, so no margin on a lower criterion can overturn a
higher one. This is the property the weighted score could not express and the reason it was
replaced.

**The 0.5.0 promotion adjusts an input to the chain, not the chain itself.** The mandatory audio
language raises a release's *source rank* by one within its family (REQ-22) and adds one low
tiebreak (REQ-24). It is deliberately **not** a new criterion above source: measured against real
result lists, that made an 18 GB WEB-DL naming `Latino` beat four 43 GB UHD BluRay Remuxes. A
lexicographic criterion cannot mean "somewhat more important" — it dominates completely — so
"one step up" has to be expressed as an adjustment to a rank, and the family cap is what stops that
adjustment from crossing a structural boundary.

**Reused, not reinvented.** `TorrentResult` (`src/types/indexer.ts`) is the input type — the module
must not declare its own release shape. `Button` (`src/components/ui/button/Button.tsx`) renders
the toggle with `variant="outline"` and a `startIcon`, as the per-row download button already does.
`lucide-react` is already imported in the component. All copy lives in `messages/{en,es}.json` under
the existing `search.torrent` namespace (`018-ui-i18n`), read through the
`useTranslations("search.torrent")` the component already holds.

**Where this does not go.** Not into `src/actions/indexer.ts` — a server action is for crossing the
GraphQL boundary and this crosses nothing. Not into `SearchTorrent.tsx` itself — the automatic
picker is meant to be the second caller. And not into
`services/api/src/clients/indexer/score.ts`, which stays dead and untouched (`spec.md` § Out of
Scope).

## Order of Work

One service, so this is a sequence inside `web`. Nothing runs in parallel — each step feeds the
next.

| Step | Service | Why it must come here |
| :-- | :-- | :-- |
| 1 | `web` | `src/lib/torrent-ranking.ts` — the pure module. No dependency on the component; the component cannot be written against a function that does not exist. |
| 2 | `web` | `messages/en.json` + `messages/es.json` — both catalogs in the same step, never one alone, or `scripts/check-messages.mjs` fails on drift. |
| 3 | `web` | `SearchTorrent.tsx` — toggle state, button, the derived candidate list, the parsed labels on each row, the empty-candidate state, the reset in `handleSearch`. Consumes steps 1 and 2. |
| 4 | `web` | Verification, below. |

Steps 1–4 are **done** (`spec_version` 0.4.0 and earlier). The 0.5.0 amendment adds three more,
in this order — the requirement has to be *derivable* before the module can be given one, and the
module has to accept one before the component can pass it:

| Step | Service | Why it must come here |
| :-- | :-- | :-- |
| 5 | `web` | The language-tag table and the requirement type (REQ-23, REQ-25) — a pure addition inside `torrent-ranking.ts`, with no caller yet. Testable on its own against release names before anything depends on it. |
| 6 | `web` | The promotion and the tiebreak (REQ-22, REQ-24) — the second parameter, the family-capped source adjustment, the new comparator key, and the two new `ranking` labels. Still no caller change: an absent requirement must reproduce today's ordering exactly (NFR-5), which is what makes this step independently verifiable. |
| 7 | `web` | The plumbing (REQ-25) — `AcquisitionTarget`'s episode branch grows the series' two fields, `SeasonAccordion` passes them, `Movie.tsx`/`page.tsx` already hold theirs, and `SearchTorrent` derives the requirement and hands it to the module. Consumes steps 5 and 6. |
| 8 | `web` | The chip on the row (REQ-14 as amended), then verification. |

Steps 1–9 are **done**. `spec_version` 0.6.0 (`spec.md` § Post-Implementation Amendments,
2026-09-05) added the last one:

| Step | Service | Why it must come here |
| :-- | :-- | :-- |
| 9 | `web` | REQ-4b — a third pass-1 veto predicate (`isUpscaled`) alongside `isVetoed`/`isDeadSwarm` in `torrent-ranking.ts`, matching `upscaled`/`ai upscale`/`ai-upscale`/`aiupscale`, boundary-anchored. No new caller wiring — pass 1 already unions its predicates, so this is a same-shape addition, not a new pass. |

Steps 1–9 are **done**. `spec_version` 0.7.0 (`spec.md` § Post-Implementation Amendments,
2026-09-25) adds the last one. It is one step and not two deliberately: the predicate and the
caller wiring are useless apart, because unlike REQ-4b this veto is **conditional** — a predicate
with no flag reaching it would either veto unconditionally (wrong for a user who allows captures)
or never fire at all (dead code that passes every check).

| Step | Service | Why it must come here |
| :-- | :-- | :-- |
| 10 | `web` | REQ-4c — a fourth pass-1 veto predicate (`isCinemaCapture`) beside `isUpscaled`, plus the one argument that arms it and the one expression in `SearchTorrent.tsx` that computes it from `preferences.allowCinemaReleases` and the target kind. Nothing else in the module moves: the tier pass, the comparator and every `ranking` label are untouched — a veto removes a row, so there is nothing for it to label. |

Steps 1–10 are the `web` era. `spec_version` 0.8.0 (`spec.md` § Post-Implementation Amendments,
2026-09-26) is the first step against `api`, where the heuristic now lives, and it **shipped on the
day it was written**; the `0.8.1` correction to its tier-5 row (2026-09-27) never reached the code and
`0.9.0` withdrew it, so step 11 is done as `0.8.0` and step 12 is what is left. It is one step and not
three because the three edits are one rule: a rank table that takes the tier, the one call site that
passes it, and the one comparator arm whose skip the same tier now gates. Splitting them leaves the
module in a state no requirement describes — a tier-aware table read by a tier-blind comparator
orders `1080p BluRay x264` below `1080p BluRay x265` still, which is the bug.

| Step | Service | Why it must come here |
| :-- | :-- | :-- |
| 12 | `api` | REQ-4d and REQ-8's tier-5 rule (`api/plan.md`) — the 4K AVC veto in pass 1 and the inferred `HEVC` label at tier 5: one edit to `codec()` plus one filter in `rankTorrentResults`. **Still to implement, with step 13.** It was written as landing *with* step 11 because `0.9.0` supersedes `0.8.1`'s tier-5 numbers; step 11 having shipped as `0.8.0` and `0.8.1` never having been written, that sequencing worry is settled and step 12 lands on its own. One file (`src/indexer/ranking.ts`), one spec file beside it. Still no veto **label**, no new `ranking` field, no resolver, no GraphQL field, no migration. |
| 13 | `api` | REQ-7b (`api/plan.md`) — `source()` grows the same `resolutionTier` parameter `codec()` grew in step 11, and decides UHD-ness from it instead of from a `uhd` token in the title. Two lines, one call site, no new constant (`UHD_RESOLUTION_TIER` already exists from step 11). **Lands in the same edit as step 12** — same file, same amendment, same verification pass. Changes no veto and no tier, so it cannot resize a candidate set (AC-31); it moves `sourceRank` and the `sourceLabel` chip only. Still no new `ranking` field, no resolver, no GraphQL field, no migration. |
| 11 | `api` | REQ-8 as amended (`api/plan.md`) — `codec(title)` grows a `resolutionTier` parameter and returns the tier's own ranks; `buildRanking` passes the `resolution(title).tier` it already computed one line above; `compareCandidates` narrows criterion 4's disc skip to tier 5, leaving criterion 6's alone. One file (`src/indexer/ranking.ts`), one spec file beside it. No veto, no label, no new `ranking` field, no context, no resolver, no GraphQL field — `codecRank` and `codecLabel` already exist and neither changes type. |

## Contract Freeze

`spec.md` § GraphQL Contract Delta is **None**, and that is the frozen part: this feature adds no
query, mutation, type, field or error condition, and `web` must not reach for one.

What an implementer will be tempted to change and must not:

- **The candidate view hides, it does not demote.** REQ-3 removes vetoed releases and every tier
  below the best one. Keeping them at the bottom "so nothing is lost" defeats the purpose — REQ-16
  is what keeps nothing lost, by retaining the original list behind the toggle.
- **The selection stays client-side.** The obvious "improvement" is computing this in `api`, where
  jest exists. It is a defensible design and it is the recorded destination — but it is a contract
  change, so it is a new spec, not a step in this one. An implementer editing `services/api/` has
  left their scope and must stop and report (`.claude/agents/web.md`).
- **The comparator is lexicographic, not a sum.** REQ-11. Collapsing the chain back into a weighted
  total "so it is tunable" is the model `spec.md` § Why Not A Score rejects with its reasons
  recorded. Adding a small numeric bonus to a rank is the same move wearing a disguise — with the
  single, bounded exception REQ-22 defines and caps.
- **`HDR` and `HDR10` rank equally, and both outrank `DV`.** REQ-9 inverts the ordering most release
  guides use. It is the user's decision, recorded on purpose; not a typo to correct.
- **The mandatory-audio promotion is capped per source family.** REQ-22. Dropping the cap "because
  `+1` is simpler" lets a `WEB-DL` reach `BluRay`'s rank, which is the exact failure the cap exists
  for. It is a requirement, not a guard clause to tidy away.
- **The promotion never vetoes.** REQ-22, and § Out of Scope. A release that does not name the
  language is still a candidate — absence in a title is not absence in the file. Turning "mandatory"
  into a filter would discard nearly every disc source.
- **The codec preference below 4K is inverted on purpose** *(`0.8.0`)*. REQ-8 ranks `x264` above
  `x265` at 1080p and under. Every release guide, and the pre-`0.8.0` code, say the opposite, so
  this reads as a bug to an implementer who does not know the feature is choosing an encode *source*
  (`spec.md` § Context). Restoring HEVC-first "because HEVC is the better codec" reintroduces the
  bug this amendment names.

- **At tier 5 the codec criterion decides nothing, and that is the design** *(`0.9.0`)*. REQ-8. With
  AV1/VP9 vetoed by REQ-4, AVC by REQ-4d and everything else read or inferred as HEVC, every 4K
  survivor carries rank 3. An implementer who notices the criterion is inert at tier 5 and "cleans
  it up" by deleting the branch loses the **label**, which is the half of the rule that is visible.

- **The tier-5 label is an inference and is shown unmarked** *(`0.9.0`)*. REQ-14, as amended. Adding
  a `?`, a tooltip or a distinct style to it is not a neutral improvement: it raises a question the
  row cannot answer, and the reason it is safe to state plainly is that nothing downstream reads it
  (the worker uses `ffprobe`). Equally, do not extend the inference below 4K, where a missing codec
  really is ambiguous.

- **REQ-4d's order relative to REQ-4 is load-bearing** *(`0.9.0`)*. "A 4K release naming no codec is
  HEVC" is false of 2160p AV1 and VP9. They are gone before the label is read, and only because of
  that. A refactor that evaluates labels before the vetoes makes the view report AV1 as HEVC — the
  one wrong chip this feature would have no defence for. AC-28 is what catches it.

- **An unrecognised codec is second at every tier, never last** *(`0.8.0`, corrected in `0.8.1`,
  and at tier 5 superseded by `0.9.0`, where it is 3 and labelled `HEVC`)*.
  REQ-8 puts it between the two because a release naming no codec is its tier's own codec — H264 at
  1080p, HEVC at 2160p. Tidying it back to 0 "so unknown means worst everywhere" hands the placement
  to the `x265` below 4K and to a `2160p x264` above it, and the second of those is a source that
  does not exist. `0.8.0` shipped that mistake in its tier-5 row; `0.8.1` was the rank-based fix and
  `0.9.0` replaced it with the inference, so a tier-5 table reading `hevc` 3 / `avc` 2 /
  unrecognised 0 is **what is on disk today** — the shipped `0.8.0` state, not a deliberate
  asymmetry and not something anyone has to undo twice. Step 12 takes it straight to `hevc` 3 /
  unrecognised 3 labelled `HEVC`, with AVC gone from the tier.

- **`avc` at tier 5 is vetoed, and ranking it was measured as insufficient** *(`0.8.1`, reversed in
  `0.9.0`)*. `0.8.1` ranked it last on the argument that a veto driven by a codec parse could empty
  the candidate set. Two things answered that: the measurement (ranking it moved **nothing**, because
  REQ-11 skips the criterion for the disc releases this is aimed at), and REQ-3's pass order (the
  veto runs before the tier pass, so the set falls to the next tier instead of emptying — AC-27).
  Reinstating a rank-based answer "to be safe" restores a rule with no observable effect.

- **Criterion 4's skip is tier-gated; criterion 6's is not** *(`0.8.0`)*. REQ-11. The two arms
  looked identical before this amendment and no longer are. Factoring them back together to remove
  the duplication silently changes one of them, whichever way it goes.

- **The chain is not reordered** *(`0.8.0`)*. Source stays criterion 3, codec stays 4. Moving codec
  above source below 4K — so a `WEB-DL x264` beats a `BluRay x265` — was considered and declined
  (`spec.md` § Post-Implementation Amendments, 2026-09-26). It is a bigger claim than the one this
  amendment makes and needs its own decision.

- **The button never acquires.** REQ-15. Auto-selecting the top candidate is the *next* feature and
  must not arrive early by way of "it was one line".

- **The cinema veto reads a preference; it never writes one** *(`0.7.0`)*. `allowCinemaReleases`
  already has a mutation (`setAllowCinemaReleases`) and a switch in the Movies tab of
  `/preferences`. This feature is the **read** side only. Adding a second control inside the
  torrent modal — even a convenient one — is a UI decision the spec did not make, and it would give
  the same preference two homes.

- **The veto defaults to ON when the flag is unknown, and that asymmetry is deliberate** *(`0.7.0`)*.
  Every other optional argument to `rankTorrentResults` degrades to inert when absent (NFR-5,
  REQ-22, REQ-6). This one does not: absent means the veto runs. An implementer who "fixes" it for
  consistency has inverted REQ-4c, and the result is silent — captures reappear for a user who
  switched them off, with nothing on screen to say why.

- **Films only** *(`0.7.0`)*. REQ-4c does not run for an episode or season-pack target. Widening it
  is in § Out of Scope with the reason; doing it here because "the modal is shared anyway" makes
  the Movies-tab switch mean something it does not say.

## Migrations

**None.** No Prisma model, field, enum or migration is touched. `api` is not in `services:` and
takes no part in this feature.

## Risks

Every risk here is silent. Nothing in this feature can throw a visible error, and REQ-3 raises the
stakes over an ordering: a misread release is no longer demoted, it is **removed from the table**.
A user watching the harness sees a plausible candidate set with no way to know a release is missing
from it. That is the failure mode to defend against.

| Risk | How it fails | Mitigation |
| :-- | :-- | :-- |
| **Bare resolution digits matched as fragments.** `includes("1080")` also hits `10800`. | A release is promoted into a tier it does not belong to. Under REQ-3 it then **defines** the tier and evicts every legitimate candidate — the table shows one wrong row and hides the right ones. | REQ-5's both-sides digit boundary: reject `10800`/`21600`, accept `1080`, `1080p`, `1080i`. Verified in the manual pass. |
| **Requiring the `p` suffix.** The inverse. | Every `… 1080 …` release falls to tier 0 and is dropped from the candidate set whenever anything else parses. Invisible — the table looks fine. | REQ-5 makes the suffix optional. This is the failure the user reported from real result lists. |
| **`dv` matched as a substring.** `includes("dv")` matches `DVDRip`, `DVD5`, `HDVD`. | Every DVD rip collects 6 dynamic-range points and outranks its peers inside the set. | Boundary-anchored matching for every short token (`dv`, `hdr`, `av1`, `vp9`, `4k`), checked by eye in the manual pass. |
| **Veto applied after the tier is chosen.** | An AV1 2160p release sets the tier, is then vetoed, and the candidate set comes back **empty** while good 1080p releases sit hidden. REQ-17's message fires and reads as "the heuristic rejected everything" — wrong and unexplainable. | REQ-3 fixes the pass order: veto first, tier second. AC-4 is the direct check. |
| **Mutating React state.** `results.sort()` on the array held in `useState` — `filter` returns a copy, but a `sort` reaching the original does not. | Toggling off re-renders a mutated array, so the "original order" is gone. No error; the button quietly stops working one way. React Compiler makes it worse by not re-rendering on a mutation it cannot see. | The module must never mutate its argument. AC-5 is the check — toggle off must restore the exact AC-1 table. |
| **Division by zero on a degenerate candidate set.** All sizes null, or every swarm empty. | `NaN` propagates into a comparison; `NaN` comparisons are all false, so the sort silently returns an arbitrary order rather than throwing. | NFR-4. Every comparator key resolves to a number; a null `size` sorts as 0. AC-7. |
| **The promotion crosses a source family.** An uncapped `+1` on `WEB-DL` (4). | It reaches 5 — `BluRay`'s rank — and a web source starts beating disc sources whenever it names the language. Silent: the row shows a plausible label and a plausible position. | REQ-22's per-family ceiling, checked directly by **AC-13**. |
| **A language tag matched as a substring.** `includes("lat")`, `includes("es")`. | `Translated`, `Latvian` and virtually every title match, so *every* release is promoted and the criterion becomes noise that quietly re-sorts the table. Worse than useless: it looks like it is working. | REQ-23's boundary anchoring on every tag, and **AC-16**, which names the exact false positives. |
| **`MULTI` read as a match.** | A release advertising "several languages, unspecified" is promoted for a language it may not carry — a false positive on the one criterion added to reduce them. | REQ-23 excludes `MULTI`/`DUAL` explicitly. **AC-16**. |
| **The promoted rank is rendered as if it were read from the name.** | A `BluRay Remux` promoted to 8 displays `UHD BluRay Remux`, so the harness reports a source the release does not have — and the amendment becomes unauditable against real lists, which is the whole purpose of the view. | REQ-14 as amended: a promoted row must show that it was promoted. |
| **The requirement leaks into the default path.** A non-optional second parameter, or a truthy empty requirement. | Every existing caller — and the future automatic picker — silently changes behaviour for titles that never set the flag. | NFR-5 makes the argument optional and **AC-14** pins the unarmed ordering to the 0.4.0 result. |
| **`Math.max()` over an empty array is `-Infinity`.** When every release is vetoed, the tier pass runs over nothing. | The empty set survives by luck, but a `reduce` with no initial value throws, and `Math.max(...spread)` over a large list can blow the stack. | Guard the empty case explicitly and return an empty candidate set. AC-6. |
| **The empty-candidate state reuses "no results" copy.** | The user reads "no se encontraron resultados" and searches again, when the releases are one press away. | REQ-17 requires its own message and its own key. AC-6 checks the exact copy. |
| **No test runner in `web`.** | Every row above is exactly the class of bug Article IX says is owed a test, and this service has nowhere to put one. | Accepted and recorded, not waved away — see `web/plan.md` § Tests. The manual pass is the compensating control; moving the heuristic to `api` (where jest lives) is the named follow-up and the destination anyway. |
| **The upscale veto matches too loosely.** `includes("upscale")` also hits an unrelated title token, or a hyphen/space variant is missed. | Either a legitimate release is discarded (silent, looks like it just wasn't in the results) or an upscale survives and can define the tier exactly like an unvetoed AV1 release would. | Boundary-anchored matching for every spelling (`upscaled`, `upscale`, `ai upscale`, `ai-upscale`, `aiupscale`), checked by eye in the manual pass against real indexer titles — same discipline as REQ-4/REQ-4a. AC-4c is the direct check. |
| **The tier is read from the wrong candidate** *(`0.8.0`)*. Criterion 4 now consults `a.resolutionTier` the way it already consults `a.sourceRank` for disc-ness. | If either were read before criterion 1 had settled, a pair straddling two tiers would be judged on one of their tables — silently, and only for pairs that cannot occur in a candidate set, which is what makes it survive review. | Pass 2 leaves exactly one tier standing (REQ-3), and `||` short-circuits so row 4 is unreachable until rows 1–3 tied. Both facts are why REQ-11 licenses reading either candidate; a comparator used on an unfiltered list keeps criterion 1 first and stays correct anyway. |
| **A mislabelled name is removed, not sunk** *(`0.9.0`)*. REQ-4d fires on the title's own `x264` token, so a group that writes the wrong codec over a genuine 4K release loses it from the view — and, since `073`/`076`, from the automatic sweeps. | The release is simply not there. No error, no chip, no log line: the failure is indistinguishable from the indexer not having returned it, which is the worst shape a false positive can take. | Bounded rather than eliminated, on REQ-4b's precedent: the tokens are boundary-anchored and unambiguous, the veto runs before the tier pass so it can never empty the set (AC-27), and the full, untoggled list still holds every row — the button hides, it never discards (REQ-15). |
| **The inference outlives its precondition** *(`0.9.0`)*. REQ-8's tier-5 `HEVC` label is only true downstream of REQ-4's AV1/VP9 veto. | A refactor that reads labels before pass 1, or relaxes REQ-4, makes the view state `HEVC` on an AV1 release — a chip that is not merely imprecise but false, on the one codec this feature refuses outright. | AC-28 asserts the pair together (the AV1 row absent **and** never labelled). The two rules are written as separate requirements in pass 1 rather than as one branch inside `codec()`, so the order is visible in the spec and not only in the code. |
| **The rank table is read as absolute** *(`0.8.0`)*. `codecRank` crosses the GraphQL boundary and now means different things at different tiers. | A future consumer compares `codecRank` between two rows of *different* tiers — or renders it as a quality number — and gets an ordering REQ-8 never claimed. Nothing errors; the number is always a plausible small integer. | The labels stay tier-independent and are what `web` renders (`codecLabel`; `codecRank` is fetched and unused). AC-19/AC-20 pin the same rank appearing for opposite codecs at the two tiers, so the dependency is asserted rather than implied. |
| **A cinema token matched inside a real title** *(`0.7.0`)*. The 2018 film **`Cam`** is the worked example; `TS`, `TC`, `SCR` and `WP` are short enough to collide with a title word or a foreign-language token. | Every release for that film is vetoed, so the candidate set comes back empty — or worse, partially culled — and REQ-17's message reads as "the heuristic rejected everything". Nothing on screen distinguishes this from a genuinely bad result list. | Boundary anchoring removes the *substring* class (`DTS`, `Ghosts`, `Catch`, `Camelot` — AC-4f) but **cannot** remove this class: `Cam` as a standalone title token is indistinguishable from `CAM` as a source tag by name alone. Accepted and documented rather than solved: the switch is the escape hatch, and REQ-17's empty state is already distinct from "no results". Do not attempt a positional heuristic ("only after the year") to rescue it — that is a new rule the spec did not approve. |
| **The flag is read but the target kind is not** *(`0.7.0`)*. | The veto fires on episode and season searches too. Silent: a user hunting an `HDTS` simulcast sees an empty candidate set and assumes the indexer returned nothing. | REQ-4c is films-only and **AC-4g** is the direct check. The caller computes the argument, not the module — the module has no `target` and must not grow one. |
| **`preferences` is still `null` when the button is pressed** *(`0.7.0`)*. It is fetched per mount, unawaited. | With the argument defaulting to "veto on", a user who allows captures briefly (or permanently, if the call failed) sees them removed. With it defaulting the other way, a user who forbids them sees them. Either way nothing errors. | REQ-4c resolves it to the column default (veto on), matching the fallback `getPreferences` already returns when `api` answers with no data. The window is small in practice — the button is disabled until a search returns, which is strictly after the preferences call is issued — but it is a window, not an impossibility. |

## Verification

All through `bin/` (Constitution, Article I).

```bash
bin/cli web npx --no tsc --noEmit
```

Expected: **0 errors** — `services/web/CLAUDE.md` § Current state records 0 as of `027`. Report the
count before and after; anything above 0 was added here.

```bash
bin/cli web node scripts/check-messages.mjs
```

Expected: exit 0. Catches a key added to one catalog and not the other.

```bash
bin/cli web npx --no biome check src/lib/torrent-ranking.ts src/components/search/SearchTorrent.tsx
```

Biome on **the touched files only** — `bin/npm web run lint` over the repo reports ~1598
pre-existing template errors and is not a usable gate (`services/web/CLAUDE.md`).

```bash
bin/npm web run build
```

Expected: exit 0.

Then the manual pass, which is the real gate: nothing above can observe a wrong candidate set. With
the stack up (`bin/dev`), open a film's detail page, open the torrent modal, and search a title
returning many releases (`Dune`, `Blade Runner 2049` — both return mixed 2160p/1080p sets):

1. The table arrives size-descending, with no score shown, and the button is enabled. **AC-1**
2. Press it. Every remaining row is the same resolution, and it is the highest one that was in the
   list. Count the rows against what was there before — if the list held one 2160p, exactly one row
   survives. Confirm the browser network panel stayed silent. **AC-2**, **NFR-2**
3. Read the parsed labels down the table: row 1 is the preferred-group release if the set holds one,
   otherwise the highest source, and any two adjacent rows differ on exactly the first criterion
   where their labels disagree. **AC-3**, **AC-3a**, **REQ-14**
4. If the list holds an AV1 or VP9 release at the top tier, confirm it is absent **and** that the
   set fell through to the next tier rather than coming back empty. **AC-4**
5. Press again: the table is byte-identical to step 1 — every hidden release back in place, no
   score shown. **AC-5**
6. Filter by `x265` with the view active: candidates narrow, rank order holds, clearing restores.
   **AC-9**
7. Search again: the new list renders in original order with the toggle reset. **AC-10**
8. Search something with no results: the button is visibly disabled and does nothing. **AC-8**
9. Read the console across the whole pass: no error, no React key warning. **AC-7**, **NFR-3**

Then the `spec_version` 0.5.0 pass, on the same modal. Set it up first: open a film's detail page,
tick **Audio mandatory** in its audio pane, add Spanish to its audio languages, and save.

10. Search a title with a mixed 2160p set. With the checkbox on, a release naming `SPA`/`Latino`/
    `Castellano` shows a language chip, and one promoted out of `BluRay Remux` shows that it was
    promoted rather than displaying `UHD BluRay Remux` as if read from its name. **REQ-14**
11. Compare the ordering against the same search with the checkbox off — the only rows that may
    move are ones advertising the language, and they may only move **up**. **AC-12**, **AC-14**
12. Confirm no web source has crossed a disc source: no `WEB-DL`/`WEBRip`/`HDRip` row sits above a
    `BluRay`/remux row, whatever it names. **AC-13**
13. Untick the checkbox, reopen the modal, search again: the ordering matches the pre-amendment one
    and no chip is rendered. **AC-14**
14. Repeat 10–13 from an **episode's** modal, with the flag set on the *series*. **AC-18**
15. Confirm the network panel stayed silent across the whole 0.5.0 pass — the requirement comes
    from data already on the page. **NFR-6**

`Venom Let There Be Carnage` is the search this amendment was designed against and the one to use:
it returns the five-release 2160p set of **AC-12** verbatim, including the 54 GB multi-audio remux.

Cases the live indexer may not hand you. If they do not occur naturally, force them by
searching a title that produces them, and say so in the report rather than marking them passed:

- **Every release vetoed** — the empty-candidate message from REQ-17 appears, distinct from the "no
  results" copy, and pressing again restores the list. **AC-6**
- **A `CAM`/`TS` tagged `1080p`** — *(superseded at `0.7.0`; see the cinema-veto pass below.)* With
  the switch **on** it still survives and may define the tier, which is now the documented,
  user-chosen behaviour rather than a gap.
- **The tiebreak actually deciding** (**AC-17**) — two candidates at the same family ceiling where
  only the smaller names the language. Live sets often settle on source or size before reaching
  criterion 7, so if it never fired, say so instead of ticking AC-17.
- **A `MULTi` release in the set** (**AC-16**) — confirm it is *not* chipped and *not* promoted.

```bash
grep -rn "Ordenar" services/web/src
```

Expected: no output — the Spanish copy lives in `messages/es.json` (**AC-11**, `018-ui-i18n`).

### The `spec_version` 0.7.0 pass — the cinema veto

Run after the pass above, on a **film**, with the torrent modal open. The switch is
*Allow cinema releases* in the Movies tab of `/preferences`; it is **off** on a fresh account, so
check its state before reading anything into the result.

Pick a search that actually returns captures. A film still in cinemas is the reliable source;
`spec.md`'s AC-4d shape (three captures among five same-tier releases) occurs naturally there and
almost never on a catalogue title.

16. Switch **off**. Search, press the button. Every `CAM`/`HDTS`/`DVDSCR`/`DCP` row is gone, and
    the survivors are the same tier as each other. Count them against the pre-press table and name
    the vetoed titles in the report — a veto leaves nothing on screen, so the count is the only
    evidence. **AC-4d**
17. Switch **on** (`/preferences`, save, reopen the modal — the value is fetched per mount, so an
    open modal keeps the stale one). Search the same title, press again: every capture is back and
    the ordering matches what `0.6.0` produced. **AC-4d**
18. Switch **off** again and search a title whose results are *only* captures. The
    empty-candidate message from REQ-17 appears — not the "no results" copy — the console is
    clean, and pressing again restores every release. **AC-4e**
19. With the switch **off**, confirm by eye that no legitimate release was culled: a `DTS-HD MA`
    row, and any title containing `Ghosts`, `Catch` or `Camelot`, must all still be present. If the
    live set holds none, search `Ghosts of Mars` on purpose and say so. **AC-4f**
20. Open an **episode's** modal with the switch still **off** and search something returning an
    `HDTS`. It must be **present** — the veto is films-only. **AC-4g**
21. Confirm the network panel stayed silent throughout: the flag comes from the preferences call
    the modal already makes on mount, and pressing the button issues nothing. **NFR-2**

The one case the manual pass cannot reach is REQ-4c's unknown-flag branch — and since `073` it
cannot occur either: `api` reads the flag from the database before it ranks anything, so there is no
window in which the caller does not know it (`spec.md` REQ-4c, the annotated paragraph). Steps 15–21
above are also written against the `web` module and its preferences call; the behaviour they check is
now `api`'s, and step 21's silent network panel holds for a different reason — the flag never crosses
the boundary at all. AC-4d, AC-4f and AC-4g were closed by unit test and measurement instead
(`spec.md` § Checkbox Normalization); what a live pass still owes is **AC-4e**, the empty-candidate
message.

### The `spec_version` 0.8.0 pass — codec by resolution tier

This amendment lands in `api`, which has jest, so the five acceptance criteria are unit-asserted
rather than eyeballed — the compensating control the rest of this plan relies on is not needed for
it.

```bash
bin/npm api run test -- src/indexer
```

Expected: every suite green, with **AC-19 … AC-24** each traceable to a named test in
`src/indexer/ranking.spec.ts`. *Ran in `de41706`: AC-19 and AC-21 … AC-23 each carry a named test and
are ticked; the two pre-`0.8.0` tests were rewritten there rather than deleted. AC-20's test is green
on the outcome `0.9.0` supersedes, and AC-24 has no test — both are step 12's, below.*

```bash
bin/cli api npx --no tsc --noEmit
```

Expected: **0 errors**, the baseline `services/api/CLAUDE.md` § Current state records.

```bash
git status --short services/api/prisma && git diff --stat services/web services/worker
```

Expected: both silent. No migration, and `services/api/schema.gql` out of the diff — the amendment
touches no field.

Then one live confirmation, which is cheap here and worth doing because the unit tests all run on
synthetic titles:

22. With the stack up, open a film whose best tier is **1080p**, open the torrent modal and press
    "Best candidates". Every `x264` row sits above the `x265` rows of the same source, and a row
    naming no codec sits between them. Read the chips, not the order alone — a wrong parse and a
    wrong rank look the same from the order.
23. Repeat on a film with real 2160p releases. Every 4K row's codec chip reads `HEVC` — there must
    be no `—` and no `AVC` among them, which is the whole of `0.9.0` visible in one screen. Rows
    naming no codec sit among the `x265` ones ordered by size, not below them.

### The `spec_version` 0.9.0 pass — the 4K AVC veto, the inferred label and REQ-7b

Unit-asserted like `0.8.0` (**AC-24 … AC-31** in `src/indexer/ranking.spec.ts`), with the same three
commands. Then two live checks that the unit tests cannot make, because both rest on what real
indexers actually return:

24. Open *Shutter Island* — the reference title this amendment was measured on — and press "Best
    candidates". The `2160p BluRay x264 8bit SDR` release of ~44 GB must be **absent**, and the
    candidate count one lower than before the change. Toggle the view **off**: the release is back in
    the full list, because the button hides and never discards (REQ-15). A row missing from the
    untoggled list is a different bug and a serious one.
25. On the same list, the top rows read `HEVC` where they used to read `—` (the 60 GB
    `UHD BDRemux … Dolby Vision Profile 8` is the row to look at). Then open a film with a mixed
    1080p set and confirm a 1080p release naming no codec still reads `—`: the inference is
    tier-scoped, and a `HEVC` chip on a 1080p untagged row means it was applied unconditionally.
26. **REQ-7b, on *Interstellar*** — the title this rule was found on, and the one live check that
    matters most, because the defect was invisible to every unit test that existed. Press "Best
    candidates". `Interstellar.2014.2160p.PROPER.IMAX.REMUX.DV.HDR10+.TrueHD.7.1.Atmos-jennaortega`
    must be **`candidateRank` 1** and its chip must read `UHD BluRay Remux`, where before this pass it
    was **#11 of 56** reading `BluRay Remux`, behind a peer with 8 seeders. Record the candidate
    **count**: it must still be 56, not 55 and not 57 (AC-31 — REQ-7b is criterion 3 of a comparator
    and must not have leaked into pass 1). The pre-change baseline was measured on 2026-09-27 against
    the 475 rows that search returns and is recorded in `spec.md` § Post-Implementation Amendments
    (second pass).
27. Same list, the failure direction (AC-30): scroll to the 1080p rows and find
    `Interstellar 2014 IMAX Hybrid 1080p UHD BluRay … x265-HiDt`. Its chip must read **`BluRay`**, not
    `UHD BluRay` — a 1080p release naming `UHD` must no longer be promoted for saying so. There are
    four such rows in that search; all four must read `BluRay` or `BDRip`, never a UHD label.
