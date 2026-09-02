---
title: Torrent Ranking Heuristic — Implementation Plan
spec_version: 0.5.0
last_updated: 2026-09-02
status: Implemented
---

# PLAN: Torrent Ranking Heuristic (`plan.md`)

> **Two amendments are folded in here.** `spec_version` 0.4.0 replaced the weighted score with a
> lexicographic comparator; this plan was never updated for it and described `qualityScore` long
> after the code had stopped computing one. `spec_version` 0.5.0 adds the mandatory-audio
> promotion. Both are reflected below — the 0.4.0 text is a correction of documentation drift, not
> new work, and nothing in § Order of Work for it remains to be done.

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
- **The button never acquires.** REQ-15. Auto-selecting the top candidate is the *next* feature and
  must not arrive early by way of "it was one line".

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
- **A `CAM`/`TS` tagged `1080p`** — it will survive and may define the tier, evicting legitimate
  releases. That is known and out of scope (`spec.md`); report whether it actually happened, since
  it decides how urgent the "permitir cine" filter is.
- **The tiebreak actually deciding** (**AC-17**) — two candidates at the same family ceiling where
  only the smaller names the language. Live sets often settle on source or size before reaching
  criterion 7, so if it never fired, say so instead of ticking AC-17.
- **A `MULTi` release in the set** (**AC-16**) — confirm it is *not* chipped and *not* promoted.

```bash
grep -rn "Ordenar" services/web/src
```

Expected: no output — the Spanish copy lives in `messages/es.json` (**AC-11**, `018-ui-i18n`).
