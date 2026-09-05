---
title: Torrent Ranking Heuristic
spec_version: 0.6.0
author: Juan "Dientuki" Farias
created_at: 2026-08-31
last_updated: 2026-09-05
status: Implemented
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

### Why Not A Score

The first implementation (`spec_version` 0.1.0–0.3.0) ranked candidates by a weighted sum: source
worth up to 30 points, codec 20, dynamic range 15, and so on. Run against real indexer results it
kept producing orderings the user rejected, and tuning the weights did not fix it, because the
problem was the model rather than the numbers.

**A weighted sum cannot express dominance.** The question being asked is "what is the best source
to recompress", and its answer is hierarchical: a UHD BluRay is a better source than a WEB-DL, full
stop — not "better by 7 points, unless the WEB-DL is much larger and better seeded, in which case
worse". But any additive model permits exactly that trade. Every weight is simultaneously a
statement about how much of criterion B is worth one unit of criterion A, and for these criteria
that exchange rate does not exist: no quantity of seeders makes a WEB-DL into a disc source.
Lowering a weight only narrows the window in which the wrong trade happens; it never closes it.

So the model is a **lexicographic comparator**. The criteria are ranked, not weighted, and each is
consulted only to break a tie in the one above it. This makes the guarantee structural — the same
way resolution was already structural under REQ-3, extended to every criterion — and it makes the
ordering explainable: any two rows differ because of exactly one criterion, the first one on which
they disagree.

The cost is that a criterion can no longer express *degree*: a release that is marginally better on
source wins as decisively as one that is far better. That is accepted, and for the top of the list —
the only part that matters once the automatic picker exists — it is the desired behaviour.

### Amended At 0.5.0 — The Mandatory Audio Language

`039-per-title-language-split` split each language preference into an audio list and a subtitle
list, and added an **Audio mandatory** checkbox beside the audio list at three scopes — the user's
general preference, one per (user, film), one per (user, series). It shipped that flag deliberately
**inert**: stored and rendered, read by nothing (`039` REQ-11), with the note that "a future spec
decides what *mandatory* does". Ranking a candidate set is the first thing that can usefully read
it, and this amendment is that decision *for the ranking only*.

The rule it adds: when the target title has *Audio mandatory* on, a release whose name advertises
one of that title's audio languages **climbs one rank inside its own source family** (REQ-22).

Three properties of that sentence carry the whole design.

**It promotes; it does not veto.** "Mandatory" reads like a filter, and a filter is what it cannot
be. A release name is not a track listing: a UHD BluRay Remux carries every audio track on the disc
and its name almost never enumerates them, so a title that fails to say `SPA` is overwhelmingly
likely to *have* Spanish anyway. Presence of a language tag is strong evidence; **absence is not
evidence of absence**. Vetoing on it would discard nearly every disc source in favour of the one
multi-audio repack that happened to spell its languages out — the exact inversion this feature
exists to prevent. Enforcing "mandatory" for real needs the tracks themselves, which only exist
after the download, at encode time, where `ffprobe` can see them; that stays `039`'s open question
and is out of scope here.

**It moves one rank, not to the top.** The obvious shape — a new criterion above source in the
chain — was tried against real results and rejected: it makes the language outweigh the *entire*
source hierarchy, so an 18 GB WEB-DL advertising `Latino` beats four 43 GB UHD BluRay Remuxes that
do not. That is a worse answer than the one it replaces. Under a lexicographic comparator a
criterion cannot express "a bit more important"; it dominates everything below it, completely. So
the language does not enter the chain as a peer of source — it **adjusts the source rank**, which
is the one operation that can express "one step up".

**The step is clamped to its own family** (REQ-22). An unclamped `+1` promotes `WEB-DL` (4) to `5`,
which is `BluRay`'s rank — the language would smuggle a web source into disc territory and
reintroduce exactly the compensation problem § Why Not A Score exists to forbid. The bump therefore
never crosses a structural boundary: web sources cap at `WEB-DL`, disc non-remux at `UHD BluRay`,
remuxes at `UHD BluRay Remux`.

The worked case is the real one this came from. A 54 GB `BluRay Remux` listing twelve audio tracks
including `Spa` sat *below* four 43-and-under GB `UHD BluRay Remux` releases, because the only thing
separating them was the `UHD` token. With Spanish marked mandatory the remux climbs 7 → 8, ties the
UHD remuxes on source, and wins on size — which is the release a human picks looking at the same
list.

None of this crosses the service boundary. `Movie.audioLanguages`/`Movie.audioMandatory` and their
`Show` counterparts already exist and are already fetched by the detail pages that open this modal
(`039` REQ-3, REQ-8); the amendment spends them, and adds no query, field or request (REQ-25).

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

