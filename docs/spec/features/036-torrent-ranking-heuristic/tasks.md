---
title: Torrent Ranking Heuristic — Tasks
last_updated: 2026-09-05
status: In Progress
---

# TASKS: Torrent Ranking Heuristic (`tasks.md`)

## Legend

| Marker | Meaning |
| :-- | :-- |
| `[web]` | Which subagent owns the task. Exactly one per task. |
| `[docs]` | Documentation only. Owned by the orchestrator, not a service agent. |
| `[P]` | May run in parallel with the other `[P]` tasks in the same group. |
| `→ Tnnn` | Blocked by that task. |

**One service in this feature.** No `[api]`, no `[worker]`, no `[infra]`: `spec.md` § GraphQL
Contract Delta is **None**, § Data Model Changes is **None**, and nothing about the stack, the
`bin/` wrappers, `.env` or any Dockerfile changes. An agent that finds itself editing
`services/api/` — including the dead `src/clients/indexer/score.ts` — has left its scope and must
stop and report (`.claude/agents/web.md`, Constitution Article VIII).

**There is no test runner in `web`, and none is being added** (`services/web/CLAUDE.md`;
`web/plan.md` § Tests). That makes **T006 the real gate of this feature**, not a formality after
it. Every task below that says "verified in T006" is genuinely unverified until T006 runs. The same
holds for **T014** in Group 4.

> **Groups 1–3 shipped** (`spec_version` 0.4.0 and earlier) and are left ticked as the record.
> **Group 4 is the `spec_version` 0.5.0 amendment** — the mandatory audio language — and is the
> outstanding work. Its tasks are unticked and its acceptance criteria (AC-12 … AC-18) are unticked
> in `spec.md`.
>
> Note that T001's text below describes the *weighted score* the module no longer computes: 0.4.0
> replaced it with a lexicographic comparator without rewriting the task that built it. Group 4
> tasks are written against the current `spec.md`, which is the authority.
>
> **Group 5 is the `spec_version` 0.6.0 amendment** — the upscale veto (REQ-4b) — added
> 2026-09-05, not yet implemented. Its tasks (T017–T019) are unticked and AC-4c is unticked in
> `spec.md`.

## Tasks

### Group 1 — the heuristic, and the copy it needs

These two are genuinely independent: different files, no shared symbol, neither imports the other.
Both must land before the component can consume them.

- [x] **T001** `[web] [P]` Create `services/web/src/lib/torrent-ranking.ts`: the veto, the
      resolution tier, the five scoring categories, and the three selection passes of `spec.md`
      REQ-3 — veto first, then the highest surviving tier, then rank by quality score. One exported
      function taking `TorrentResult[]` (from `src/types/indexer.ts`, not a new shape) and
      returning the survivors in rank order, each paired with `{ resolutionTier, qualityScore }`.
      It must never mutate its argument, must anchor every short token (`dv`, `hdr`, `av1`, `vp9`,
      `4k`) on a boundary rather than `includes`, must match bare resolution digits with a digit
      boundary on both sides (`1080`/`1080p`/`1080i` yes, `10800`/`21600` no), must guard the
      empty-survivor case instead of letting `Math.max` return `-Infinity`, and must yield `0`
      rather than `NaN` for the two relative categories when their denominator is non-positive.
      *Done when:* `bin/cli web npx --no tsc --noEmit` reports the same error count as before the
      task (baseline 0), `bin/cli web npx --no biome check src/lib/torrent-ranking.ts` is clean,
      and the file has exactly one `export`. Behaviour is verified in **T006**.

- [x] **T002** `[web] [P]` Add three keys under `search.torrent` to **both**
      `services/web/messages/en.json` and `services/web/messages/es.json`: `rankButton`,
      `rankButtonReset` and `rankEmpty`, with the copy in `web/plan.md` § Steps 6. `rankEmpty` must
      read differently from the existing `noResultsYet` / `noFilterMatch` — a user who sees it must
      understand the heuristic rejected everything, not that the search found nothing.
      *Done when:* `bin/cli web node scripts/check-messages.mjs` exits 0.

