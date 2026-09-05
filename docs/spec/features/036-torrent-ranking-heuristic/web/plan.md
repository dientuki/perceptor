---
title: Torrent Ranking Heuristic — web slice
service: web
last_updated: 2026-09-05
status: Implemented
---

# PLAN: Torrent Ranking Heuristic — `web` (`web/plan.md`)

## Scope

`web` owns the whole feature. It adds a pure selection module and wires a toggle into the existing
torrent search modal, so that pressing the button replaces the table with the candidate set the
heuristic selects — and pressing it again restores the full list untouched.

Read `../spec.md` § Context before writing anything: this button is a **harness for a future
automatic picker**, not a convenience sort. That is why it *hides* releases rather than demoting
them, and why each surviving row shows the parsed values that placed it. An implementation that
renders everything in a nicer order satisfies neither.

There is no other service. `api` is **not** in `services:`: no query changes, no new field, no
`score` returned from the server, and nothing under `services/api/` is edited — including
`src/clients/indexer/score.ts`, which is dead code this feature deliberately leaves alone
(`../spec.md` § Out of Scope). If a step here seems to need an API change, that is a
stop-and-report, not a fix (`.claude/agents/web.md`).

Writes are confined to `services/web/` and this directory.

## Files

| File | New / Modified | What changes |
| :-- | :-- | :-- |
| `services/web/src/lib/torrent-ranking.ts` | New | The whole heuristic: the two vetoes, resolution tier, the six criteria, the three selection passes, the lexicographic comparator. One exported function. |
| `services/web/src/components/search/SearchTorrent.tsx` | Modified | Toggle state, the button beside "Buscar", the derived candidate list, the per-row parsed labels, the empty-candidate state, the reset on a new search. |
| `services/web/messages/en.json` | Modified | Three keys under `search.torrent`. |
| `services/web/messages/es.json` | Modified | The same three keys, Rioplatense register. |

`spec_version` 0.5.0 adds to that list — everything below is `web`-internal:

| File | New / Modified | What changes |
| :-- | :-- | :-- |
| `services/web/src/lib/torrent-ranking.ts` | Modified | The language-tag table, the optional requirement parameter, the family-capped source promotion, the criterion-7 tiebreak, two new `ranking` fields. |
| `services/web/src/types/media.ts` | Modified | `AcquisitionTarget`'s **episode** branch gains the series' `audioMandatory` and `audioLanguages`. The movie branch already carries the whole `Movie`, which already has both. |
| `services/web/src/components/shows/SeasonAccordion.tsx` | Modified | Accepts the series' two fields as props and puts them on the `target` it builds. |
| `services/web/src/components/shows/Show.tsx` | Modified | Passes them down to `SeasonAccordion` from the `Show` it already holds. |
| `services/web/src/components/search/SearchTorrent.tsx` | Modified | Derives the requirement from `target`, hands it to the module, renders the language chip and the promotion marker. |

**`spec_version` 0.6.0 (pending — `../spec.md` § Post-Implementation Amendments, REQ-4b):**

| File | New / Modified | What changes |
| :-- | :-- | :-- |
| `services/web/src/lib/torrent-ranking.ts` | Modified | A third pass-1 veto predicate, `isUpscaled(title)`, alongside `isVetoed`/`isDeadSwarm` — boundary-anchored match on `upscaled`/`upscale`/`ai upscale`/`ai-upscale`/`aiupscale`. Unioned into the same pass-1 filter; no new pass, no new comparator criterion, no new `ranking` field (a veto has nothing to label — the release is simply absent). |

No caller change: `SearchTorrent.tsx` already renders whatever pass 1 leaves standing.

No other file. In particular `src/actions/indexer.ts` and `src/types/indexer.ts` are **unchanged** —
the module consumes `TorrentResult` as it already exists — and so are
`src/actions/movies.ts`/`src/actions/shows.ts`: their query documents **already select**
`audioMandatory` and `audioLanguages` (`039`), so there is nothing to add. Editing a query document
here is a sign of having misread this plan.

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

> **Steps 1–11 are done and are kept as the record of how the module got here.** They were written
> against `spec_version` 0.3.0 and still speak of a `qualityScore`, of resolution tiers numbered
> 4/3/2/1, and of REQ numbers that 0.4.0 renumbered when it replaced the weighted score with the
> lexicographic comparator. **`spec.md` is the authority, not these steps.** Read REQ-5 … REQ-11
> for what the module actually computes; what is durable below is the file layout, the reuse notes,
> and the boundary-anchoring discipline. The work still to do is **steps 12–16**.

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

### `spec_version` 0.5.0 — the mandatory audio language

Steps 12–16 are the outstanding work. Each is verifiable on its own; do not collapse them.

12. **The language-tag table** (REQ-23). A module-private map from a language to the set of tokens
    a release name may use for it, built from the `Language` record's `iso3` and `iso2` plus a
    hardcoded alias list — for Spanish: `spa`, `es`, `esp`, `castellano`, `cast`, `latino`, `lat`.
    Structure it so another language is a data addition, not a code change.

    **Every tag is boundary-anchored**, with the same `(?<![\dA-Za-z])…(?![\dA-Za-z])` discipline
    REQ-5 uses — these tokens are the shortest in the file and the most dangerous. Unanchored,
    `lat` matches `Translated` and `Latvian`, and `es` matches nearly every title in the list. The
    consequence is not a wrong row, it is *every* row promoted and the criterion silently reduced
    to noise. `MULTI` and `DUAL` are **not** in the table and must not be added (REQ-23).

    Regional variants collapse: `castellano` and `latino` both satisfy a request for Spanish. The
    table maps to a **language**, never to a region tag.