- [x] **REQ-1 (Reusable Unit)**: The heuristic must be a reusable unit of `web` that takes the list
      of results already held in memory and returns the selected candidates in ranked order, each
      paired with the parsed interpretation that placed it (`ranking`). It must be callable from
      any component — the eventual automatic picker is the second caller — and not embedded in the
      search modal's markup.

- [x] **REQ-2 (Inputs Only)**: Every judgement about a *release* must derive exclusively from
      fields the results already carry — `title`, `size`, `seeders`, `leechers`. No new request, no
      new field, no re-search.

      *Amended in `spec_version` 0.5.0.* The unit gains a **second argument**: the audio-language
      requirement of the title being acquired (REQ-25). That is not a new release field and not a
      new fetch — it is data `web` already holds in the component that opens the modal. The
      prohibition it was written to enforce is unchanged: the unit still issues no request of its
      own, and still reads nothing about a release beyond the four fields above.

- [x] **REQ-3 (Selection, Then Ordering)**: The unit runs three passes over the list, in order:
      1. **Veto** — discard every release matching REQ-4 or REQ-4a.
      2. **Tier** — find the highest resolution tier (REQ-5) present among the survivors, and
         discard every release below it.
      3. **Order** — sort what remains through the lexicographic comparator of REQ-11.

      Passes 1 and 2 **remove** candidates; they do not demote them. If the list holds one 2160p
      release and forty 1080p ones, the result is that single release.

      **The ordering is lexicographic, not a weighted score.** *(Redefined in `spec_version`
      0.4.0 — see § Why Not A Score.)* Each criterion is consulted only when every criterion above
      it tied; nothing below can ever compensate for a loss above. This is a stronger and different
      guarantee from a weighted sum, and it is the point of the model: a UHD BluRay Remux cannot be
      overtaken by a WEB-DL because the WEB-DL is bigger or better seeded, at any margin.

- [x] **REQ-4 (Codec Veto)**: A release whose name identifies it as `av1` or `vp9` is discarded in
      pass 1, whatever its resolution — a vetoed 2160p release does not set the tier for pass 2.

- [x] **REQ-4a (Dead-Swarm Veto)**: A release with **zero seeders and fewer than five leechers** is
      discarded in pass 1 alongside REQ-4. Nothing will ever finish downloading from it, so it is
      not a candidate however good its name reads.

      The leecher threshold is what keeps this from being a plain "zero seeders" rule: a swarm with
      no seeder but real leecher interest tends to revive, and discarding it would hand the pick to
      a worse source that merely happens to be alive at this moment. Like REQ-4 it runs before the
      tier pass, so a dead 2160p release cannot set the tier and evict every live 1080p one.

- [ ] **REQ-4b (Upscale Veto)** *(pending, see § Post-Implementation Amendments)*: A release whose
      name identifies it as an upscale — `upscaled`, `ai upscale`/`ai-upscale`/`aiupscale`,
      `upscale` — is discarded in pass 1 alongside REQ-4 and REQ-4a, whatever resolution it claims.

      An upscaled release did not originate at the resolution it advertises — the extra pixels are
      synthesized, not sourced — so a "2160p" upscale is worse evidence of quality than an honest
      1080p release, exactly the inversion REQ-3's tier pass exists to prevent for AV1/VP9. Like
      REQ-4/REQ-4a this runs before the tier pass, so an upscaled 2160p release cannot set the tier
      and evict every genuine 1080p one.

- [x] **REQ-5 (Criterion 1 — Resolution)**: Read from the release name, case-insensitive, highest
      match wins: `2160`/`4k` → 5, `1080` → 4, `720` → 3, `480` → 2, `360` → 1, nothing recognised
      → 0. Tier 0 is the lowest — an untagged release is treated as an unknown, not as a possible
      2160. This is the only criterion that also **removes** candidates (REQ-3 pass 2); every
      other one merely orders.

      **The number is matched bare.** Release names carry the height with or without a scan suffix
      — `1080`, `1080p` and `1080i` are all common, and the suffix is dropped often enough that
      requiring it would silently drop those releases to tier 0. Under REQ-3 that is no longer
      merely a demotion: a misread release is *removed from the candidate set*, so the suffix is
      optional and any scan letter is accepted.

      Matching bare digits demands a boundary on both sides, so the number is recognised only as
      its own token and never as a fragment of a longer one: `10800`, `21600`, `x264` and a year or
      runtime embedded in a larger number must not be read as a resolution.

- [x] **REQ-6 (Criterion 2 — Preferred Group)**: A release whose **name ends in** a preferred group
      tag, compared case-insensitively, ranks above one that does not. The preferred list is a
      hardcoded constant in `web` for now: `ntb`, `btm`, `flux`. Matching is on the trailing group
      segment, so a title merely containing `flux` mid-string does not match.

      **It sits above source deliberately.** The group is a reputation signal standing in for
      qualities the release name cannot express — consistent encoding decisions, correct audio and
      subtitle tracks, no botched HDR pass. The user trusts it more than the source label, so a
      2160p release from a preferred group outranks a 2160p UHD BluRay Remux from an unknown one.