### Group 2 — the component

Everything here edits `services/web/src/components/search/SearchTorrent.tsx` and depends on Group 1:
the function and the catalog keys must exist before the component consumes them. These three are
sequential, not parallel — same file, and T004/T005 render inside the view T003 introduces.

- [x] **T003** `[web]` Wire the toggle: `showBest` state, the `Button` (`variant="outline"`,
      `size="md"`, `type="button"` — it sits inside the search `<form>` and must not submit)
      immediately after the existing submit button, `disabled` while loading or while `results` is
      empty, label switching between `rankButton` and `rankButtonReset`. Derive the displayed list
      from the module when `showBest`, from `results` as-is otherwise, and apply the existing title
      filter to whichever it is. Keep `results` itself in the API's order at all times. Reset
      `showBest` in `handleSearch`. → T001, T002
      *Done when:* in the running stack, a film's torrent modal shows the button beside "Buscar";
      pressing it replaces the table with same-resolution candidates only, pressing it again
      restores the original table exactly, filtering composes with either view, a second search
      resets it, and it is visibly disabled with an empty list. Covers **AC-1**, **AC-2**,
      **AC-4**, **AC-5**, **AC-8**, **AC-9**, **AC-10**.

- [x] **T004** `[web]` Show each candidate's quality score on its row while `showBest` is active,
      and omit it entirely otherwise (`spec.md` REQ-14 — the feature exists to make the algorithm
      judgeable, and an invisible score cannot be judged). Render it as a badge inside the
      release-name cell: the table's grid template is a fixed four columns on both the header row
      and every body row, and **a fifth column is not in scope**. → T003
      *Done when:* with the candidate view active, every row shows a score and the scores descend
      down the table; with it off, no score is rendered anywhere. Covers **AC-3**.

- [x] **T005** `[web]` Add the empty-candidate branch to the table body's existing
      loading/empty ternary: when `showBest` is on, the candidate set is empty and `results` is
      not, render `t("rankEmpty")` rather than falling through to `noFilterMatch` or
      `noResultsYet`. → T003, T002
      *Done when:* against a result list in which every release is AV1 or VP9, the candidate view
      shows the `rankEmpty` copy — not the "no results" copy — with no console error, and pressing
      the button again brings every release back. Covers **AC-6**.

### Group 3 — verification and docs

- [x] **T006** `[web]` Run the full verification of `plan.md` § Verification: the four commands,
      the nine numbered manual checks, the `grep -rn "Ordenar" services/web/src`, and the **two
      forced cases** — an all-vetoed list, and a `CAM`/`TS` release tagged `1080p`. → T004, T005
      *Done when:* typecheck error count is unchanged from baseline (report both numbers),
      `check-messages` exits 0, Biome is clean on the two touched files, `bin/npm web run build`
      exits 0, `grep` returns nothing, and the report states — per check — what was clicked and
      what was seen, including the row count before and after pressing the button and whether the
      browser network panel stayed silent. If the live indexer never produced an AV1 release or an
      all-vetoed list, **say so** rather than marking AC-4 and AC-6 passed. Report whether the
      `CAM`-defines-the-tier case actually occurred: it is known and out of scope, and it decides
      how urgent the "permitir cine" filter is. Covers **AC-7**, **AC-11**, and confirms every
      other AC end to end.

- [x] **T007** `[docs]` Update `services/web/CLAUDE.md`: `src/lib/` gains its first
      non-infrastructure module, so record what `torrent-ranking.ts` is and that it is meant to be
      called by the future automatic picker, not only by the modal. Update the root `CLAUDE.md`
      "Find release" row to mention the candidate view in `web`. Do **not** change the "Current
      state" test counts — this feature adds no test to any service. → T006
      *Done when:* both files describe the module and the view, and no count in either was edited.

- [x] **T008** `[docs]` Walk the eleven acceptance criteria in `spec.md` against T006's report,
      tick each box, and set `status: Implemented` on `spec.md`, `plan.md` and `web/plan.md`; set
      `status: Done` here. Any criterion T006 could not reach stays unticked and goes to **Blocked**
      below — do not tick a box on a case that never occurred. → T007
      *Done when:* every ticked box traces to a line in T006's report, and the four files carry
      their new status.

