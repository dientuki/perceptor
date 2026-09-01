---
title: Torrent Ranking Heuristic
spec_version: 0.3.0
author: Juan "Dientuki" Farias
created_at: 2026-08-31
last_updated: 2026-09-01
status: Approved
services: [web]
---

# SPEC: Torrent Ranking Heuristic (`spec.md`)

## Context & Goal

Today the torrent search modal (`services/web/src/components/search/SearchTorrent.tsx`, opened from
the movie detail page at `services/web/src/app/(dashboard)/movies/[id]/page.tsx`) hands the user a
raw list. `searchTorrents` groups the indexer's rows by infoHash and returns them sorted by size,
largest first, and that is the only ordering that exists. The user reads the release names one by
one and decides by eye, every time.

**The destination of this work is an automatic pick** — Perceptor choosing the release itself, with
no human in the modal. This feature is the step before that: the same selection algorithm, run on
demand and rendered, so the decision can be watched against real result lists and corrected before
anything acts on it unattended. That framing decides the whole design. The button does not offer a
nicer ordering for a human to browse; it **shows the candidate set the automatic picker would
consider**, and nothing else. A release the algorithm would never look at has no reason to be on
screen, because its presence would make the harness lie about what the algorithm does.

What makes the choice decidable at all is that Perceptor is not picking a file to watch — it is
picking **a source to recompress**. The worker transcodes to AV1 at the resolution the user wants
(`011`, `024`, `031`), so the question is "which of these is the best input to that pipeline". Two
consequences drive everything:

**Resolution is a floor, not a preference.** Detail absent from the source cannot be restored by
transcoding, while a higher resolution can always be scaled down to the target. So if the list
holds a single 2160p WEB-DL, every 1080p Blu-ray remux in it is irrelevant — not worse, *out of
consideration*. Resolution therefore **selects** the candidate set; the rest of the heuristic only
ranks within it.

**A source already in AV1 or VP9 is worthless as a source.** Re-encoding it to AV1 spends CPU to
lose generation quality with nothing to gain, and it is evidence the release is a re-encode of
something else probably also in the list. Those are vetoed outright.

A button beside "Buscar" toggles this view on and off. It searches nothing — it works on exactly
the list the last "Buscar" produced, without a network call. Everything it computes is derived and
in-memory: not persisted, never across the GraphQL boundary. Toggling off restores the full,
untouched list, which is what makes hiding safe — no release is ever lost, only set aside.

The heuristic is written as a reusable unit precisely because the automatic picker is meant to call
the same code later, and because other entry points in `web` (season packs) will want it.

No pipeline stage in the root `CLAUDE.md` changes status. "Find release" keeps exactly the
behaviour it has; `web` gains a view over its results.

## Requirements

### Functional Requirements

- [ ] **REQ-1 (Reusable Unit)**: The heuristic must be a reusable unit of `web` that takes the list
      of results already held in memory and returns the selected candidates in ranked order, each
      paired with the ranking that placed it (`resolutionTier`, `qualityScore`). It must be
      callable from any component — the eventual automatic picker is the second caller — and not
      embedded in the search modal's markup.

- [ ] **REQ-2 (Inputs Only)**: Every judgement must derive exclusively from fields the results
      already carry — `title`, `size`, `seeders`, `leechers`. No new request, no new field, no
      re-search.

- [ ] **REQ-3 (Selection, Then Ranking)**: The unit runs three passes over the list, in order:
      1. **Veto** — discard every release matching REQ-4.
      2. **Tier** — find the highest resolution tier (REQ-5) present among the survivors, and
         discard every release below it.
      3. **Rank** — order what remains by quality score (REQ-12), descending, stable.

      Passes 1 and 2 **remove** candidates; they do not demote them. If the list holds one 2160p
      release and forty 1080p ones, the result is that single release. Quality score is only ever
      compared between releases of the same resolution tier, so it can never promote a release into
      a tier it does not belong to.