- [x] **REQ-7 (Criterion 3 — Source)**: Highest match wins: UHD BluRay Remux → 8, BluRay Remux → 7,
      UHD BluRay → 6, BluRay/BDRip → 5, WEB-DL → 4, WEBRip → 3, HDRip → 2, nothing recognised
      → 0. Nothing is discarded for its source; an unrecognised one simply ranks last.

      This rank is the only one in the feature that is not final as read: **REQ-22 may raise it by
      one**, within the bounds that requirement sets. Everything the comparator does with source
      (REQ-11) operates on the adjusted value.

      **Remux-ness is the primary split, ahead of the `UHD` tag.** A remux is an already-usable
      video file pulled straight off the disc; a non-remux BluRay/UHD BluRay release is frequently
      a raw ISO image, which contributes nothing to the pipeline until someone extracts it — so a
      plain `BluRay Remux` outranks a tagless `UHD BluRay`, even though `UHD` alone reads as the
      fancier label. `UHD` only breaks the tie *within* each of those two groups. A bare `REMUX`
      with no disc token is treated as a BluRay Remux, which is what it always is in practice.
      `BDRip` is a BluRay encode and ranks with `BluRay`.

      **`BDRemux` is one word and must be matched as such.** Requiring a word boundary before
      `remux` made every `UHD BDRemux` release — a common spelling, and the whole of one tracker's
      catalogue — parse as *unrecognised*, the worst source rank instead of the best. Found against
      real results; it is the reason `remux` is matched without a leading boundary.

      **A streaming-service tag identifies a WEB-DL on its own.** Many releases carry `AMZN`,
      `DSNP` or `ATVP` and never the literal `WEB-DL`. The recognised list is a constant in `web`
      that grows as real release names appear; every entry ranks identically, since *which*
      service it is is not (yet) a criterion. No entry may be ambiguous with a non-service token —
      `ma` would collide with DTS-HD MA and `max` with an ordinary title word, so neither is
      listed.

- [x] **REQ-8 (Criterion 4 — Codec)**: `hevc`/`x265`/`h265` → 3, `avc`/`x264`/`h264` → 2, anything
      older or unrecognised (`xvid`, `divx`, `mpeg2`, `vc-1`) → 0. `av1` and `vp9` never reach this
      criterion — REQ-4 removed them. The separator inside `h265`/`h264` is optional: `H 265` and
      `H.265` are as common as `H265` in real release names.

      **Not compared between two disc sources** (REQ-11). A UHD BluRay is HEVC whether or not the
      release name says so, so a title that omits the codec is missing *information*, not quality;
      comparing on it would rank a verbose title above an identical terse one for being verbose.
      This cannot let an AV1 or VP9 rip through — REQ-4 vetoes those in pass 1, before any source
      is looked at.

- [x] **REQ-9 (Criterion 5 — Dynamic Range)**: `hdr10` (including `hdr10+`) → 3, a bare `hdr` → 3,
      `dv`/`dovi`/`dolby vision` → 2, nothing recognised (SDR) → 0. Highest match wins, never
      combined — a `DV HDR10+` release ranks as HDR10, not as both.

      **`HDR` and `HDR10` rank equally.** HDR10 is the baseline every UHD disc and stream carries,
      so a release tagged plain `HDR` is HDR10 in practice and the shorter spelling should not cost
      it a place. `10bit`/`10-bit` beside a bare `hdr` reads as HDR10 for the same reason. The two
      keep distinct **labels** so the parse stays visible under REQ-14; only their rank is shared.

- [x] **REQ-10 (Criterion 6 — Audio)**: `truehd`, or `dts-hd` + `ma` (a lossless core) **and**
      `atmos` → 4; a lossless core alone → 3; `atmos` alone, or `ddp`/`eac3` (lossy but
      object-audio-capable) → 2; `dts`/`dd`/`ac3`/`aac` (plain lossy) → 1; nothing recognised → 0.
      Highest match wins. The `DDPA` spelling means DDP carrying Atmos and counts as `atmos`.

      **Not compared between two disc sources** (REQ-11), for the same reason as REQ-8: a BluRay or
      remux carries the disc's lossless track whether or not the name mentions it. Audio still
      decides between two web sources, where the release name is the only evidence there is.

