---
title: Torrent Ranking Heuristic — Tasks
last_updated: 2026-09-27
status: In Progress
---

# TASKS: Torrent Ranking Heuristic (`tasks.md`)

## Legend

| Marker | Meaning |
| :-- | :-- |
| `[web]` | Which subagent owns the task. Exactly one per task. |
| `[api]` | Same, for Groups 7 and 8 (T024 … T031, docs tasks excepted) and for T022b — the heuristic moved to `api` under `073` (see below). |
| `[docs]` | Documentation only. Owned by the orchestrator, not a service agent. |
| `[P]` | May run in parallel with the other `[P]` tasks in the same group. |
| `→ Tnnn` | Blocked by that task. |

**One service per group, and it is not the same service in every group.** Groups 1–6 are `[web]`,
**with one exception added 2026-09-27**: T022b is `[api]`, because the test it asks for belongs beside
the code, which is no longer in `web`. Groups 1–6 otherwise:
when they were written the heuristic was `services/web/src/lib/torrent-ranking.ts`, and an agent in
those groups that found itself editing `services/api/` — including the dead
`src/clients/indexer/score.ts` — had left its scope. **Groups 7 and 8 are `[api]`**, because
`073-automatic-episode-acquisition` moved the heuristic to `services/api/src/indexer/ranking.ts` and
deleted the `web` file; there, `services/web/` is the out-of-scope side — including for `0.9.0`, which
changes what a chip in `web` displays without `web` changing at all. No `[worker]` and no
`[infra]` in any group: `spec.md` § GraphQL Contract Delta is **None**, § Data Model Changes is
**None**, and nothing about the stack, the `bin/` wrappers, `.env` or any Dockerfile changes
(`.claude/agents/<service>.md`, Constitution Article VIII).

**There is no test runner in `web`, and none is being added** (`services/web/CLAUDE.md`;
`web/plan.md` § Tests). That makes **T006 the real gate of this feature**, not a formality after
it. Every task below that says "verified in T006" is genuinely unverified until T006 runs. The same
holds for **T014** in Group 4.

> **Groups 1–3 shipped** (`spec_version` 0.4.0 and earlier) and are left ticked as the record.
> **Group 4 is the `spec_version` 0.5.0 amendment** — the mandatory audio language — and is
> **implemented**: T009–T016 are ticked and AC-12 … AC-17 are ticked in `spec.md`. AC-18, the
> episode path, is in § Blocked and stays there. *(This paragraph called the group outstanding until
> the 2026-09-27 normalization; it had been true when written and was never revised.)*
>
> Note that T001's text below describes the *weighted score* the module no longer computes: 0.4.0
> replaced it with a lexicographic comparator without rewriting the task that built it. Group 4
> tasks are written against the current `spec.md`, which is the authority.
>
> **Group 5 is the `spec_version` 0.6.0 amendment** — the upscale veto (REQ-4b) — added
> 2026-09-05, implemented 2026-09-19. Its tasks (T017–T019) are ticked and AC-4c is ticked in
> `spec.md`.
>
> **Group 6 is the `spec_version` 0.7.0 amendment** — the cinema-capture veto (REQ-4c) — added
> 2026-09-25. Its tasks T020/T021 are ticked; T022 (the live pass) and T023 (the doc close-out) are
> not. **AC-4d, AC-4f and AC-4g are ticked since the 2026-09-27 normalization** (`spec.md`
> § Checkbox Normalization) — the veto has been implemented all along. AC-4e stays unticked: its
> ranking half is proven and its `web` empty-state half has never been run. AC-4f is ticked on a
> measurement with **no unit test behind it**; T022 adds that case.
>
> **Group 7 is the `spec_version` 0.8.0 amendment** — REQ-8's codec ranks by resolution tier — added
> 2026-09-26 and **implemented the same day, in the same commit** (`de41706`, "update 036 spec",
> which carries `ranking.ts` and `ranking.spec.ts` beside the four documents). Its tasks were
> written as pending and satisfied further down the same diff, then never ticked; the 2026-09-27
> normalization ticks **T024 and T025** and AC-19/AC-21/AC-22/AC-23. **T026 is genuinely open** —
> `services/api/CLAUDE.md`'s `indexer/` paragraph still describes the pre-`0.8.0` codec rule.
>
> `0.8.1` (tier 5: `avc` 1 / unrecognised 2) was written into this file on 2026-09-27 and **never
> implemented**; `0.9.0` supersedes it, so it is now recorded as history and no task asks for it.
> AC-20 and AC-24 stay unticked in their `0.9.0` form — AC-20's test exists and asserts the
> superseded outcome, AC-24's was never written.
>
> **Group 8 is the `spec_version` 0.9.0 amendment** — REQ-4d's 4K AVC veto and REQ-8's inferred
> tier-5 `HEVC` label — added 2026-09-27. It **supersedes `0.8.1`'s tier-5 numbers**, so Groups 7 and
> 8 ship together in that order and `0.8.1` is never a state the code passes through (T024's note
> spells out the end state). Its tasks are T027–T029 and its acceptance criteria are AC-25 … AC-28,
> plus the rewritten AC-20 and AC-24. It is `[api]`, like Group 7, and rests on real unit tests:
> `web`'s missing runner, which Groups 1–6 compensated for with a manual pass, is not a constraint
> on the side that owns the code now.

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

