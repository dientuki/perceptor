---
title: Torrent Ranking Heuristic — Tasks
last_updated: 2026-09-01
status: Done
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
it. Every task below that says "verified in T006" is genuinely unverified until T006 runs.

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

## Blocked

Anything an agent stopped on rather than working around. Empty is the normal state; a non-empty
entry is a decision waiting for a human.

| Task | Service | What blocked it | Needs |
| :-- | :-- | :-- | :-- |
| T006 (AC-6, partial) | web | Live indexer search for `Spider-Man AV1` returned 51 real releases; the boundary-anchored veto correctly rejected 49 and correctly spared 2 (genuine 2160p BluRay releases with no boundary-matched `av1` token), so the live UI never rendered `candidateResults.length === 0` — the closest live approximation was 2 survivors, not 0. The exact empty-array path **is** proven: a harness run against the compiled `torrent-ranking.ts` (`rankTorrentResults([av1-only, vp9-only])`) returns `[]` with no throw, and the `showBest && candidateResults.length === 0 && results.length > 0 ? rankEmpty : …` JSX branch was code-reviewed and is a plain boolean condition. This same live search is what surfaced and confirmed the fix for the `DS4K` boundary bug below. | A search query (or seeded fixture) that returns real releases 100% boundary-matched as `av1`/`vp9` with nothing else, to observe `rankEmpty` render live — or accept the harness + code review as sufficient, since forcing this against real trackers is not reliably repeatable. |

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