- [x] **REQ-11 (The Comparator)**: Candidates are ordered by comparing, in this exact sequence and
      stopping at the first difference:

      | # | Criterion | Direction |
      | :-- | :-- | :-- |
      | 1 | Resolution (REQ-5) | higher first |
      | 2 | Preferred group (REQ-6) | preferred first |
      | 3 | Source (REQ-7), **as adjusted by REQ-22** | higher first |
      | 4 | Codec (REQ-8) | higher first — **skipped if both are disc sources** |
      | 5 | Dynamic range (REQ-9) | higher first |
      | 6 | Audio (REQ-10) | higher first — **skipped if both are disc sources** |
      | 7 | Mandatory audio language (REQ-24) | **advertised** first; inert unless REQ-22 is armed |
      | 8 | Size | **larger** first; a null size sorts as 0 |
      | 9 | Seeders | **more** first |
      | 10 | Leechers | **fewer** first |

      A "disc source" is BluRay, BDRip, BluRay Remux or either UHD variant — REQ-7 rank 5 and
      above. Criteria 4 and 6 are only ever reached when the two candidates already tie on source,
      so testing one of them for disc-ness tests both. **Disc-ness is tested on the adjusted rank**
      (REQ-22), which cannot change the answer: the bump never crosses the disc boundary, so a
      candidate is a disc source before it if and only if it is one after.

      *Criterion 7 added in `spec_version` 0.5.0.* Row 3 is where the mandatory audio language does
      its real work; row 7 only settles the pairs row 3 could not — two candidates already sharing
      an adjusted source rank, where one advertises the language and the other does not.

      The sort must be **stable**, so candidates tying on all ten keep the order the API returned
      them in rather than being shuffled (NFR-4).

      Criterion 1 can never actually differ among the candidates — pass 2 already removed every
      release below the top tier — but it is kept in the chain so the comparator is correct in
      isolation and remains reusable by a caller that does not filter first.

- [x] **REQ-13 (Toggle Button)**: A button sits beside "Buscar" in the search modal. Pressing it
      switches the table to the candidate view; pressing it again restores the full result list in
      the exact order the API returned. Its label must make the current state readable — which view
      is active, and which one the press will apply.

- [x] **REQ-14 (Visible Reasoning)**: While the candidate view is active, each row must show **how
      the heuristic parsed it** — its resolution, preferred group if any, source, codec, dynamic
      range and audio, as read by REQ-5 … REQ-10. The purpose of this feature is to judge the
      algorithm, and an ordering whose reasoning is invisible cannot be judged.

      Under a weighted score this was a single number. A lexicographic comparator has no such
      number, and one would not have helped: what decides a placement is *which criterion broke
      the tie*, which the parsed values show directly and a total never could. It also surfaces
      **misparsing**, the failure mode that actually occurred — a release read as 4K because
      `DS4K` matched, or as SDR because its HDR tag was spelled unusually, is visible at a glance
      against its own title on the same row.

      *Amended in `spec_version` 0.5.0.* When the requirement of REQ-25 is armed, a row that
      advertises the mandatory language must show that too, and a promoted row must show that its
      source rank was raised rather than silently displaying the higher label as if it had been read
      from the name. A user comparing a promoted `BluRay Remux` against a genuine `UHD BluRay Remux`
      has to be able to tell which is which; without it the harness misreports the one thing this
      amendment changed. Nothing is shown when the requirement is not armed.

      These labels are format identifiers (`HEVC`, `HDR10`, `UHD BluRay Remux`) and language tags
      (`SPA`), not prose: they are the same in every locale and are deliberately **not** catalog
      keys (REQ-21). Where a criterion recognises nothing the label is `—`, which is
      language-neutral.

      Nothing is shown in the normal view, where it would be noise.

- [x] **REQ-15 (No Acquisition)**: The button only changes what is displayed. It never selects a
      row, marks one as chosen, or triggers `addTorrentToMovie` / `addTorrentToEpisode`.
      Downloading stays a per-row action the user takes. Automating that is the *next* feature, and
      it must not arrive by accident in this one.

- [x] **REQ-16 (Nothing Is Lost)**: Every release removed by REQ-3 must return, in its original
      position, when the button is toggled off. The full API result list is retained untouched for
      as long as it is on screen; the candidate view is derived from it and never replaces it.

- [x] **REQ-17 (Empty Candidate Set)**: If every release in the list is vetoed, the candidate view
      is empty. The table must say so in its own words — that the heuristic rejected everything and
      the original list is one press away — and must not reuse the "no results" or "no filter
      match" copy, which would read as "the search found nothing" and send the user to search
      again.

- [x] **REQ-18 (No Results, No View)**: The button is unavailable — disabled, not hidden — while
      the result list is empty or a search is in flight.

- [x] **REQ-19 (Composes With The Filter)**: The existing title filter applies to whichever list is
      displayed. Filtering the candidate view narrows the candidates and keeps them in rank order;
      clearing it restores the full candidate view. Typing in the filter never toggles the view.

- [x] **REQ-20 (New Search Resets)**: A new "Buscar" replaces the list and returns the table to the
      normal view, since the previous candidate set described a list that no longer exists.

- [x] **REQ-21 (Copy Is Catalog-Driven)**: Every string this feature adds — both button labels and
      the empty-candidate message — is a new key under `search.torrent` in
      `services/web/messages/{en,es}.json`. No hardcoded string in the component (`018-ui-i18n`).