### Group 5 — `spec_version` 0.6.0: the upscale veto

One service, one file, no new caller. `spec.md` REQ-4b: a release identified as an upscale is
discarded in pass 1 alongside REQ-4/REQ-4a, before the tier pass runs. This is a same-shape
addition to an existing pattern (`isVetoed`/`isDeadSwarm`), not new architecture, and no other
service is touched.

T017 and T018 are sequential; T019 is `[docs]` and closes the amendment.

- [x] **T017** `[web]` In `services/web/src/lib/torrent-ranking.ts`, add `isUpscaled(title)`
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

- [x] **T018** `[web]` Run the `spec_version` 0.6.0 verification: `bin/cli web npx --no tsc
      --noEmit` and `bin/npm web run build`, plus a live pass against a real search list
      containing at least one `Upscaled`/`AI Upscale` release — confirm it is absent from the
      candidate view and does not set the tier, and that toggling "Best candidates" off still
      restores the full original list (REQ-16/AC-5, re-checked because pass 1 changed). → T017
      *Done when:* both commands report their baseline counts and the live pass output is pasted,
      naming the exact release title that was excluded.

      **Result.** tsc 0 errors (unchanged), Biome clean on `torrent-ranking.ts`, `bin/npm web run
      build` exit 0 (T017's harness: the two upscaled titles discarded, the plain Remux kept, an
      all-upscaled-2160p list falling to its 1080p set, `Upscaler` not vetoed).
      **Live pass 1 — *Man on the Moon*** (45 releases): `...Remastered AIUpscaled 60FPS H265...
      Marjenbo` absent from the 13-row candidate view. Weak evidence: that title names no resolution,
      so the tier pass would have dropped it anyway.
      **Live pass 2 — *Prey* (2022)** (155 releases), which isolates the veto: `Prey 2022 2160P Ai
      Upscaled 60fps Web-Dl Ddp5.1 Atmos H265 SDR 10bit Marjenbo` is a genuine 2160p-tier name,
      present in the full list and **absent** from the 7-row 4K candidate view (the other 2160p
      releases, e.g. `Prey.2022.2160p.DSNP.WEB-DL...CMRG`, kept; the AV1 2160p one vetoed by REQ-4).
      Toggling off restored all 155 rows, text byte-identical to before (AC-5). No console errors, no
      new network requests on either toggle. Not observed live: an upscale being the *only* 2160p
      release (that path rests on T017's harness).

- [x] **T019** `[docs]` Update `services/web/CLAUDE.md`'s torrent-ranking section: pass 1 now
      vetoes three things, not two (`av1`/`vp9`, dead swarms, upscales). Walk **AC-4c** against
      T018's report, tick it in `spec.md` along with REQ-4b, and set `status: Implemented` back on
      `spec.md`, `plan.md` and `web/plan.md` (they never left it, but the pending markers added on
      2026-09-05 need removing once this lands) and `status: Done` here. → T018
      *Done when:* the CLAUDE.md section names the third veto, REQ-4b/AC-4c are ticked with a
      trace to T018's report, and no "pending"/"not yet implemented" marker remains in any of the
      four feature files.

### Group 6 — `spec_version` 0.7.0: the cinema-capture veto

One service, two files, no contract change. `spec.md` REQ-4c: when the caller's
`UserPreferences.allowCinemaReleases` is false, a release identified as a cinema capture is
discarded in pass 1 alongside REQ-4/REQ-4a/REQ-4b. The preference, its mutation, its column and
its switch all already exist (`021-user-preferences`) and have never been read by anything — this
group is the read side only.

**What makes this group different from Group 5: the veto is conditional.** That is the whole
source of its risk and the reason T021 exists as its own task rather than as a line inside T020.

All four are strictly sequential — no `[P]` anywhere in this group. T020 is the module, T021 is
the one expression that arms it, T022 is the live pass, T023 closes the amendment.

- [x] **T020** `[web]` In `services/web/src/lib/torrent-ranking.ts`, add the veto to the module
      only — no caller change. Three parts, in order (`web/plan.md` step 17):
      **(a)** extract `matchesAnyToken(title, tokens)`, building the same
      `(?<![\dA-Za-z])…(?![\dA-Za-z])` regex the file already uses in five places;
      **(b)** add `isCinemaCapture(title)` beside `isUpscaled`, over **exactly** REQ-4c's token
      list (`cam`, `hdcam`, `camrip`, `ts`, `hdts`, `telesync`, `tc`, `telecine`, `scr`,
      `screener`, `dvdscr`, `bdscr`, `dcp`, `dcprip`, `wp`, `workprint`) — no token that is not in
      REQ-4c;
      **(c)** add a fourth parameter `allowCinemaReleases?: boolean` **defaulting to `false`**, and
      union `!allowCinemaReleases && isCinemaCapture(…)` into pass 1's existing filter.
      Do **not** merge `isUpscaled` and `isCinemaCapture` into one predicate — share
      `matchesAnyToken`, not the decision (`web/plan.md` step 17a). No new pass, no comparator key,
      no new `ranking` field, no `messages/*.json` change.
      *Done when:* `bin/cli web npx --no tsc --noEmit` reports the baseline (0) and
      `bin/cli web npx --no biome check src/lib/torrent-ranking.ts` is clean; and a harness run
      (`web/plan.md` § Tests) pastes output showing, **with the argument omitted**, that one
      genuine capture per REQ-4c token is discarded while all four AC-4f names survive —
      `Movie.2024.1080p.BluRay.DTS-HD.MA.5.1`, `Ghosts.of.Mars.1080p.BluRay`,
      `Catch.Me.If.You.Can.1080p`, `Camelot.1080p.WEB-DL` — and, with the argument `true`, that
      every capture is kept and the ordering is identical to the `0.6.0` result.
      Covers **AC-4f** and REQ-4c's unknown-flag branch.

- [x] **T021** `[web]` In `services/web/src/components/search/SearchTorrent.tsx`, compute the
      argument beside the existing `preferredGroups` derivation and pass it to
      `rankTorrentResults`: a **movie** target gets `preferences?.allowCinemaReleases ?? false`;
      an episode, season or null target gets `true`. Add the one comment Article XI's second case
      owes that `true` — it means "this veto does not apply to this target kind", not "the user
      allows captures". No new state, no new button, no new copy, no call to
      `setAllowCinemaReleases`, and no edit to `PreferencesForm.tsx` or to any query document:
      `Preferences` already selects `allowCinemaReleases` and the component already holds it
      unused. → T020
      *Done when:* `bin/cli web npx --no tsc --noEmit` reports the baseline, `bin/npm web run
      build` exits 0, `bin/cli web node scripts/check-messages.mjs` reports the **same key count
      as before this group** (REQ-4c adds no copy), and
      `git diff --stat services/web` names exactly two modified files.

- [ ] **T022** `[web]` Run the `spec_version` 0.7.0 live pass, against a film still in cinemas whose
      result list actually contains captures. **Narrowed by the 2026-09-27 normalization:** AC-4d,
      AC-4f and AC-4g are closed against the module itself and are ticked, so what this pass still
      owes is **AC-4e** — an all-captures list producing REQ-17's empty-candidate message and not the
      "no results" copy, with a clean console and a working toggle-back. Do the other three by eye
      while you are there if the live set offers them, and report them as confirmation rather than as
      the first evidence.
      REQ-4c's unknown-flag branch is **not** reachable and is not asked for: since `073` the flag is
      read from the database before ranking (`spec.md` REQ-4c, annotated). `plan.md`
      § Verification steps 16–21 are written against the deleted `web` module — the observable
      behaviour is the same, the mechanism named there is not. → T021
      *Done when:* the report names the exact release titles vetoed and the exact titles that
      survived, plus the before/after row counts. A criterion the live indexer could not produce is
      recorded in § Blocked with what it would need — **not** ticked.

- [ ] **T022b** `[api]` In `services/api/src/indexer/ranking.spec.ts`, add the one case
      **AC-4f** has no test for: a list holding `… 1080p BluRay DTS-HD MA 5.1 …`,
      `Ghosts.of.Mars.1080p.BluRay`, `Catch.Me.If.You.Can.1080p` and `Camelot.1080p.WEB-DL`, ranked
      with `allowCinemaReleases: false`, asserting all four survive. The criterion is ticked on a
      measurement, not on a test — the cinema token list is otherwise exercised only through `HDCAM`,
      and `ts`/`tc`/`cam` are the shortest tokens in the file, where a false positive **removes** a
      release instead of demoting it. Touch nothing else; this is one `it()`.
      *Done when:* `bin/npm api run test -- src/indexer` is green and the report names the new test.

- [ ] **T023** `[docs]` Close `0.7.0`. **Narrowed by the 2026-09-27 normalization**, which ticked
      REQ-4c and AC-4d/AC-4f/AC-4g and found the veto already documented: `services/api/CLAUDE.md`'s
      `indexer/` paragraph names "cinema captures (film only)" among the vetoes, and
      `services/web/CLAUDE.md` § "Torrent ranking heuristic" correctly says `web` owns no comparator
      and defers to `api` — **so neither file needs the edit this task was written for**; state that
      you checked. What is left: the root `CLAUDE.md` "Find release" row, which never recorded that
      the ranking honours `allowCinemaReleases` (the row says the preference stopped being
      write-only for the `076` windows only); **AC-4e** against T022's report, or a § Blocked entry;
      and `status: Implemented` on `spec.md`, `plan.md` and `web/plan.md` with `status: Done` here,
      once Groups 7 and 8 also close. → T022, T022b
      *Done when:* the root `CLAUDE.md` row names the conditional veto, AC-4e is ticked or blocked,
      and no "outstanding"/"unticked" marker for `0.7.0` remains in any of the four feature files.

### Group 7 — `spec_version` 0.8.0/`0.8.1`: the codec ranks depend on the resolution tier

**This group is implemented.** It is kept as the record, and because Group 8 is one edit away from
it. `ranking.ts` on disk carries `0.8.0` exactly: at tier 5 `hevc` 3 / `avc` 2 / unrecognised 0, at
tier 4 and below `avc` 3 / unrecognised 2 / `hevc` 1, REQ-11's criterion 4 skipping between two disc
sources **only at tier 5**, criterion 6 (audio) still skipping at every tier.

`0.8.1` proposed `avc` 1 / unrecognised 2 at tier 5 and was superseded before anyone implemented it —
at tier 5 the AVC rank is now unreachable (REQ-4d vetoes the row) and unrecognised becomes 3 with the
label `HEVC`. The numbers below are left in T024's text as history, struck through in prose rather
than deleted, so a reader who finds `0.8.1` cited elsewhere can see where it went.

**This group is `[api]`, not `[web]`.** The heuristic is `services/api/src/indexer/ranking.ts` since
`073-automatic-episode-acquisition`; `services/web/src/lib/torrent-ranking.ts` no longer exists. An
agent editing anything under `services/web/` or `services/worker/` here has left its scope and must
stop and report. The slice plan for this group is **`api/plan.md`**, not `web/plan.md`.

T024 and T025 are one rule split only by file, so they are sequential and small; T026 closes the
amendment. No `[P]` in this group.

- [x] **T024** `[api]` *(shipped in `de41706`, 2026-09-26 — `0.8.0` only; see the note after (d))*
      In `services/api/src/indexer/ranking.ts`, make the codec rank a function of
      the resolution tier and narrow the comparator's codec skip. Four edits, no more:
      **(a)** add a constant beside `DISC_SOURCE_MIN_RANK` for the 4K tier (`UHD_RESOLUTION_TIER =
      5`) and use it in both decisions below, so the tier number exists once;
      **(b)** `codec(title)` → `codec(title, resolutionTier)`, returning REQ-8's two tables —
      the three regexes and all three **labels** unchanged, only the ranks moving. On disk:
      `uhd ? 3 : 1` for HEVC, `uhd ? 2 : 3` for AVC, `uhd ? 0 : 2` for unrecognised. *`0.8.1` asked
      for `uhd ? 1 : 3` and `2` here and was never applied — Group 8's T027 edits the same branch
      instead. Do not write `0.8.1`'s numbers on the way past;*
      **(c)** in `buildRanking`, pass the `res.tier` already computed two lines above;
      **(d)** in `compareCandidates`, gate criterion 4's `bothFromDisc` skip on
      `a.ranking.resolutionTier >= UHD_RESOLUTION_TIER` as well — and leave criterion 6's arm
      exactly as it is (`spec.md` REQ-10, REQ-11).
      Do **not** touch the vetoes, `source`, `dynamicRange`, `audio`, `familyCeiling`,
      `adjustSourceRank`, `rankTorrentResults`, `ranking-context.service.ts`, `indexer.service.ts`,
      `indexer.resolver.ts` or `entities/torrent-result.entity.ts`. No new `ranking` field, no
      resolver change, no `schema.gql` change, no Prisma migration.
      *Done when:* `bin/cli api npx --no tsc --noEmit` reports the baseline (0),
      `git status --short services/api/prisma` is empty, `services/api/schema.gql` is not in
      `git diff --name-only`, and `git diff --stat services/web services/worker` is empty.
      *All four edits are present on disk — `UHD_RESOLUTION_TIER = 5`, the two-argument `codec()`,
      `buildRanking` passing `res.tier`, and `skipCodec` gated on the tier — and nothing in the
      untouched list moved.*

- [x] **T025** `[api]` *(shipped in `de41706`, 2026-09-26, for AC-19 and AC-21 … AC-23; AC-20's test
      asserts the superseded `0.8.0` outcome and AC-24's was never written — both go to T028)*
      In `services/api/src/indexer/ranking.spec.ts`, cover **AC-19 … AC-24**.
      Two existing tests change result and must be **rewritten, not deleted**:
      `'skips codec and audio between two disc sources'` uses a 1080p pair, where codec now decides
      — move that pair to `2160p UHD BluRay Remux` (**AC-22**) and add a 1080p `BluRay` pair
      asserting the opposite, the `x264` leading a **larger** `x265` (**AC-21**); and
      `'still compares codec between two web sources'` expects the 1080p `x265` to lead — invert it
      (**AC-19**) and rename it, then add the 2160p mirror where the smaller `x265` leads
      (**AC-20**). Add the three-release 1080p `BluRay` case asserting `x264`, untagged, `x265` in
      that order (**AC-23**), the three-release 2160p `WEB-DL` mirror asserting `x265`, untagged,
      `x264` (**AC-24** — `WEB-DL` and not disc, so REQ-11's tier-5 skip does not hide the
      criterion), and one test reading `codecRank` directly off the returned `ranking`
      for a 1080p `x264` and a 2160p `x265` — both 3 — so the tier dependency is asserted and not
      merely implied (`plan.md` § Risks, "the rank table is read as absolute").
      Leave `ranking-context.service.spec.ts`, `indexer.service.spec.ts` and
      `scheduler/tasks/acquire-episodes.task.spec.ts` alone — the sweep consumes `candidateRank`,
      whose shape does not change. → T024
      *Done when:* `bin/npm api run test -- src/indexer` is green, the report names the test that
      carries each of AC-19 … AC-24, and the suite/test counts before and after are both stated.
      *On disk: `'prefers AVC over a larger HEVC between two 1080p web sources (AC-19)'`,
      `'compares codec between two 1080p disc sources, AVC leading a larger HEVC (AC-21)'`,
      `'skips codec and audio between two 4K disc sources (AC-22)'`,
      `'orders x264, untagged, x265 at 1080p BluRay whatever the sizes (AC-23)'` and
      `'reports codecRank 3 for 1080p x264 and for 2160p x265'`. The AC-20 test exists and is green
      on the wrong assertion. The suite was not re-run in the normalization pass — the dev `api`
      container carries no `jest` — so each criterion was re-measured directly against the on-disk
      module instead, and `bin/npm api run test -- src/indexer` is still Group 8's gate.

- [ ] **T026** `[docs]` Update `services/api/CLAUDE.md`'s `indexer/` paragraph: the codec rank
      depends on the resolution tier (HEVC first at 4K, AVC first below it, unrecognised second at
      both), and the codec skip between two disc sources now applies at
      4K only while the audio skip still applies at every tier. `services/web/CLAUDE.md` and the
      root `CLAUDE.md` need no edit — the labels `web` renders are unchanged and both already defer
      the algorithm's detail to `services/api/CLAUDE.md`; state that you checked rather than
      skipping it silently. Do not add a line to the root `CLAUDE.md` § Current state: this is a
      one-file correction, not a measured feature. **AC-19 and AC-21 … AC-23 are already ticked**
      (2026-09-27 normalization); AC-20 and AC-24 belong to T029, so this task ticks nothing.
      Set `status: Done` here once Group 6 also closes. → T025
      *Done when:* the `api` CLAUDE.md paragraph states both halves of the rule, and
      `git diff --stat services/web services/worker` is still empty.
      **Still open.** That paragraph currently lists the comparator and the four vetoes with no
      mention of the tier, so a reader is told the pre-`0.8.0` rule. Doing it in the same edit as
      T029 is the intent — one paragraph, both amendments.

### Group 8 — `spec_version` 0.9.0: the 4K AVC veto, the inferred label and tier-decided UHD-ness

Same service, same two files, no contract change. `spec.md` REQ-4d and REQ-8 as amended: a tier-5
release naming `avc`/`x264`/`h264` is discarded in **pass 1**, and a tier-5 release naming no codec is
labelled `HEVC` with rank 3. Below 4K nothing in that part of this group applies.

**`0.9.0`'s second pass (2026-09-27) added REQ-7b to this same group** rather than opening a
`0.10.0`, because `0.9.0` is not implemented yet: `source()` decides UHD-ness from the resolution
tier instead of from a `uhd` token in the title. That part *does* reach below 4K — it demotes a 1080p
release that names `UHD` — and it is the one rule here found on a live search rather than by reading
(`spec.md` § Post-Implementation Amendments, second pass). T030/T031 carry it, in the same diff.

**Read `api/plan.md` § "The `0.9.0` delta, in one place" before starting.** Group 7's T024 leaves
`codec()` one edit away from this, and the two groups are meant to land as one diff — implementing
`0.8.1`'s tier-5 numbers and then replacing them is wasted work the plan explicitly rules out.

The order matters once: T027 and T030 are the module, T028 and T031 the tests, T029 the docs. No
`[P]` — T027 and T030 edit the same file, so they are one agent's sequential work, not two.

- [ ] **T027** `[api]` In `services/api/src/indexer/ranking.ts`, add the veto and the inference. Two
      edits, no more:
      **(a)** in `codec()`, at `resolutionTier >= UHD_RESOLUTION_TIER`, return
      `{ rank: 3, label: 'HEVC' }` where nothing is recognised — and leave the `AVC` branch returning
      the label `AVC` at both tiers, because (b) reads it;
      **(b)** in `rankTorrentResults`, add one predicate to the **`survivors`** filter dropping an
      entry whose `ranking.resolutionTier >= UHD_RESOLUTION_TIER` and `ranking.codecLabel === 'AVC'`.
      It must sit inside `survivors`, before `maxTier` is computed — that ordering is REQ-4d's
      cannot-empty-the-set guarantee and AC-27 asserts it.
      Do **not** touch `compareCandidates` in this task (criterion 4 goes inert at tier 5 as a
      consequence; REQ-11's skip stays as Group 7 left it), do not mark the inferred label, do not add
      a `ranking` field to report the veto, and do not extend the inference below tier 5. Same
      untouched list as T024 otherwise.
      *Done when:* `bin/cli api npx --no tsc --noEmit` reports the baseline (0),
      `git status --short services/api/prisma` is empty, `services/api/src/schema.gql` is not in
      `git diff --name-only`, and `git diff --stat services/web services/worker` is empty.
      → T024 *(done — the branch this task edits is the `uhd ? 0 : 2` one already on disk)*

- [ ] **T028** `[api]` In `services/api/src/indexer/ranking.spec.ts`, cover **AC-25 … AC-28** and
      rewrite the two criteria `0.9.0` changed:
      **AC-20** (the 2160p `WEB-DL` pair) now asserts the `x264` peer is absent rather than
      outranked; **AC-24** (the three 2160p `WEB-DL` rows) asserts the `x264` absent and the other two
      ordered by size with the label `HEVC`. Then add: a `2160p BluRay x264` **larger** than every
      other disc row, absent from the candidates (**AC-25** — the case a rank cannot reach, since
      REQ-11 skips criterion 4 between discs at tier 5); a list holding both a 2160p untagged row and
      a 1080p untagged row, asserting the labels `HEVC` and `—` respectively (**AC-26**); a set whose
      only 2160p rows name `x264`, asserting the candidate set is **non-empty**, drawn from 1080p and
      holds no 2160p row (**AC-27**); and a `2160p WEB-DL AV1` row, asserting it is absent and that no
      row in the result carries the label `HEVC` for it (**AC-28**).
      AC-27 is the failure path and must fail loudly if the veto is moved after the tier pass — assert
      the set's length and its tier, not just that some row survived. Leave the sweep specs alone, as
      T025 says. → T027
      *Done when:* `bin/npm api run test -- src/indexer` is green, the report names the test carrying
      each of AC-20, AC-24 … AC-28, and the suite/test counts before and after are both stated.

- [ ] **T030** `[api]` Same file, `services/api/src/indexer/ranking.ts`, same diff as T027 —
      **REQ-7b**. Give `source()` a second parameter, `resolutionTier`, and replace its first line
      `const uhd = /\buhd\b/.test(title);` with `const uhd = resolutionTier >= UHD_RESOLUTION_TIER;`.
      Pass `res.tier` at the one call site in `buildRanking`, exactly as T024 did for `codec()`. Keep
      the local named `uhd` and leave every `uhd ? … : …` expression below it alone, so the ladder is
      visibly unchanged.
      **Replace the test, do not widen it** — `|| resolutionTier >= …` leaves half the bug alive
      (`spec.md` AC-30). After the edit, `grep -n uhd src/indexer/ranking.ts` must show only
      `UHD_RESOLUTION_TIER` and the label strings; a surviving `/\buhd\b/` means the regex was kept.
      **Do not touch `familyCeiling` or `adjustSourceRank`**: REQ-22's promotion going inert for
      tier-5 disc sources is an accepted consequence, not a defect to compensate for (`spec.md`
      REQ-22). **Do not touch `src/scheduler/`** — REQ-7b moves a value `076`'s `minSourceRank` floor
      reads, correctly, and that is out of this slice (`api/plan.md` § "REQ-7b and `076`'s quality
      floors"). → T027
      *Done when:* the grep above is clean, `bin/cli api npx --no tsc --noEmit` is at 0 errors, and
      `git diff --stat services/api` still names exactly the two files of Group 8.

- [ ] **T031** `[api]` In `services/api/src/indexer/ranking.spec.ts`, cover **AC-29 … AC-31**.
      Two 2160p remuxes differing only in the `uhd` token → both `sourceRank` 8 and label
      `UHD BluRay Remux`, the larger leading (**AC-29**); a 1080p release naming `UHD BluRay` against a
      1080p `BluRay Remux` → the first is rank 5 with the chip `BluRay` and the remux leads
      (**AC-30**, the failure direction); and one list asserting the `candidate` set and the best tier
      are **unchanged** by REQ-7b while `candidateRank`/`sourceRank`/`sourceLabel` may differ
      (**AC-31** — assert the set's membership and length, not merely that it is non-empty, since the
      bug this guards against is a source rank leaking into pass 1).
      **First run the existing suite and read the failures.** Any case relying on a `uhd` token to
      reach rank 8 or 6 still passes; a case relying on its *absence* to hold a tier-5 release at 7 or
      5 now fails and was asserting the defect — rewrite it and say which, do not delete it. → T030
      *Done when:* `bin/npm api run test -- src/indexer` is green, the report names the test carrying
      each of AC-29 … AC-31, any pre-existing case rewritten is named with the reason, and the
      suite/test counts before and after are both stated.

- [ ] **T029** `[docs]` Update `services/api/CLAUDE.md`'s `indexer/` paragraph, in the same edit as
      T026 rather than as a second pass: pass 1 now has a **fourth** unconditional veto (tier-5 AVC,
      beside AV1/VP9, dead swarms and upscales) plus REQ-4c's conditional one, and at 4K the codec
      chip is an **inference** — a release naming no codec reads `HEVC`, and the criterion decides
      nothing at that tier. State plainly that the label is not the parse there, since that is the
      invariant a future reader will otherwise trust. Same paragraph, add **REQ-7b**: the source
      ladder's UHD rungs are decided by the resolution tier, not by a `uhd` token in the release name
      — so a 2160p remux is `UHD BluRay Remux` however it is spelled, a 1080p release naming `UHD`
      is not, and `sourceLabel` is therefore the **second** inferred chip in this module beside the
      tier-5 `HEVC`. Note in one clause that this makes REQ-22's promotion inert for tier-5 disc
      sources, since a reader of `familyCeiling` will otherwise wonder why it has a pair that can
      never be climbed. `services/web/CLAUDE.md` needs no edit (the
      chip renders whatever string `api` sends) and the root `CLAUDE.md` gets no § Current state line
      — same reasoning as T026; say you checked. **`076`'s section needs no edit** either, and do not
      write one: the floor's behaviour is unchanged, only the value it reads moves, and `spec.md`
      records it as out of scope. Then tick **AC-20, AC-24 … AC-31** and **REQ-7, REQ-7b** in
      `spec.md` against T028's and T031's reports. → T028, T031
      *Done when:* the `api` CLAUDE.md paragraph states the veto, the inference and REQ-7b, every AC
      in Group 8 is ticked with a trace to a named test, REQ-7 and REQ-7b are ticked, and `git diff
      --stat services/web services/worker` is still empty.

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