13. **The requirement type and the promotion** (REQ-22, REQ-25, NFR-5). Add a second, **optional**
    parameter — the `{ mandatory, languages }` pair. When it is absent, unarmed (`mandatory` false)
    or its language list is empty, every part of this amendment is a no-op and the function returns
    exactly what it returns today. That is not a convenience; it is NFR-5, and it is what lets the
    future automatic picker call the unit with no target.

    When armed, adjust the REQ-7 source rank by `+1`, **capped at the ceiling of its own family** —
    remux 8, disc non-remux 6, web 4, unrecognised 0 (no promotion). Express the cap as the family
    ceiling, not as a `Math.min(rank + 1, 8)`: a single global ceiling is the bug REQ-22 exists to
    prevent, and it reads as correct.

    The comparator's `bothFromDisc` check must run on the **adjusted** rank. It cannot change the
    answer — the cap forbids crossing that boundary — and reading the adjusted value keeps a single
    source of truth for the rank rather than two subtly different ones.

14. **The tiebreak** (REQ-24). One new comparator key between audio and size: advertised first,
    inert when the requirement is unarmed. It is **not** skipped for disc sources, unlike codec and
    audio — a disc implies HEVC and a lossless track, but implies nothing about which languages it
    carries, so the tag is real information for a remux too. Add a comment saying so; the adjacent
    `bothFromDisc ? 0 : …` lines make the skip look like the house style, and the next reader will
    otherwise "fix" it.

15. **The `ranking` labels and the chip** (REQ-14 as amended). `ReleaseRanking` gains the matched
    language (or null) and whether the source rank was promoted. `SearchTorrent.tsx` renders the
    language as one more chip in the existing row of chips — same component, no fifth column — and
    a promoted row must be **visibly distinguishable from a genuine one**: a `BluRay Remux`
    promoted to rank 8 must not render as `UHD BluRay Remux`. Show the read source label and mark
    the promotion beside it. Nothing renders when the requirement is unarmed.

    Both are format identifiers, not prose — `SPA` is `SPA` in every locale — so **no new catalog
    key** (REQ-21). If the promotion marker needs a word rather than a symbol, that word *is* a new
    key in both catalogs, and `scripts/check-messages.mjs` must stay green.

16. **The plumbing** (REQ-25). `AcquisitionTarget`'s episode branch gains the series'
    `audioMandatory`/`audioLanguages`; `Show.tsx` passes them to `SeasonAccordion`, which puts them
    on the `target` it builds; `SearchTorrent` reads the pair off whichever branch it has — the
    movie branch already carries the whole `Movie` — and passes it to the module.

    **Do not touch the query documents.** `GetMovie` and `GetShow` already select both fields
    (`039`). Adding them again, or reaching for a new server action, means the plan was misread.

## Contract obligations

`../spec.md` § GraphQL Contract Delta is **None — this feature does not cross the service
boundary.** `web` owes `api` nothing and consumes nothing new: no query document changes, no new
field on `searchTorrents`, no new error condition to handle.

**This still holds at `spec_version` 0.5.0.** The four fields REQ-25 reads
(`Movie.audioMandatory`/`audioLanguages`, `Show.audioMandatory`/`audioLanguages`) were added by
`039-per-title-language-split` and are **already selected** by the `GetMovie` and `GetShow` query
documents in `src/actions/movies.ts` and `src/actions/shows.ts`. Step 16 moves data that is already
in the browser from one component to another. Adding a field to a query document, writing a server
action, or editing anything under `services/api/` is a stop-and-report.

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

**The compensating control that actually worked, and that 0.5.0 must reuse.** During the original
implementation the module was compiled in isolation and driven from a hand-written Node harness
inside the running container:

```bash
docker exec -w /tmp/h perceptor-web /app/node_modules/.bin/tsc ranking.ts harness.ts \
  --outDir out --module commonjs --target es2020 --esModuleInterop --skipLibCheck
docker exec -w /tmp/h perceptor-web node out/harness.js
```

That is what caught the `DS4K` boundary bug and what proved the `BDRemux` and remux-priority fixes.
It is not a test suite — nothing runs it in CI and it is not committed — but it is repeatable and it
exercises the **real compiled module**, which is the only way to check a comparator whose failures
are silent reorderings.

`spec_version` 0.5.0 needs it more than 0.4.0 did, because its failure modes are quieter still:
an unanchored `lat` promoting every release, or an uncapped `+1` letting a `WEB-DL` outrank a
`BluRay`, both produce a plausible-looking table. Drive the harness with the AC-12 five-release
set both armed and unarmed, and with the AC-16 false-positive names (`MULTi`, `DUAL`, `Translated`,
`Latvian`) before touching the UI.

The recorded follow-up is the automatic picker: when the selection moves to `api` to run without a
human, it lands where jest already lives and where `src/clients/indexer/score.ts` already sits.
That is a contract change and needs its own spec — and it is where these harness cases finally
become real tests.

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

Then walk the **fifteen** numbered manual checks in `../plan.md` § Verification plus its forced
cases, and report what you clicked and what you saw — including the row count before and after
pressing the button, whether the network panel stayed silent, and whether an AV1 release or an
all-vetoed list actually appeared in what you tested. If they did not, say so rather than reporting
AC-4 and AC-6 as passed.

Checks 10–15 are the `spec_version` 0.5.0 pass and need setup first: a film with **Audio mandatory**
ticked and Spanish in its audio languages, and a series with the same, for the episode path. The
decisive comparison is **the same search run twice**, once with the checkbox on and once off: only
rows advertising the language may move, and only upward. `Venom Let There Be Carnage` returns the
exact five-release set AC-12 is written against.

Report the ordering **both ways**, not just the armed one. AC-14 — that an unarmed title still
ranks exactly as it did before this amendment — is the criterion most likely to break silently and
the one a passing armed case tells you nothing about.