- [x] **REQ-22 (Mandatory-Audio Promotion)** *(`0.5.0`)*: When the requirement of REQ-25 is
      **armed** — the target title's *Audio mandatory* flag is on **and** its audio-language list is
      non-empty — a release whose name advertises at least one of those languages (REQ-23) has its
      REQ-7 source rank raised by **one**, capped at the ceiling of its own source family:

      | Source family | Ranks | Ceiling |
      | :-- | :-- | :-- |
      | Remux | BluRay Remux (7), UHD BluRay Remux (8) | **8** |
      | Disc, non-remux | BluRay/BDRip (5), UHD BluRay (6) | **6** |
      | Web | HDRip (2), WEBRip (3), WEB-DL (4) | **4** |
      | Unrecognised | 0 | **0** — never promoted |

      A release already at its family's ceiling keeps its rank; the promotion is not lost, there was
      simply nowhere to go. Nothing else in the chain is touched, and no release is ever *demoted*
      for lacking the language.

      **The cap is the requirement, not an optimisation.** An uncapped `+1` would lift `WEB-DL` to
      `5` — `BluRay`'s rank — letting an advertised language buy a web source a place among disc
      sources. That is the additive trade § Why Not A Score rules out, reintroduced through a side
      door. Capping per family confines the promotion to the one question it is competent to answer:
      *among sources of the same kind, which one is likelier to carry the language the user
      requires.*

      When the requirement is **not armed** the rank is exactly REQ-7's, and the entire feature
      orders precisely as it did at `spec_version` 0.4.0 (AC-14).

- [x] **REQ-23 (Reading A Language Off A Release Name)** *(`0.5.0`)*: A release advertises a
      language when its name contains, as its own boundary-anchored token and case-insensitively,
      any tag mapped to that language. The mapping is a constant in `web` built from two sources:

      1. The `Language` record itself — its `iso3` (`spa`) and `iso2` (`es`).
      2. A hardcoded alias table for the spellings release names actually use, which no ISO code
         covers: `esp`, `castellano`, `cast`, `latino`, `lat` for Spanish, and equivalents added for
         other languages as real release names produce them.

      **Regional variants collapse into their language.** A user who marks Spanish mandatory is
      asking for Spanish; `castellano` and `latino` both satisfy it, and so does a bare `spa`. The
      ranking does not distinguish `es-ES` from `es-419` even though `039` stores the distinction —
      release names use the two spellings interchangeably and inconsistently, so treating them as
      different requirements would fail on the naming, not on the content. Choosing *between* the
      variants is a track-selection decision the worker makes at encode time, not a search-time one.

      **`MULTI` and `DUAL` are not a match**, for any language. They assert that more than one track
      exists without saying which, so reading them as a hit would promote releases that may not
      carry the required language at all — precisely the false positive REQ-22 must not manufacture.
      They stay unrecognised until someone has a rule that makes them mean something specific.

      The same boundary discipline as REQ-5 and REQ-7 applies, and matters more here because the
      tokens are short: an unanchored `lat` matches `Translated` and `Latvian`, an unanchored `es`
      matches almost everything. Every tag is matched as a whole token or not at all.

- [x] **REQ-24 (Criterion 7 — Mandatory-Audio Tiebreak)** *(`0.5.0`)*: When the requirement is
      armed, a candidate that advertises the language ranks above one that does not, at position 7
      of the comparator (REQ-11) — after audio, before size. When it is not armed the criterion is
      inert and every candidate ties on it.

      This exists because REQ-22's cap means the promotion does nothing for a release already at its
      family ceiling: two `UHD BluRay Remux` releases, or two `WEB-DL`s, one advertising the
      language and one not, would otherwise be separated by size alone. It is placed **below** audio
      so it can never override a structural judgement, and **above** size so the language outweighs
      raw byte count between otherwise equal candidates.

      **Unlike codec (REQ-8) and audio (REQ-10), this criterion is *not* skipped between two disc
      sources.** Those two are skipped because a disc source implies them — a BluRay is HEVC and
      carries the disc's lossless track whether the name says so or not. A disc source implies
      nothing about which *languages* it carries: a US UHD disc may have no Spanish at all. Presence
      of the tag is therefore real information for a remux exactly as it is for a WEB-DL, and the
      skip would throw it away.