- [ ] **REQ-4 (Codec Veto)**: A release whose name identifies it as `av1` or `vp9` is discarded in
      pass 1, whatever its resolution — a vetoed 2160p release does not set the tier for pass 2.

- [ ] **REQ-5 (Resolution Tier)**: Read from the release name, case-insensitive, highest match
      wins: `2160`/`4k` → tier 4, `1080` → tier 3, `720` → tier 2, `480`/`360` → tier 1, nothing
      recognised → tier 0. Tier 0 is the lowest — an untagged release is treated as an unknown, not
      as a possible 2160.

      **The number is matched bare.** Release names carry the height with or without a scan suffix
      — `1080`, `1080p` and `1080i` are all common, and the suffix is dropped often enough that
      requiring it would silently drop those releases to tier 0. Under REQ-3 that is no longer
      merely a demotion: a misread release is *removed from the candidate set*, so the suffix is
      optional and any scan letter is accepted.

      Matching bare digits demands a boundary on both sides, so the number is recognised only as
      its own token and never as a fragment of a longer one: `10800`, `21600`, `x264` and a year or
      runtime embedded in a larger number must not be read as a resolution.

- [ ] **REQ-6 (Source, 0–30)**: `remux` → 30, `bluray`/`blu-ray`/`bdrip` → 25, `web-dl`/`webdl` →
      18, `webrip` → 12, `hdrip` → 8, nothing recognised → 0. Highest match wins.

- [ ] **REQ-7 (Codec, 0–20)**: `hevc`/`x265`/`h265` → 20, `avc`/`x264`/`h264` → 12, anything older
      or unrecognised (`xvid`, `divx`, `mpeg2`, `vc-1`) → 0. `av1` and `vp9` never reach this
      category — REQ-4 removed them.

- [ ] **REQ-8 (Dynamic range, 0–15)**: `hdr10` (including `hdr10+`) → 15, a bare `hdr` → 10,
      `dv`/`dovi`/`dolby vision` → 6, nothing recognised → 0. Highest match wins — a `HDR10+DV`
      release scores 15, not 21.

- [ ] **REQ-9 (Preferred group, 0 or 12)**: A release whose **name ends in** a preferred group tag,
      compared case-insensitively, scores 12; every other release scores 0. The preferred list is a
      hardcoded constant in `web` for now: `ntb`, `btm`, `flux`. Matching is on the trailing group
      segment, so a title merely containing `flux` mid-string does not match.

- [ ] **REQ-10 (Size, 0–15, relative to the candidate set)**: Size is scored against the largest
      **surviving candidate** — the largest release in the post-REQ-3 set scores 15 and the others
      scale proportionally. A null size scores 0. Because the candidates all share a resolution
      tier by then, this compares like with like: a 2160p release is never measured against a 720p
      one.

- [ ] **REQ-11 (Popularity, 0–10, relative to the candidate set)**: Popularity weighs a seeder as
      two leechers: `seeders * 2 + leechers`, scaled against the largest such figure among the
      surviving candidates.

- [ ] **REQ-12 (Quality Score)**: The sum of REQ-6 … REQ-11, ranging 0–102. Resolution contributes
      no points to it — resolution already decided who is in the set.

- [ ] **REQ-13 (Toggle Button)**: A button sits beside "Buscar" in the search modal. Pressing it
      switches the table to the candidate view; pressing it again restores the full result list in
      the exact order the API returned. Its label must make the current state readable — which view
      is active, and which one the press will apply.

- [ ] **REQ-14 (Visible Reasoning)**: While the candidate view is active, each row must show its
      quality score. The purpose of this feature is to judge the algorithm, and an ordering whose
      reasoning is invisible cannot be judged — a wrong pick and a right one look identical without
      it. The score is not shown in the normal view, where it would be noise.