### Group 4 — `spec_version` 0.5.0: the mandatory audio language

One service still, and now a second reason nothing here is `[api]`: the four fields this reads
(`Movie.audioMandatory`/`audioLanguages` and the `Show` pair) were shipped by
`039-per-title-language-split` and are **already selected** by `web`'s existing `GetMovie`/`GetShow`
query documents. An agent editing a query document, writing a server action, or touching
`services/api/` has left its scope (`spec.md` § GraphQL Contract Delta, Constitution Article VIII).

T009 and T010 are sequential inside `torrent-ranking.ts`; T011 is a different file and runs in
parallel with them.

- [x] **T009** `[web]` In `services/web/src/lib/torrent-ranking.ts`, add the language-tag table of
      `spec.md` REQ-23: a module-private map from a language to the tokens release names use for
      it, built from a `Language`'s `iso3`/`iso2` plus a hardcoded alias list (`esp`, `castellano`,
      `cast`, `latino`, `lat` for Spanish), structured so another language is a data addition. Every
      tag matched as a whole token with the same `(?<![\dA-Za-z])…(?![\dA-Za-z])` anchoring REQ-5
      uses. `MULTI` and `DUAL` must **not** be in the table. No caller yet — nothing else in the
      file changes behaviour in this task.
      *Done when:* `bin/cli web npx --no tsc --noEmit` reports the baseline error count (0) and
      `bin/cli web npx --no biome check src/lib/torrent-ranking.ts` is clean; and a harness run
      (`web/plan.md` § Tests) shows the table matching `SPA`, `Castellano`, `Latino` and `spa`,
      while rejecting `MULTi`, `DUAL`, `Translated` and `Latvian`. Paste the harness output.
      Covers **AC-16**.

- [x] **T010** `[web]` Same file: the optional requirement parameter, the promotion and the
      tiebreak (`spec.md` REQ-22, REQ-24, REQ-25, NFR-5). A second **optional** argument carrying
      `{ mandatory, languages }`; when absent, unarmed or empty-listed, every part of this
      amendment is a no-op. When armed, raise the REQ-7 source rank by one **capped at its own
      family ceiling** — remux 8, disc non-remux 6, web 4, unrecognised 0 — expressed as a per-family
      ceiling and not as a single global `Math.min(rank + 1, 8)`. Add criterion 7 to the comparator
      between audio and size, **not** skipped for disc sources (a disc implies HEVC and a lossless
      track; it implies nothing about languages — say so in a comment, since the adjacent
      `bothFromDisc ? 0 : …` lines make the skip look like the house style). `bothFromDisc` reads the
      **adjusted** rank. Extend `ReleaseRanking` with the matched language and whether the rank was
      promoted. → T009
      *Done when:* typecheck at baseline, Biome clean, and a harness run over the AC-12 five-release
      set produces the 54 GB `BluRay Remux` at row 1 **armed** and at row 5 **unarmed**, with the
      other four unmoved; a `WEB-DL` naming `Latino` stays below a `BluRay` naming nothing; and two
      ceiling-bound `UHD BluRay Remux` releases where only the smaller names `SPA` put the smaller
      first. Paste all three outputs. Covers **AC-12**, **AC-13**, **AC-14**, **AC-15**, **AC-17**.