- [x] **REQ-25 (Where The Requirement Comes From)** *(`0.5.0`)*: The unit is handed the audio
      requirement of **the title being acquired**, not of the user in general:

      - For a film: `Movie.audioMandatory` and `Movie.audioLanguages`.
      - For an episode: the parent series' `Show.audioMandatory` and `Show.audioLanguages` — an
        episode has no language preference of its own (`039`).

      Both already resolve to *the calling user's* per-title choice (`039` REQ-3, REQ-8) and are
      already fetched by the movie and show detail queries, so this adds no query, field or request.

      **The user's general `/preferences` value is deliberately not consulted, and does not act as a
      fallback.** `039` REQ-9 fixed the three flags as independent, with no inheritance and no
      precedence order, and explicitly left it to "whichever rule eventually reads them" to decide
      how they combine. This is that rule, and it decides: for ranking a specific title, only that
      title's own flag counts. A per-title flag left off means the promotion is not armed, whatever
      the user's general preference says — which is what a checkbox with no "unset" state can
      honestly mean.

      `web` must thread the pair from the components that already hold it to the modal.
      `AcquisitionTarget`'s movie branch already carries the whole `Movie`; its **episode branch
      carries only `showTitle` and `seasonNumber`**, so the series' two fields have to reach it
      through `SeasonAccordion`. That is a `web`-internal type and prop change, not a contract one.

      When the flag is off, the list is empty, or the target is null, the unit behaves exactly as at
      `spec_version` 0.4.0. The requirement is an **option**, and its absence is the default path.

### Non-Functional & Operational Requirements

- [x] **NFR-1 (Nothing Persisted)**: Scores, tiers and the toggle state exist only for the lifetime
      of the open modal. Nothing is written to a database, a setting, a cookie or local storage,
      and nothing appears in any GraphQL request or response.

- [x] **NFR-2 (No Network)**: Toggling issues no request of any kind. A user who toggles ten times
      causes zero traffic.

- [x] **NFR-3 (Total Result Under Missing Data)**: Every field read is nullable in the contract. A
      null `title`, a null `size` or a zero swarm must yield a result, never an exception: an
      unparseable release lands in tier 0 with whatever its recognised parts are worth.

- [x] **NFR-4 (Degenerate Lists)**: A single-result list, a list where every size is null, a list
      where every release is vetoed, and a list where every candidate ties on all ten comparator
      keys must all resolve without throwing and without reordering rows arbitrarily — the last
      case is what makes the stable sort of REQ-11 a requirement rather than an implementation
      detail.

- [x] **NFR-5 (The Requirement Is Optional)** *(`0.5.0`)*: The unit must remain callable with no
      language requirement at all, and must produce the `spec_version` 0.4.0 ordering when called
      that way. A caller that has no target — the eventual automatic picker running over a list it
      was handed, a future season-pack entry point — must not be forced to synthesise an empty
      requirement to use the unit. A null, absent or unarmed requirement is a supported input, not
      an error.

- [x] **NFR-6 (No New Data Crosses The Boundary)** *(`0.5.0`)*: The two fields REQ-25 reads are
      already fetched by the movie and show detail queries. No query document gains a field, no new
      request is issued when the modal opens or the toggle is pressed, and the requirement is never
      sent anywhere — NFR-1 and NFR-2 hold unchanged.

## GraphQL Contract Delta

**None — this feature does not cross the service boundary.**

`searchTorrents` already returns every field the heuristic reads (`title`, `size`, `seeders`,
`leechers`), the selection is derived in the browser from the list already in memory, and nothing
about it is sent back to `api`. No query, mutation, type, field or error condition changes.

**Still none at `spec_version` 0.5.0.** REQ-25 reads `Movie.audioMandatory`/`Movie.audioLanguages`
and their `Show` counterparts, all four of which `039-per-title-language-split` already added to the
schema *and* which `web`'s existing `GetMovie`/`GetShow` query documents already select
(`services/web/src/actions/movies.ts`, `services/web/src/actions/shows.ts`). The amendment spends
data `web` has already fetched by the time the modal opens; it adds no field to any query document,
issues no request, and sends nothing to `api`. If an implementer finds themselves editing a query
document or anything under `services/api/`, they have left scope and must stop and report.

## Data Model Changes

**None.** No Prisma model, field, enum or migration is touched.

## Acceptance Criteria

- [x] **AC-1**: Given a search for a film that returns a mixed list, when "Buscar" completes, the
      table is in the API's original size-descending order, no parsed-attribute labels are shown,
      and the button is enabled.

- [x] **AC-2** (selection): Given a list containing exactly one 2160p release — a WEB-DL x264 with
      few seeders — alongside many 1080p Blu-ray remux HEVC releases from preferred groups, when
      the button is pressed, the table shows **that one release and nothing else**. No new request
      appears in the browser network panel.

- [x] **AC-3** (ordering within the set): Given a list whose highest tier is 1080p, when the button
      is pressed, every row is 1080p, a preferred-group release is row 1 whatever its source, and
      each row shows its parsed resolution/group/source/codec/range/audio.

- [x] **AC-3a** (lexicographic dominance): Given two 2160p releases from unknown groups — one a
      BluRay Remux of 1 byte with 1 seeder, one a WEB-DL of 999 GB with 99 999 seeders — when the
      button is pressed, the **remux is row 1**. No margin on size or seeders promotes a lower
      source past a higher one.