- [ ] **REQ-15 (No Acquisition)**: The button only changes what is displayed. It never selects a
      row, marks one as chosen, or triggers `addTorrentToMovie` / `addTorrentToEpisode`.
      Downloading stays a per-row action the user takes. Automating that is the *next* feature, and
      it must not arrive by accident in this one.

- [ ] **REQ-16 (Nothing Is Lost)**: Every release removed by REQ-3 must return, in its original
      position, when the button is toggled off. The full API result list is retained untouched for
      as long as it is on screen; the candidate view is derived from it and never replaces it.

- [ ] **REQ-17 (Empty Candidate Set)**: If every release in the list is vetoed, the candidate view
      is empty. The table must say so in its own words — that the heuristic rejected everything and
      the original list is one press away — and must not reuse the "no results" or "no filter
      match" copy, which would read as "the search found nothing" and send the user to search
      again.

- [ ] **REQ-18 (No Results, No View)**: The button is unavailable — disabled, not hidden — while
      the result list is empty or a search is in flight.

- [ ] **REQ-19 (Composes With The Filter)**: The existing title filter applies to whichever list is
      displayed. Filtering the candidate view narrows the candidates and keeps them in rank order;
      clearing it restores the full candidate view. Typing in the filter never toggles the view.

- [ ] **REQ-20 (New Search Resets)**: A new "Buscar" replaces the list and returns the table to the
      normal view, since the previous candidate set described a list that no longer exists.

- [ ] **REQ-21 (Copy Is Catalog-Driven)**: Every string this feature adds — both button labels and
      the empty-candidate message — is a new key under `search.torrent` in
      `services/web/messages/{en,es}.json`. No hardcoded string in the component (`018-ui-i18n`).

### Non-Functional & Operational Requirements

- [ ] **NFR-1 (Nothing Persisted)**: Scores, tiers and the toggle state exist only for the lifetime
      of the open modal. Nothing is written to a database, a setting, a cookie or local storage,
      and nothing appears in any GraphQL request or response.

- [ ] **NFR-2 (No Network)**: Toggling issues no request of any kind. A user who toggles ten times
      causes zero traffic.

- [ ] **NFR-3 (Total Result Under Missing Data)**: Every field read is nullable in the contract. A
      null `title`, a null `size` or a zero swarm must yield a result, never an exception: an
      unparseable release lands in tier 0 with whatever its recognised parts are worth.

- [ ] **NFR-4 (Degenerate Lists)**: A single-result list, a list where every size is null, a list
      where every release is vetoed, and a list where every candidate scores identically must all
      resolve without dividing by zero and without reordering rows arbitrarily.

## GraphQL Contract Delta

**None — this feature does not cross the service boundary.**

`searchTorrents` already returns every field the heuristic reads (`title`, `size`, `seeders`,
`leechers`), the selection is derived in the browser from the list already in memory, and nothing
about it is sent back to `api`. No query, mutation, type, field or error condition changes.

## Data Model Changes

**None.** No Prisma model, field, enum or migration is touched.

## Acceptance Criteria

- [ ] **AC-1**: Given a search for a film that returns a mixed list, when "Buscar" completes, the
      table is in the API's original size-descending order, no score is shown, and the button is
      enabled.

- [ ] **AC-2** (selection): Given a list containing exactly one 2160p release — a WEB-DL x264 with
      few seeders — alongside many 1080p Blu-ray remux HEVC releases from preferred groups, when
      the button is pressed, the table shows **that one release and nothing else**. No new request
      appears in the browser network panel.

- [ ] **AC-3** (ranking within the set): Given a list whose highest tier is 1080p, when the button
      is pressed, every row is 1080p, a remux/HEVC/HDR10/preferred-group release is row 1, and each
      row shows a score that descends down the table.

- [ ] **AC-4** (veto): Given a list whose only 2160p release is AV1, when the button is pressed,
      that release is absent and the candidate set is drawn from the next tier down — the AV1
      release does not set the tier and then leave the set empty.