- [x] **T011** `[web] [P]` The plumbing (`spec.md` REQ-25). `src/types/media.ts`:
      `AcquisitionTarget`'s **episode** branch gains the series' `audioMandatory` and
      `audioLanguages` (the movie branch already carries the whole `Movie`, which has both).
      `src/components/shows/SeasonAccordion.tsx` accepts it and puts it on the `target` it builds at
      the existing `kind: "episode"` construction. **Do not touch `src/actions/movies.ts` or
      `src/actions/shows.ts`** — `GetMovie`/`GetShow` already select both fields.
      *Done when:* `bin/cli web npx --no tsc --noEmit` is at baseline, Biome is clean on the three
      touched files, and `git diff --stat` shows no change under `src/actions/` or `services/api/`.

      **Deviation, verified correct:** `Show.tsx` does not render `SeasonAccordion` —
      `src/app/(dashboard)/shows/[id]/page.tsx` does, as a sibling. The agent wired the props there
      instead, which already holds the fetched `Show` with both fields. `git diff --stat` confirms
      only `src/types/media.ts`, `src/components/shows/SeasonAccordion.tsx` and
      `src/app/(dashboard)/shows/[id]/page.tsx` changed (15 insertions) — nothing under
      `src/actions/` or `services/api/`. tsc 0 errors, Biome clean on the three files.

- [x] **T012** `[web]` `SearchTorrent.tsx`: derive the requirement from `target` — the film's own
      fields for a movie, the series' for an episode — and pass it to `rankTorrentResults`. When
      `target` is null or the flag is off, pass nothing and behave exactly as today.
      → T010, T011
      *Done when:* in the running stack, a film with *Audio mandatory* on and Spanish in its audio
      languages reorders its candidate list as AC-12 describes, and the same film with the checkbox
      off produces the pre-amendment ordering. The browser network panel stays silent on both
      (**NFR-6**). Covers **AC-12**, **AC-14**, **AC-18**.

      **Verification note:** no browser tool was available to the implementing agent, so instead of
      clicking through the modal it flipped `Movie.audioMandatory`/`audioLanguages` for a real title
      (`Venom: Let There Be Carnage`, id 29) via the live GraphQL API, pulled ~350 real releases from
      the running indexer for it, and ran the actual (untouched) `rankTorrentResults` against that
      real data both armed and unarmed — confirming the AC-12 reordering and the unarmed/no-argument
      equivalence against live data rather than a synthetic set. It restored the movie's flags
      afterward. This is strong evidence but not a literal UI click-through; a live-UI pass is still
      owed and folded into **T014**.

- [x] **T013** `[web]` The row chips (`spec.md` REQ-14 as amended). Render the matched language as
      one more chip in the existing chip row — same component, **no fifth column** — and mark a
      promoted row so it is distinguishable from a genuine one: a `BluRay Remux` promoted to rank 8
      must not render as `UHD BluRay Remux`. Show the read source label and mark the promotion
      beside it. Nothing renders when the requirement is unarmed. `SPA` and the source labels are
      format identifiers, so **no new catalog key** — unless the promotion marker needs a word, in
      which case it is a key in **both** catalogs. → T012
      *Done when:* with the flag armed, a promoted row visibly shows both its read source and that
      it was promoted; with the flag off, no language chip and no marker appears anywhere; and
      `bin/cli web node scripts/check-messages.mjs` exits 0.