- [x] **AC-4** (veto): Given a list whose only 2160p release is AV1, when the button is pressed,
      that release is absent and the candidate set is drawn from the next tier down — the AV1
      release does not set the tier and then leave the set empty.

- [x] **AC-4a** (dead-swarm veto): Given a list containing the best-ranked release at 0 seeders and
      2 leechers, when the button is pressed, that release is absent and the next-best one leads.
      Given the same release at 0 seeders and 9 leechers, it is present and leads — the threshold,
      not the mere absence of seeders, is what removes it.

- [x] **AC-4b** (disc sources ignore codec and audio): Given two 2160p UHD BluRay Remux releases
      identical but for one naming `HEVC TrueHD Atmos` and the other naming neither, when the
      button is pressed the **larger** of the two leads — the terse title is not punished for
      being terse. Given the same pair as WEB-DLs, the one naming HEVC and Atmos leads instead.

- [ ] **AC-4c** (upscale veto, pending): Given a list whose only 2160p release is tagged
      `Upscaled` or `AI Upscale`, when the button is pressed, that release is absent and the
      candidate set is drawn from the next tier down — same shape as AC-4, different trigger.

- [x] **AC-5** (nothing is lost): Given the candidate view is active, when the button is pressed
      again, the table is byte-identical to AC-1 — every hidden release back, in its original
      position, with no parsed-attribute labels.

- [ ] **AC-6** (failure path): Given a result list in which **every** release is AV1 or VP9, when
      the button is pressed, the table shows the empty-candidate message from REQ-17 — not the
      "no results" copy — no error reaches the console, and pressing again restores all of them.

- [x] **AC-7** (failure path): Given a result list in which every `title` is null and every `size`
      is null, when the button is pressed, the table renders with no console error, every release
      still present (all tier 0, none vetoed), in their original relative order.

- [x] **AC-8** (failure path): Given a search that returns zero results or is still running, the
      button is visibly disabled and pressing it does nothing.

- [x] **AC-9**: Given the candidate view is active, when the user types `x265` into the filter,
      only matching candidates remain and they stay in comparator order; clearing the filter
      restores the full candidate view.

- [x] **AC-10**: Given the candidate view is active, when the user runs a second "Buscar", the new
      list renders in the API's original order with the toggle back in its default state.

- [x] **AC-11**: `bin/npm web run build` exits 0 and `grep -rn "Ordenar" services/web/src` returns
      nothing — the copy lives in `messages/es.json`.

- [x] **AC-12** *(`0.5.0`, the promotion)*: Given a film with *Audio mandatory* on and Spanish in
      its audio languages, and a candidate set of five 2160p releases — four `UHD BluRay Remux`
      (43, 43, 42, 41 GB) naming no language, and one 54 GB `BluRay Remux` whose name lists
      `… Por Spa Cze …` — when the button is pressed, the **54 GB release is row 1**. Turning the
      checkbox off and re-opening the modal puts it back in **row 5**.

- [x] **AC-13** *(`0.5.0`, the family cap)*: Given the same film and a candidate set holding a
      `WEB-DL` naming `Latino` and a `BluRay` naming no language, when the button is pressed the
      **BluRay leads**. The promotion must not lift a web source to or past any disc source, at any
      size or seeder count.

- [x] **AC-14** *(`0.5.0`, inert by default)*: Given a film with *Audio mandatory* **off**, when
      the button is pressed, the ordering is identical to the one the same list produced before this
      amendment — no promotion, no tiebreak, and no language chip on any row. The same holds for a
      film with the flag on but an empty audio-language list.

- [x] **AC-15** *(`0.5.0`, regional variants)*: Given Spanish marked mandatory, three otherwise
      identical `WEB-DL` releases naming `SPA`, `Castellano` and `Latino` respectively each rank
      above a fourth naming none — all three spellings satisfy the requirement (REQ-23).

- [x] **AC-16** *(`0.5.0`, no false positives)*: Given Spanish marked mandatory, a release named
      `… MULTi …` and a release named `… DUAL …` are **not** treated as advertising Spanish, and a
      release named `… Translated …` or `… Latvian …` is not matched by the `lat` alias.

- [x] **AC-17** *(`0.5.0`, the tiebreak)*: Given Spanish marked mandatory and two `UHD BluRay
      Remux` releases identical in every criterion except that the **smaller** one names `SPA`, when
      the button is pressed the smaller one leads — both are at the family ceiling, so REQ-24
      decides, and it outranks size.

- [ ] **AC-18** *(`0.5.0`, the episode path)*: Given a series with *Audio mandatory* on and Spanish
      in its audio languages, when the torrent modal is opened for one of its episodes and the
      button is pressed, an episode release naming `SPA` is promoted the same way a film's is — the
      series' preference reaches the modal (REQ-25).

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