- [ ] **AC-5** (nothing is lost): Given the candidate view is active, when the button is pressed
      again, the table is byte-identical to AC-1 — every hidden release back, in its original
      position, with no score column.

- [ ] **AC-6** (failure path): Given a result list in which **every** release is AV1 or VP9, when
      the button is pressed, the table shows the empty-candidate message from REQ-17 — not the
      "no results" copy — no error reaches the console, and pressing again restores all of them.

- [ ] **AC-7** (failure path): Given a result list in which every `title` is null and every `size`
      is null, when the button is pressed, the table renders with no console error, every release
      still present (all tier 0, none vetoed), in their original relative order.

- [ ] **AC-8** (failure path): Given a search that returns zero results or is still running, the
      button is visibly disabled and pressing it does nothing.

- [ ] **AC-9**: Given the candidate view is active, when the user types `x265` into the filter,
      only matching candidates remain and they stay in rank order; clearing the filter restores the
      full candidate view.

- [ ] **AC-10**: Given the candidate view is active, when the user runs a second "Buscar", the new
      list renders in the API's original order with the toggle back in its default state.

- [ ] **AC-11**: `bin/npm web run build` exits 0 and `grep -rn "Ordenar" services/web/src` returns
      nothing — the copy lives in `messages/es.json`.

## Out of Scope

- **The automatic pick itself.** This feature renders the decision; it never acts on it (REQ-15).
  Choosing the top candidate and acquiring it unattended is the next feature, and it is the one
  that makes a wrong heuristic expensive rather than merely visible. It should reuse this unit
  unchanged — that is why REQ-1 asks for a reusable one.

- **Persisting the view.** The toggle resets with every search and every reopen of the modal
  (NFR-1). Remembering "this user always wants the candidate view" is a preference with a settings
  row behind it, and it should wait until the automatic pick makes it moot.

- **A resolution ceiling.** REQ-3 always selects the highest resolution available, with no notion
  of "the user only wants 1080p, so stop there". The target resolution is a transcode decision the
  worker already makes (`024`, `031`); constraining the *source* by it would discard the headroom
  that makes a 2160p source worth having.

- **Making the weights configurable.** Every number above and the preferred-group list are
  constants in `web`. Watching them against real searches is exactly what this feature is for;
  moving them into Settings is worth doing once they have earned it.

- **Series and season packs.** The button ships on the movie detail page's modal because that is
  where it will be exercised. The modal is shared with the episode path, so it appears there too;
  the season-pack path (`addMagnetToSeason`, api-only, no web UI) is untouched.

- **`getScore` in `services/api/src/clients/indexer/score.ts`.** That function scores source, audio
  and penalties on the `api` side and is currently dead — only `filterIAData` calls it, and nothing
  calls `filterIAData`. Note its commented-out `getResolutionScore` treated resolution as 30 points
  among others, which is exactly the model REQ-3 rejects. This feature neither uses nor deletes it.
  When the automatic pick moves this logic to `api`, that is the code it should replace.

- **Handling bad rips (`CAM`, `TS`, `TELESYNC`, `SCREENER`) and specific groups (`YTS`, `RARBG`).**
  Only the AV1/VP9 veto removes; nothing else subtracts. An unrecognised source scores 0 in REQ-6,
  which is a weak defence — and note a `CAM` tagged `1080p` not only survives but can *define* the
  tier, evicting every legitimate 720p release from the candidate set. REQ-3 makes this sharper
  than it was under a pure ordering, and it is the first thing to watch for in the manual pass.

  The eventual fix is a **"permitir cine" checkbox**, off by default, which is a user preference
  with its own detection list, its own i18n keys and its own persistence question — not a weight,
  and not something to fold into this button. Until it ships, the human reading the candidate view
  is the filter.

- **Audio.** Neither channel layout nor codec (`TrueHD`, `Atmos`, `DTS-HD`, `DDP`) contributes,
  though the dead `api` heuristic scores it. It was not part of the requested model; adding it
  later is a new weight in an existing category, not a restructure.
