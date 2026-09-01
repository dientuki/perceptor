---
title: Torrent Ranking Heuristic — web slice
service: web
last_updated: 2026-09-01
status: Implemented
---

# PLAN: Torrent Ranking Heuristic — `web` (`web/plan.md`)

## Scope

`web` owns the whole feature. It adds a pure selection module and wires a toggle into the existing
torrent search modal, so that pressing the button replaces the table with the candidate set the
heuristic selects — and pressing it again restores the full list untouched.

Read `../spec.md` § Context before writing anything: this button is a **harness for a future
automatic picker**, not a convenience sort. That is why it *hides* releases rather than demoting
them, and why each surviving row shows its score. An implementation that renders everything in a
nicer order satisfies neither.

There is no other service. `api` is **not** in `services:`: no query changes, no new field, no
`score` returned from the server, and nothing under `services/api/` is edited — including
`src/clients/indexer/score.ts`, which is dead code this feature deliberately leaves alone
(`../spec.md` § Out of Scope). If a step here seems to need an API change, that is a
stop-and-report, not a fix (`.claude/agents/web.md`).

Writes are confined to `services/web/` and this directory.

## Files

| File | New / Modified | What changes |
| :-- | :-- | :-- |
| `services/web/src/lib/torrent-ranking.ts` | New | The whole heuristic: veto, resolution tier, quality score, the three selection passes. One exported function. |
| `services/web/src/components/search/SearchTorrent.tsx` | Modified | Toggle state, the button beside "Buscar", the derived candidate list, the per-row score, the empty-candidate state, the reset on a new search. |
| `services/web/messages/en.json` | Modified | Three keys under `search.torrent`. |
| `services/web/messages/es.json` | Modified | The same three keys, Rioplatense register. |

No other file. In particular `src/actions/indexer.ts` and `src/types/indexer.ts` are **unchanged** —
the module consumes `TorrentResult` as it already exists.

## Existing code to reuse

- **`src/types/indexer.ts` → `TorrentResult`** — the input type. The module takes this type and
  returns it paired with a ranking; it must not declare its own release shape or widen the existing
  one.