- **Making the criteria configurable.** The order of the chain, the ranks inside each criterion,
  the preferred-group list and the streaming-service list are all constants in `web`. Watching
  them against real searches is exactly what this feature is for; moving them into Settings is
  worth doing once they have earned it.

- **Ranking the streaming services against each other.** REQ-7 recognises `AMZN`/`DSNP`/`ATVP` and
  friends only to identify a WEB-DL; it does not prefer one service over another. Whether an AMZN
  WEB-DL beats a DSNP one is a real question with a real answer, and it becomes a sub-criterion
  under source when there is a table to encode.

- **Series and season packs.** The button ships on the movie detail page's modal because that is
  where it will be exercised. The modal is shared with the episode path, so it appears there too;
  the season-pack path (`addMagnetToSeason`, api-only, no web UI) is untouched.

- **`getScore` in `services/api/src/clients/indexer/score.ts`.** That function scores source, audio
  and penalties on the `api` side and is currently dead — only `filterIAData` calls it, and nothing
  calls `filterIAData`. Note its commented-out `getResolutionScore` treated resolution as 30 points
  among others, which is exactly the model REQ-3 rejects. This feature neither uses nor deletes it.
  When the automatic pick moves this logic to `api`, that is the code it should replace.

- **Handling bad rips (`CAM`, `TS`, `TELESYNC`, `SCREENER`) and specific groups (`YTS`, `RARBG`).**
  Only the AV1/VP9 veto (and, pending, the upscale veto — REQ-4b) removes; nothing else does. An
  unrecognised source ranks last under REQ-7,
  which is a weak defence — and note a `CAM` tagged `1080p` not only survives but can *define* the
  tier, evicting every legitimate 720p release from the candidate set. REQ-3 makes this sharper
  than it was under a pure ordering, and it is the first thing to watch for in the manual pass.

  The eventual fix is a **"permitir cine" checkbox**, off by default, which is a user preference
  with its own detection list, its own i18n keys and its own persistence question — not a weight,
  and not something to fold into this button. Until it ships, the human reading the candidate view
  is the filter.

- **Enforcing "mandatory" anywhere but the ranking** *(`0.5.0`)*. REQ-22 promotes; it never vetoes,
  and a release that does not advertise the language is still perfectly eligible to be picked and
  downloaded. `039`'s question — what the flag should do to *track selection*, whether an encode
  should fail when no audio track matches the way `011` REQ-6 already does for the original
  language — is untouched and still open. That decision belongs where the tracks are visible, in
  the worker after `ffprobe`, and this amendment neither makes it nor forecloses it.

- **Subtitle languages** *(`0.5.0`)*. `039` split the preference in two; only the audio half is read
  here, and only because the *Audio mandatory* flag exists to arm it. There is no subtitle-mandatory
  flag, and a subtitle track is trivially addable after the fact in a way an audio track is not, so
  it is a much weaker signal about the source.

- **The user's general audio preference** *(`0.5.0`)*. REQ-25 reads only the per-title flag. Making
  `/preferences`'s value a fallback for titles that never set one is a coherent alternative design;
  it is also exactly the inheritance `039` REQ-9 refused to define, and it should be decided
  deliberately rather than acquired here as a convenience.

- **Ranking the languages against each other** *(`0.5.0`)*. A title with three mandatory audio
  languages treats a release advertising one of them the same as a release advertising all three.
  Counting matches, or ordering the requested languages by priority, is another rung on REQ-24 and
  needs a rule about what "mandatory" means when only some are satisfied.

- **Channel layout.** REQ-10 reads the audio *codec* (`TrueHD`, `Atmos`, `DTS-HD MA`, `DDP`) but
  not the channel count — `7.1`, `5.1` and `2.0` rank identically. Adding it is another rung on an
  existing criterion, not a restructure.

## Post-Implementation Amendments (2026-09-05)

One follow-up requirement recorded ahead of implementation — flagged during a debug session on the
movie detail page, once the language/group fallback (`spec_version` unrelated to this one) made the
candidate set actually match what a user would search with. Not yet implemented; tracked here so
`/tasks` has an approved requirement to dispatch against rather than a chat message.

- **REQ-4b (Upscale Veto), AC-4c.** Some indexer results advertise themselves as `Upscaled` or
  `AI Upscale` — a release whose reported resolution was never actually captured at that
  resolution, only interpolated up to it after the fact. Ranking these as genuine high-resolution
  sources is worse than ranking them last: under REQ-3's tier pass, a fake 2160p release can *evict*
  every honest 1080p candidate from the set entirely, not just lose a tiebreak to one. This is the
  same failure mode REQ-4 (AV1/VP9) and REQ-4a (dead swarm) already exist to prevent, so the fix is
  the same shape — a third pass-1 veto, not a new comparator criterion. See `web/plan.md`'s
  amendments table for the implementation detail once it lands.