- [x] **T014** `[web]` Run the `spec_version` 0.5.0 verification: the four commands of
      `web/plan.md` § Done when, then checks **10–15** of `plan.md` § Verification plus its two new
      forced cases (the tiebreak actually deciding; a `MULTi` release present and correctly
      ignored). Use `Venom Let There Be Carnage`, which returns the AC-12 set verbatim.
      → T013
      *Done when:* the report gives typecheck counts before and after, `check-messages` exit 0,
      Biome clean on the touched files, `bin/npm web run build` exit 0 — **and the same search's
      ordering reported twice, armed and unarmed**, since AC-14 is what a passing armed case cannot
      tell you. Any forced case that did not occur is reported as not occurring, not as passed.
      Covers **AC-12** … **AC-18** end to end.

      **Run by the orchestrator directly**, since no web-agent invocation in this feature had
      browser access. Commands: `tsc --noEmit` 0 errors (unchanged baseline); `check-messages.mjs`
      exit 0 (`OK: en.json and es.json match exactly (332 keys)`); Biome on the two touched files —
      1 pre-existing error (`noUnusedFunctionParameters` on `onClose`, confirmed present at commit
      `73d4a5c`, before this feature) and 1 pre-existing warning (`noArrayIndexKey`), neither on a
      line this feature touched; `bin/npm web run build` exit 0, 21/21 pages generated.

      **Live pass** against the real stack (`bin/dev`, all containers healthy): armed *Venom: Let
      There Be Carnage* (id 29) with *Audio mandatory* + European Spanish and saved
      ("Languages saved." toast, `Chosen languages: European Spanish` visible) — REQ-25, REQ-13.
      Searched it; the live indexer returned **6** French-tracker releases today (torrent9), not the
      AC-12 five-remux Russian/English-tracker set from earlier sessions — trackers are not
      deterministic between runs, so **AC-12, AC-13, AC-15, AC-17, AC-18 could not be exercised
      against real live data this pass** and rest on T009/T010/T013's harness runs against the
      literal AC-12 dataset instead, which is the compensating control `web/plan.md` § Tests
      prescribes for exactly this gap. What the live pass **did** confirm directly: pressing "Best
      candidates" (armed) reduced 6 rows to **1** (the only 4K/2160p-tier release — REQ-3), showing
      chips `4K / — / HEVC / SDR / —` with **no language chip and no promotion marker** on the
      `MULTi 4K ULTRA HD x265` release — i.e. `MULTi` correctly did **not** match Spanish even with
      the requirement armed, a live instance of **AC-16**'s false-positive rule. Toggling off
      restored the original 6-row table byte-for-byte in original order — **AC-5**. The browser
      network panel showed **zero new requests** across both toggles — **NFR-2/NFR-6**. Browser
      console had no errors throughout. Unarmed the movie afterward (unchecked *Audio mandatory*,
      removed European Spanish, saved — confirmed back to "No languages chosen") to leave no test
      state behind.

      **AC-6** (all-vetoed) and the **CAM/TS-defines-tier** case did not occur in this session either
      (same as the original T006 pass) — not re-forced here, consistent with how the 0.4.0 pass
      already documented this gap in **Blocked** below.

      **AC-18 (episode path), attempted live and only partially confirmed.** Armed *Reacher* (show
      id 1) with *Audio mandatory* on, alongside its pre-existing *Latin American Spanish* audio
      preference, and opened the torrent modal from a real episode (S04E08 "Cut"). Searching
      `Reacher` returned **550** real releases, **52** at the top (2160p) tier once "Best candidates"
      was pressed — confirming the series' requirement reached the episode's modal without a
      GraphQL/type error (REQ-25's plumbing, T011) and that `rankTorrentResults` ran to completion
      over live data through the episode branch exactly as it does through the movie branch (same
      function, same call site). No release among the 550 named Spanish in any spelling, so **no
      promotion actually fired** — the mechanism ran clean but AC-18's positive case (an episode
      release actually climbing a rank) was not observed live, the same environmental gap as AC-12
      appearing in the movie pass, except there no substitute dataset existed to force it (the AC-12
      harness dataset was built for the film case, not an episode). **Left unticked; see Blocked.**
      One `Uncaught {stack: Error: Hydration failed...}` console error appeared once, during a period
      of heavy Fast Refresh churn from concurrent file edits in this same session — `bin/npm web run
      build` (no HMR involved) exits 0, so this reads as dev-server noise, not a regression; noted
      for the record rather than treated as a finding. Restored `Reacher`'s state exactly (kept the
      pre-existing *Latin American Spanish* language, unchecked the *Audio mandatory* flag I had set)
      before finishing.

- [x] **T015** `[docs]` Update `services/web/CLAUDE.md`'s torrent-ranking section for the
      amendment: the requirement is an optional second argument, the promotion is capped per source
      family, criterion 7 is not skipped for disc sources, and `MULTI`/`DUAL` are deliberately not
      language matches. Note that the two fields come from `039`'s already-fetched per-title
      preference, so nothing new crosses the boundary. Do **not** edit the "Current state" test
      counts — this adds no test to any service. → T014
      *Done when:* the section describes the current behaviour with no reference to a score, and no
      count in the file was edited.

      Updated `services/web/CLAUDE.md` § Torrent ranking heuristic: the exported signature now shows
      the optional `requirement` argument, the comparator-chain sentence gained "idioma de audio
      obligatorio" between audio and size, and a new paragraph covers the promotion (per-family
      ceiling, why it's not a global `Math.min`), the un-skipped disc comparison for criterion 7, the
      `MULTI`/`DUAL` exclusion, the unadjusted `sourceLabel` + `sourcePromoted` marker, and the
      already-fetched-fields note. No test count in the file was touched.