- **`src/components/ui/button/Button.tsx`** — the toggle. `variant="outline"`, `size="md"` to match
  the adjacent submit button, `type="button"` (it lives inside the search `<form>`; without this it
  submits and fires a search, which is REQ-15's exact prohibition), `startIcon`, and `disabled`. Do
  not build a bare `<button>`.
- **`lucide-react`** — already imported in `SearchTorrent.tsx` (`Download`, `Loader2`, `Search`).
  Add one icon from the same import; `ListFilter` or `Sparkles` reads as "show the best candidates"
  better than a sort arrow, since the button no longer sorts.
- **`useTranslations("search.torrent")`** — the `t` already bound at the top of `SearchTorrent.tsx`.
  All three new keys hang off that namespace, so they are `t("…")` with no second hook.
- **The `filteredResults` derivation** in `SearchTorrent.tsx` — the candidate selection slots in
  *before* it, and `filteredResults` keeps filtering whatever list it is handed (REQ-19). Do not
  fold selection into the filter expression; they are independent.
- **The existing empty-state cell** in the table body — the `isLoading ? … : results.length > 0 ? …`
  ternary already renders `searchingTrackers` / `noFilterMatch` / `noResultsYet`. The
  empty-candidate message (REQ-17) is a new branch there, not a new component.
- **React Compiler is on** (`reactCompiler: true`). Do not hand-add `useMemo`/`useCallback` around
  the selection call; the compiler memoizes it. Follow the surrounding file, which has none.

## Steps

1. **`src/lib/torrent-ranking.ts` — the type and the entry point.** Export one function taking
   `TorrentResult[]` and returning the surviving candidates in rank order, each paired with its
   `{ resolutionTier, qualityScore }` (REQ-1). Everything else in the file is module-private. The
   function **must not mutate its argument** — `filter` already copies, but the final `sort` must
   run on an array this function owns (`../plan.md` § Risks).

2. **Pass 1 — veto.** Drop every release matching REQ-4 (`av1`, `vp9`). This runs **first**, before
   the tier is computed: a vetoed 2160p release must not set the tier and then leave the set empty
   (AC-4).

3. **Pass 2 — tier.** Compute the highest `resolutionTier` among the survivors and keep only those
   matching it. **Guard the empty case explicitly** — an empty survivor list returns an empty
   candidate set, without `Math.max()` returning `-Infinity` and without a `reduce` that throws on
   no initial value (AC-6, NFR-4).

4. **Pass 3 — the relative denominators, then the score.** Over the **candidates only**, not the
   input list: the largest non-null `size`, and the largest `seeders * 2 + leechers`. Each is `0`
   when the set is empty or every value is null/zero, and a non-positive denominator yields `0`
   points for that category for every candidate rather than `NaN` (REQ-10, REQ-11, NFR-4). Then
   sort by quality score descending, returning `0` from the comparator on a tie and adding no
   further tiebreak — `Array.prototype.sort` is stable and that stability is the intended
   behaviour.

5. **The per-title readers.** Private helpers over the lowercased `title`, each returning `0` (or
   tier 0, or "not vetoed") when `title` is null (NFR-3):
   - **Veto** (REQ-4) — `av1`, `vp9`.
   - **Resolution tier** (REQ-5) — `2160`/`4k` → 4, `1080` → 3, `720` → 2, `480`/`360` → 1, else 0.
     The scan suffix is optional and `p`/`i` both count. **Bare digits need a digit boundary on
     both sides**: `1080`, `1080p`, `1080i` match; `10800` and `21600` must not.
   - **Source** (REQ-6), **codec** (REQ-7), **dynamic range** (REQ-8) — highest match wins within
     each category; check the longer token first (`hdr10` before `hdr`, `x265` before `265`).
   - **Preferred group** (REQ-9) — read the **trailing** group segment of the name, lowercase,
     compare against a module-private `["ntb", "btm", "flux"]`. A mid-string `flux` must not match.

   Every short token (`dv`, `hdr`, `av1`, `vp9`, `4k`) needs boundary anchoring, not `includes`.
   `includes("dv")` matches `DVDRip` and hands a DVD rip 6 HDR points (`../plan.md` § Risks).

6. **Catalogs.** Add to `search.torrent` in **both** `messages/en.json` and `messages/es.json`, in
   the same step — `scripts/check-messages.mjs` fails on drift:
   - `rankButton` — shown when the view is off; the press turns it on. `en`: `Best candidates`.
     `es`: `Mejores candidatos`.
   - `rankButtonReset` — shown when the view is on; the press restores the API list. `en`:
     `All results`. `es`: `Todos los resultados`.
   - `rankEmpty` — the REQ-17 empty-candidate message. It must say the heuristic rejected every
     release and that the full list is one press away, and must read differently from
     `noResultsYet` / `noFilterMatch`. `en`: `Every release was rejected by the heuristic. Switch
     back to all results to see them.` `es`: `La heurística descartó todos los releases. Volvé a
     todos los resultados para verlos.`

   The button label must read as the state, not as a generic verb (REQ-13). No Spanish string in
   `.tsx` (REQ-21) — `grep -rn "Ordenar" services/web/src` must stay empty.

7. **`SearchTorrent.tsx` — state and button.** Add `const [showBest, setShowBest] = useState(false)`.
   Render the `Button` immediately after the existing submit button inside the same `<form>`,
   `disabled={isLoading || results.length === 0}` (REQ-18 — disabled, **not** hidden), label
   `t(showBest ? "rankButtonReset" : "rankButton")`, `onClick` toggling the boolean and nothing
   else. It must not select a row, mark one, or call any acquisition action (REQ-15).

8. **`SearchTorrent.tsx` — derive the displayed list.** When `showBest`, the displayed list is the
   module's output; otherwise it is `results` as-is. Then apply the existing title filter to
   whichever it is (REQ-19). Keep `results` itself in the API's order at all times — it is the only
   copy of that ordering, and REQ-16/AC-5 depend on it surviving untouched.

9. **`SearchTorrent.tsx` — the per-row score.** While `showBest`, show each candidate's quality
   score on its row (REQ-14). The table's grid is a fixed four-column template
   (`[minmax(0,1fr)_100px_100px_80px]`) on both the header row and every body row — **do not add a
   fifth column**, which would mean editing both templates and re-tuning the layout. Render the
   score as a small badge inside the release-name cell, beside the title, and omit it entirely when
   `showBest` is false.

10. **`SearchTorrent.tsx` — the empty-candidate branch.** When `showBest` and the candidate set is
    empty while `results` is not, the table body renders `t("rankEmpty")` rather than falling
    through to `noFilterMatch` or `noResultsYet` (REQ-17, AC-6).

11. **`SearchTorrent.tsx` — reset on a new search.** In `handleSearch`, alongside the existing
    `setResults([])`, `setShowBest(false)` (REQ-20). The previous candidate set described a list
    that no longer exists.

## Contract obligations

`../spec.md` § GraphQL Contract Delta is **None — this feature does not cross the service
boundary.** `web` owes `api` nothing and consumes nothing new: no query document changes, no new
field on `searchTorrents`, no new error condition to handle.

The existing error handling in `SearchTorrent.tsx` (`searchError` from `searchTorrentsAction`,
`addError`/`errorKey` from the acquisition actions, the `ALREADY_COMPLETED_KEYS` replace path) is
**untouched**. Do not refactor it while you are in the file.

Nothing about the selection is persisted or transmitted (NFR-1): no cookie, no `localStorage`, no
setting, no request body. Toggling issues zero network traffic (NFR-2).

## Tests

**None, and that is a known gap rather than a judgement that none are owed.**

`services/web` has no test runner, and adding one is explicitly its own decision with its own spec
(`services/web/CLAUDE.md` § "Tests: there are none"; `.claude/agents/web.md`). Do **not** introduce
Vitest, Jest or Playwright as a side effect of this feature.

Under Article IX this module is exactly the code a test is owed to: a wrong selection raises no
error, logs nothing, and looks identical to a right one — and under REQ-3 it now *hides* rows, so
the token-boundary cases (`DVDRip` scoring as HDR, `10800` parsed as 1080p and evicting the real
candidates) would remove releases from the table with nothing on screen to reveal it. The
compensating controls are the manual pass in `../plan.md` § Verification, run against real result
lists, and the fact that every rule is a numbered requirement in `../spec.md` rather than something
invented at the keyboard.

The recorded follow-up is the automatic picker: when the selection moves to `api` to run without a
human, it lands where jest already lives and where `src/clients/indexer/score.ts` already sits.
That is a contract change and needs its own spec.

## Done when

```bash
bin/cli web npx --no tsc --noEmit
bin/cli web node scripts/check-messages.mjs
bin/cli web npx --no biome check src/lib/torrent-ranking.ts src/components/search/SearchTorrent.tsx
bin/npm web run build
```

Expected: typecheck **0 errors** (report the count before and after — `services/web/CLAUDE.md`
records 0 as the baseline), `check-messages` exit 0, Biome clean **on those two files** (the
repo-wide `bin/npm web run lint` is not a usable gate here), `build` exit 0.

Then walk the nine numbered manual checks in `../plan.md` § Verification plus its two forced cases,
and report what you clicked and what you saw — including the row count before and after pressing
the button, whether the network panel stayed silent, and whether an AV1 release or an all-vetoed
list actually appeared in what you tested. If they did not, say so rather than reporting AC-4 and
AC-6 as passed.