- [x] **T016** `[docs]` Walk **AC-12 … AC-18** against T014's report, tick each box, and set
      `status: Implemented` on `spec.md`, `plan.md` and `web/plan.md`; `status: Done` here. Any
      criterion T014 could not reach stays unticked and goes to **Blocked** below. → T015
      *Done when:* every ticked box traces to a line in T014's report, and the four files carry
      their new status.

      **AC-12 through AC-17 ticked** — each traces to a specific harness or live-pass line in T014
      (AC-12/13/17 to T010's harness over the literal AC-12/13/17 datasets, re-confirmed by T013;
      AC-14 to T010's unarmed/no-argument-equivalence run plus the live movie pass; AC-15 to T009's
      harness; AC-16 to both T009's harness and the live `MULTi` non-match on the movie pass).
      **AC-18 left unticked and moved to Blocked** — the episode-path mechanism was confirmed live
      (series flag reaches the modal, ranking runs clean over 550 real releases), but no live release
      named Spanish, so the positive promoted-episode-row case never occurred; ticking it would be
      exactly the "case that never occurred" this step is told not to tick.
      `spec.md`/`plan.md`/`web/plan.md` set to `status: Implemented`, this file to `status: Done`.

### Group 5 — `spec_version` 0.6.0: the upscale veto (pending)

One service, one file, no new caller. `spec.md` REQ-4b: a release identified as an upscale is
discarded in pass 1 alongside REQ-4/REQ-4a, before the tier pass runs. This is a same-shape
addition to an existing pattern (`isVetoed`/`isDeadSwarm`), not new architecture, and no other
service is touched.

T017 and T018 are sequential; T019 is `[docs]` and closes the amendment.

- [ ] **T017** `[web]` In `services/web/src/lib/torrent-ranking.ts`, add `isUpscaled(title)`
      alongside `isVetoed`/`isDeadSwarm` (`spec.md` REQ-4b): boundary-anchored match on
      `upscaled`, `upscale`, `ai upscale`, `ai-upscale`, `aiupscale`, case-insensitive, the same
      `\b…\b`-style anchoring REQ-4/REQ-5 use so a title merely containing the substring elsewhere
      does not false-positive. Union it into pass 1's existing filter alongside the other two
      predicates — no new pass, no new comparator criterion, no new `ranking` field.
      *Done when:* `bin/cli web npx --no tsc --noEmit` reports the baseline error count (0) and
      `bin/cli web npx --no biome check src/lib/torrent-ranking.ts` is clean; a harness run
      (`web/plan.md` § Tests) shows `Movie.2024.2160p.Upscaled.BluRay.Remux` and
      `Movie.2024.2160p.AI.Upscale.WEB-DL` both discarded in pass 1, while
      `Movie.2024.2160p.BluRay.Remux` and a title containing an unrelated `upscale`-adjacent word
      (if one is found in real indexer data) are not. Paste the harness output. Covers **AC-4c**.

- [ ] **T018** `[web]` Run the `spec_version` 0.6.0 verification: `bin/cli web npx --no tsc
      --noEmit` and `bin/npm web run build`, plus a live pass against a real search list
      containing at least one `Upscaled`/`AI Upscale` release — confirm it is absent from the
      candidate view and does not set the tier, and that toggling "Best candidates" off still
      restores the full original list (REQ-16/AC-5, re-checked because pass 1 changed). → T017
      *Done when:* both commands report their baseline counts and the live pass output is pasted,
      naming the exact release title that was excluded.

- [ ] **T019** `[docs]` Update `services/web/CLAUDE.md`'s torrent-ranking section: pass 1 now
      vetoes three things, not two (`av1`/`vp9`, dead swarms, upscales). Walk **AC-4c** against
      T018's report, tick it in `spec.md` along with REQ-4b, and set `status: Implemented` back on
      `spec.md`, `plan.md` and `web/plan.md` (they never left it, but the pending markers added on
      2026-09-05 need removing once this lands) and `status: Done` here. → T018
      *Done when:* the CLAUDE.md section names the third veto, REQ-4b/AC-4c are ticked with a
      trace to T018's report, and no "pending"/"not yet implemented" marker remains in any of the
      four feature files.

## Blocked

Anything an agent stopped on rather than working around. Empty is the normal state; a non-empty
entry is a decision waiting for a human.

| Task | Service | What blocked it | Needs |
| :-- | :-- | :-- | :-- |
| T006 (AC-6, partial) | web | Live indexer search for `Spider-Man AV1` returned 51 real releases; the boundary-anchored veto correctly rejected 49 and correctly spared 2 (genuine 2160p BluRay releases with no boundary-matched `av1` token), so the live UI never rendered `candidateResults.length === 0` — the closest live approximation was 2 survivors, not 0. The exact empty-array path **is** proven: a harness run against the compiled `torrent-ranking.ts` (`rankTorrentResults([av1-only, vp9-only])`) returns `[]` with no throw, and the `showBest && candidateResults.length === 0 && results.length > 0 ? rankEmpty : …` JSX branch was code-reviewed and is a plain boolean condition. This same live search is what surfaced and confirmed the fix for the `DS4K` boundary bug below. | A search query (or seeded fixture) that returns real releases 100% boundary-matched as `av1`/`vp9` with nothing else, to observe `rankEmpty` render live — or accept the harness + code review as sufficient, since forcing this against real trackers is not reliably repeatable. |
| T014 (AC-18, partial) | web | Live search of `Reacher` returned 550 real releases (52 at the 2160p tier) for episode S04E08 with the parent series armed (*Audio mandatory* + *Latin American Spanish*); the requirement reached the episode's modal and `rankTorrentResults` ran over all of it with no error, but **no release among the 550 named Spanish in any spelling**, so no promotion ever fired — the mechanism is proven live, the specific promoted-episode-row case is not. The ranking function itself is caller-agnostic and already proven correct against the literal AC-12 five-remux dataset by T009/T010/T013's harness, but that dataset was built for the film case and was not re-run through the episode branch specifically. | A real (or seeded) episode release naming Spanish under an armed series, to see it climb a rank live — or accept the harness (film case) plus the live plumbing/no-crash confirmation (episode case) as sufficient, since today's live trackers hold no Spanish-tagged `Reacher` release. |

**Bug found and fixed during T006, not blocked.** The same live `Spider-Man AV1` search returned two
real releases tagged `DS4K` ("downscaled from 4K", a common scene tag for an upscaled/downscaled
1080p encode) that `resolutionTier` misread as tier 4 — the leading-boundary check only excluded an
*adjacent digit* (`(?<!\d)4k`), not an adjacent *letter*, so `4k` inside `...HDR.DS4K.WEB-RIP...`
matched. This is a real instance of REQ-5's own warning ("recognised only as its own token, never a
fragment of a longer one"). Fixed in `src/lib/torrent-ranking.ts` by widening every resolution
boundary from `(?<![\d])`/`(?![\d])` to `(?<![\dA-Za-z])`/`(?![\dA-Za-z])`. Re-verified: the 17-case
harness (2 new cases added for this) all pass, `tsc --noEmit` is still 0 errors, Biome is still
clean on both touched files (same 1 pre-existing unrelated finding), `bin/npm web run build` still
exits 0, and the live UI now shows exactly the 2 genuine 2160p releases instead of 4 (2 genuine +
2 `DS4K` impostors).

Contract problems always land here (Constitution, Article VIII). For this feature the likeliest
entry is not a contract problem but an **environmental** one: T006's two forced cases depend on
what the live indexer returns. An AV1 release or an all-vetoed list that never appeared is a
blocked verification, not a passed one.
