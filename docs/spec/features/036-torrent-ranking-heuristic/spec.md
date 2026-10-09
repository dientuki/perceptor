---
title: Torrent Ranking Heuristic
spec_version: 0.9.0
author: Juan "Dientuki" Farias
created_at: 2026-08-31
last_updated: 2026-09-27
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

      *Read `api` for `web` from `073` on.* The unit shipped in `web` and moved to
      `services/api/src/indexer/ranking.ts` under `073-automatic-episode-acquisition`; its second
      and third callers are the `acquire_episodes` and `acquire_movies` sweeps, not a component. The
      requirement is met, in `api` — see § Post-Implementation Amendments, "Where the code is".

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

- [x] **REQ-4b (Upscale Veto)** *(see § Post-Implementation Amendments)*: A release whose
      name identifies it as an upscale — `upscaled`, `ai upscale`/`ai-upscale`/`aiupscale`,
      `upscale` — is discarded in pass 1 alongside REQ-4 and REQ-4a, whatever resolution it claims.

      An upscaled release did not originate at the resolution it advertises — the extra pixels are
      synthesized, not sourced — so a "2160p" upscale is worse evidence of quality than an honest
      1080p release, exactly the inversion REQ-3's tier pass exists to prevent for AV1/VP9. Like
      REQ-4/REQ-4a this runs before the tier pass, so an upscaled 2160p release cannot set the tier
      and evict every genuine 1080p one.

- [x] **REQ-4c (Cinema-Capture Veto)** *(`0.7.0`, see § Post-Implementation Amendments)*: When the
      caller's `UserPreferences.allowCinemaReleases` is **false**, a release whose name identifies
      it as captured in a cinema — `CAM`, `HDCAM`, `CAMRIP`, `TS`, `HDTS`, `TELESYNC`, `TC`,
      `TELECINE`, `SCR`, `SCREENER`, `DVDSCR`, `BDSCR`, `DCP`, `DCPRIP`, `WP`/`WORKPRINT` — is
      discarded in pass 1 alongside REQ-4, REQ-4a and REQ-4b, whatever resolution it claims. When
      the flag is **true** the veto does not run and the ranking is byte-identical to `0.6.0`.

      This is the checkbox the `0.4.0` Out of Scope section deferred, now that the preference it
      needs exists end to end (`021-user-preferences`: `User.allowCinemaReleases`, default `false`,
      the `preferences` query, the `setAllowCinemaReleases` mutation and the Movies tab switch are
      all already shipped and, until this requirement, write-only). Nothing about the storage, the
      contract or the UI changes here — only who reads the value.

      **It is a veto and not a demotion for the same reason REQ-4b is.** A cinema capture is not a
      lower-quality *encode* of the source, it is a different source: a camera pointed at a screen,
      or a distribution master never meant for viewing. Under REQ-3's tier pass a `CAM` tagged
      `1080p` does not merely lose a tiebreak, it *sets the tier* and evicts every honest 720p
      release from the candidate set — the failure mode the `0.4.0` spec flagged as "the first
      thing to watch for in the manual pass", observed in real result lists ever since.

      **The detection list is matched as boundary-anchored tokens**, the same
      `(?<![\dA-Za-z])…(?![\dA-Za-z])` discipline REQ-5/REQ-7/REQ-4b already use, and it matters
      more here than anywhere else in the file: these are the shortest tokens the heuristic has.
      An unanchored `ts` matches `Ghosts`, `Nights` and the `TS` in `DTS`; an unanchored `tc`
      matches `Catch`; an unanchored `cam` matches `Camelot`. A false positive here does not
      reorder a release, it **removes** it, so every token in the list must be provably
      unambiguous or it does not ship. `DTS`/`DTS-HD` in particular is an audio codec REQ-10
      already ranks and must never be read as a telesync.

      **Scope: films only.** The veto runs when the modal's target is a movie. An episode or
      season-pack search ranks exactly as it does today, whatever the flag says — the switch lives
      in the Movies panel of `/preferences` and means what it says there. Widening it to series is
      a separate decision with its own UI move, not an implementation detail.

      **When the flag is not known, the veto runs.** Unlike REQ-22's language requirement and
      REQ-6's preferred groups — both of which degrade to inert, because both only *order* — an
      inert veto changes what the user sees, so an unknown flag resolves to the column's own
      default (`false`, veto on) rather than to today's behaviour.

      *Implemented in `api`, where that case cannot arise.* This paragraph was written for a `web`
      unit that fetched `preferences` per mount and held `null` until they arrived. Since `073`
      moved the heuristic, `RankingContextService.forCaller` reads the flag from the database before
      ranking anything, so there is no unknown window: a film target passes the caller's own column,
      every other target passes `true` — which is the scope clause above, not this fallback — and
      the `acquire_movies` sweep passes the **AND** over the film's owners (`forMovieOwners`, `076`
      REQ-7). The rule stands as written for any future caller that cannot read the column.

- [x] **REQ-4d (4K AVC Veto)** *(`0.9.0`, see § Post-Implementation Amendments)*: A release whose
      resolution tier is 5 (REQ-5) **and** whose name identifies it as `avc`/`x264`/`h264` (REQ-8's
      regexes, unchanged) is discarded in pass 1 alongside REQ-4, REQ-4a and REQ-4b. It is the only
      veto in the list that is conditional on another parsed value rather than on a token alone.

      No 4K source is delivered in H.264. UHD BluRay mandates HEVC Main 10; no streaming service
      ships 2160p in AVC; H.264 at 2160p is legal in the standard (High profile, Level 5.1/5.2) and
      is a bitrate no group pays. A release that says both `2160p` and `x264` is therefore one of
      three things — an upscale of a 1080p AVC, an AVC re-encode of the UHD disc, or a mislabelled
      name — and the first two are exactly what this heuristic exists to avoid handing to the
      encoder. Unlike REQ-4b's upscales, such a release is often **large**: the one in the reference
      set is 44.5 GB, which is what carried it past every size tiebreak in `0.1.0`–`0.8.1`.

      **It is a veto and not a demotion** because a rank cannot reach it. REQ-11 skips criterion 4
      between two disc sources at tier 5, and the release this rule is aimed at is a
      `2160p BluRay x264`: its codec rank was never compared, at any value the table gave it. That
      is the measured reason `0.8.1` moved nothing (§ Post-Implementation Amendments, 2026-09-27) —
      a rank-based answer to this is unreachable, not merely weak.

      **It cannot empty the candidate set.** Like the other three it runs before the tier pass, so a
      film whose only 2160p releases are AVC falls back to its 1080p set rather than returning
      nothing — REQ-3's pass order is what makes this safe, and AC-27 is the direct check.

      The cost is a **mislabelled name**: a release that writes `x264` over a file that is really
      HEVC is removed rather than sunk, and removal is silent. This is the same trade REQ-4b already
      accepts for a title that writes `Upscaled` over an honest 2160p master, and it is accepted for
      the same reason — the tokens are unambiguous under the boundary-anchored matching REQ-4c
      describes, and a release that lies about its codec in its own name is not a source worth
      defending.

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

- [x] **REQ-7 (Criterion 3 — Source)** *(the ladder below is implemented and correct; **had been
      unticked for REQ-7b alone**, which changes how UHD-ness is *decided* without moving a single
      rung — REQ-7b is now implemented too, T030/T031, see
      § Post-Implementation Amendments (2026-09-27, second pass))*: Highest match wins: UHD BluRay Remux → 8, BluRay Remux → 7,
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

      *Since `0.9.0`'s second pass, "UHD" in that paragraph means **REQ-7b's** reading of it — the
      resolution tier — not the literal token. The split and the ladder are unchanged; only the
      question "is this a UHD disc?" is answered from a different field.*

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

- [x] **REQ-7b (UHD-ness Is Read From The Tier, Not The Title)** *(`0.9.0`, second pass — see
      § Post-Implementation Amendments)*: Whether a disc source counts as **UHD** for REQ-7's ladder
      is decided by the release's own resolution tier (REQ-5), **not** by the presence of a `uhd`
      token in its name. A disc source at tier 5 is a UHD one — `UHD BluRay Remux` (8) if it is a
      remux, `UHD BluRay` (6) if it is not. A disc source below tier 5 is not, whatever its name
      claims.

      **The token is not consulted at all.** This replaces the previous test rather than widening it,
      and that is deliberate: the old test was wrong in both directions, and only replacing it fixes
      both.

      | Release | Tier | Before | After |
      | :-- | :-- | :-- | :-- |
      | `…2160p.PROPER.IMAX.REMUX.DV.HDR10+.TrueHD…` | 5 | 7 `BluRay Remux` | **8 `UHD BluRay Remux`** |
      | `…(2014) UHD BDRemux 2160p 4K, HDR10…` | 5 | 8 | 8 — unchanged |
      | `…IMAX Hybrid 1080p UHD BluRay DD+5.1 DV HDR x265…` | 4 | 6 `UHD BluRay` | **5 `BluRay`** |
      | `…UHD BDRip-HEVC 1080p от RIPS CLUB \| HDR…` | 4 | 6 | **5** |

      **Why the tier is the authority.** A remux is the disc's own stream copied out bit for bit.
      There is no medium other than a UHD Blu-ray that carries a 2160p stream, so at tier 5
      `UHD BluRay Remux` and `BluRay Remux` do not name two qualities — they name the same object,
      and the only thing separating them is whether whoever wrote the release name bothered with
      three letters. Symmetrically, a 1080p release is not a UHD disc no matter how prominently its
      name says `UHD`: those are downscales and hybrids, and rank 6 flatters them over an honest
      1080p remux.

      **Found in production, not by reading.** The 4K IMAX remux of *Interstellar* — 97.85 GB, 1082
      seeders, the release a person would obviously pick — placed **#11 of 56 candidates** on
      `ptor.local`, behind a peer with **8 seeders**, purely for not writing `UHD`. Nothing else
      could rescue it: REQ-8's codec is skipped at tier 5 between disc sources (REQ-11), REQ-10's
      audio is skipped between disc sources, dynamic range tied, and so the decision fell to size at
      a 0.3% margin. Seeders are criterion 9 and were never reached. Measured against the 475 rows
      that search actually returned, this requirement alone moves that release to **#1** and changes
      `sourceRank` on 28 rows — 24 up, 4 down, the four being exactly the 1080p rows above.

      **It resizes no candidate set.** UHD-ness feeds only the source rank, which is criterion 3 of
      the comparator. It is not a veto, it is not the resolution tier, and it therefore cannot admit
      or remove a candidate — the same 56 rows are candidates before and after. AC-31 is the
      assertion that pins this, because a change that silently emptied or widened the set would be a
      far worse bug than the one it fixes.

      **What this deliberately does not do.** It does not read `IMAX`, and no requirement in this
      feature does. Six of the seven top rows of that search advertise IMAX, so the token could not
      have broken the tie even if it were a criterion; IMAX is a framing and a cut, not a quality
      tier, and preferring an edition is per-user, per-title work this feature rules out
      (§ Out of Scope, and `docs/constitution.md`'s position on quality profiles). The release that
      wins here wins on seeders and size, and that it is the IMAX one is a coincidence worth naming
      precisely so nobody later mistakes it for evidence that the token is read.

- [x] **REQ-8 (Criterion 4 — Codec)** *(amended in `0.8.0`, corrected in `0.8.1`, superseded at
      tier 5 by `0.9.0`, see § Post-Implementation Amendments; had been unticked for one row only —
      `0.8.0`'s two tables were **on disk and tested** in `ranking.ts`/`ranking.spec.ts`, shipped in
      `de41706` on 2026-09-26 in the same commit that wrote the amendment, which is why the box was
      left unticked. `0.9.0`'s tier-5 row — an unrecognised codec at tier 5 now inferred `HEVC` rank
      3, not `—` rank 0 — is implemented too, 2026-09-28, T027/T028. `0.8.1`'s `avc` 1 / unrecognised
      2 was never written and never will be)*: The
      codec rank **depends on the resolution tier** (REQ-5), because what a codec says about *a
      source to recompress* is not the same at 4K as below it:

      | Tier | `hevc`/`x265`/`h265` | `avc`/`x264`/`h264` | unrecognised — `xvid`, `divx`, `mpeg2`, `vc-1`, or no codec named |
      | :-- | :-- | :-- | :-- |
      | 5 (4K / 2160p) | 3, label `HEVC` | **vetoed in pass 1 (REQ-4d)** | **3, label `HEVC`** — inferred |
      | 4 and below, and tier 0 | 1 | **3** | 2 |

      **Tier 5 holds exactly one codec** *(`0.9.0`)*. Every 4K release that reaches criterion 4 is
      HEVC: an explicit one was read as such, an AVC one was removed by REQ-4d, an `av1`/`vp9` one by
      REQ-4, and one naming nothing is HEVC as a matter of what 4K sources are. So the criterion is
      **inert at tier 5** — it compares two equal values and falls through to dynamic range — and
      the tier-5 row of the table is a statement about the *label*, not about an ordering. Below 4K
      nothing changes: three values, three ranks, and the criterion decides as `0.8.0` wrote it.

      The inference is sound **only because REQ-4 runs first**. "A 4K release that names no codec is
      HEVC" is false of 2160p AV1 and VP9, which do exist; they are vetoed in pass 1 before any
      label is read. Moving REQ-4 after this point would make the heuristic report AV1 releases as
      HEVC — the dependency is load-bearing and is why REQ-4d is written as a veto beside REQ-4
      rather than as a branch inside this criterion.

      `av1` and `vp9` never reach this criterion — REQ-4 removed them. The separator inside
      `h265`/`h264` is optional: `H 265` and `H.265` are as common as `H265` in real release names.
      Below 4K the **labels** (`HEVC`, `AVC`, unrecognised) are the parse and nothing else, so a
      row's chip under REQ-14 reads as what the name said and never as the placement. **At tier 5
      the unrecognised label is an inference** (`0.9.0`) — the one place in this feature where a chip
      states a fact the title does not — which REQ-14 records as a deliberate exception rather than
      leaving it to be discovered from a chip that disagrees with its own row.

      *Amended in `spec_version` 0.8.0.* Until then the ranks were `hevc` 3 / `avc` 2 /
      unrecognised 0 at **every** tier, which is a *playback* preference — the one thing this
      feature is not choosing. Perceptor recompresses the release to AV1, so the question a codec
      answers here is how much information the source carries into that encode. A 1080p `x265` has
      already discarded detail an `x264` of the same release keeps, and is the smaller file for
      exactly that reason; re-encoding it yields a worse AV1 than re-encoding the `x264` would. At
      4K HEVC still leads, and not as an exception: a UHD source **is** HEVC, and a 2160p `x264` is
      a re-encode of one — or an upscale of a 1080p AVC, which REQ-4b already vetoes.

      **An unrecognised codec sits between the two at every tier, never last** *(corrected in
      `0.8.1`)*. A release naming no codec is the tier's own codec in practice — H264 at 1080p,
      HEVC at 2160p — so ranking it under the tier's *other* codec would invert the rule this
      amendment exists to state. It loses only to a release that names the tier's codec explicitly:
      the same guess, with evidence behind it. The two rows are therefore mirror images, and
      `0.8.1` is what makes them so: `0.8.0` left tier 5 reading `hevc` 3 / `avc` 2 /
      unrecognised 0, which put a `2160p x264` — a codec no 4K source is ever delivered in, since
      UHD BluRay mandates HEVC and no streaming service ships 4K AVC — **above** an untagged
      release that is HEVC.

      *Superseded at tier 5 in `spec_version` 0.9.0, before either was implemented.* `0.8.1` was
      measured against a real 456-release set and reordered **nothing** (§ Post-Implementation
      Amendments, 2026-09-27): the only AVC row at tier 5 was a disc, where REQ-11 skips this
      criterion entirely. `0.9.0` acts on the same premise where it can act — REQ-4d removes the row,
      and the inferred label makes the chip stop understating what the file is. `0.8.1`'s tier-5
      numbers are kept in this paragraph as the record of a correction that was right and
      insufficient; the sub-4K row it did not touch is still the live rule.

      **Not compared between two disc sources — at tier 5 only** (REQ-11). A UHD BluRay is HEVC
      whether or not the release name says so, so at 4K a title that omits the codec is missing
      *information*, not quality, and comparing on it would rank a verbose title above an identical
      terse one for being verbose. Below 4K that argument reverses with the fact behind it: a disc
      is AVC by definition there, so an explicit `x265` on a 1080p BluRay records that a group
      re-encoded it — information, not verbosity. The skip is also why tier 5's `avc` rank is
      reached far less often than its table suggests: between two discs it never runs at all, so
      what `0.8.1` actually reorders is a `2160p WEB-DL x264` against an untagged `2160p WEB-DL`.
      Before `0.8.0` the skip applied at every tier, so
      `1080p BluRay x265` and `1080p BluRay x264` tied on codec and settled on **size**, where the
      x265 wins precisely because it threw data away. This cannot let an AV1 or VP9 rip through at
      any tier: REQ-4 vetoes those in pass 1, before any source is looked at.

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

      **Not compared between two disc sources** (REQ-11), for the reason REQ-8 gives at tier 5: a
      BluRay or remux carries the disc's lossless track whether or not the name mentions it. Audio
      still decides between two web sources, where the release name is the only evidence there is.

      *Unlike REQ-8's since `spec_version` 0.8.0, this skip is **not** tier-conditional.* It holds
      at every tier, because the fact under it does — a 1080p disc carries its lossless track the
      same way a UHD one does. Only the codec argument reversed below 4K, and only because a disc's
      codec, unlike its audio, is a different codec below 4K than above it.

- [x] **REQ-11 (The Comparator)**: Candidates are ordered by comparing, in this exact sequence and
      stopping at the first difference:

      | # | Criterion | Direction |
      | :-- | :-- | :-- |
      | 1 | Resolution (REQ-5) | higher first |
      | 2 | Preferred group (REQ-6) | preferred first |
      | 3 | Source (REQ-7), **UHD-ness per REQ-7b**, **as adjusted by REQ-22** — the adjustment is inert for a disc source at tier 5, see REQ-22 | higher first |
      | 4 | Codec (REQ-8) | higher first, **on the tier's own table** — skipped if both are disc sources **and the tier is 5**; since `0.9.0` **inert at tier 5** either way, since one codec survives there |
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

      *Amended in `spec_version` 0.8.0, and unimplemented — it lands with REQ-8, which is unticked
      for both of them.* Criterion 4 carries a second condition criterion 6 does
      not: its skip applies only at resolution tier 5 (REQ-8). The tier may be read off either
      candidate, for the reason disc-ness may — criterion 1 has already tied by the time row 4 is
      reached, and pass 2 left a single tier standing in any case.

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

      *Amended in `spec_version` 0.9.0 — one label is an inference.* At tier 5 a release that names
      no codec shows `HEVC` rather than `—` (REQ-8), which is the only chip in this feature that
      states something the title does not say. It is a deliberate exception to "each row shows how
      the heuristic parsed it", taken because the alternative misinforms: a 60 GB `UHD BDRemux` whose
      name omits the codec is not a release of unknown codec, and showing `—` invited exactly the
      reading that it might be the weaker one. The inference is shown **unmarked** — no `HEVC?`, no
      distinct styling — because a marked chip raises a question the row cannot answer, and because
      nothing downstream consumes it: the worker reads the real codec from `ffprobe` and never from
      a name (root `CLAUDE.md`, Transcode), so a wrong inference misinforms a reader for one screen
      and cannot reach an encode. Below 4K the chip remains the parse, `—` included.

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

      **Since REQ-7b, this promotion is inert for a disc source at tier 5 — accepted, not
      overlooked.** The families above are the `{7,8}` and `{5,6}` pairs, and those pairs *are* the
      non-UHD/UHD split; once the tier decides UHD-ness, every tier-5 remux starts at 8 and every
      tier-5 disc non-remux at 6, which are their ceilings, so there is nowhere to promote to. The
      preference is not lost — it stays criterion 7 of REQ-11, where it breaks ties on its own
      terms. What it stops doing is *disguising itself as a better source*: before REQ-7b, a tier-5
      remux that merely omitted `UHD` could buy the missing rung by advertising the user's language,
      which made a disc look like a better disc for a reason that has nothing to do with the disc.
      Below tier 5, and for every web source at any tier, the promotion is untouched — which is
      where a person who would take 720p Latin audio over 4K English is actually served.

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

**Verification status — 2026-10-09** (pass over 002–071 on `fix/tech-debt`, no code change)

Three of thirty-nine open — the best-verified spec in this band — and all three are already honest
about why. Re-checked this pass, with nothing to add to AC-4e or AC-6 beyond confirming their
reading: each has a proven ranking half (`api/src/indexer/ranking.spec.ts`, green in the 1000 api
tests measured this pass, including `'returns no candidates and throws nothing when every row is
vetoed'`) and an unrun `web` half — that the table shows REQ-17's empty-candidate message rather than
the "no results" copy. `web` has no test runner at all (`npm test` in that service exits with
`Missing script: "test"`, confirmed this pass), so there is no path to that half except a browser
with a session.

**AC-18** (the episode path, with *Audio mandatory* on and a Spanish preference) additionally needs a
real indexer search against a series. That is reachable on this installation — Prowlarr holds two
enabled indexers, checked 2026-10-09 — but still needs a signed-in user's token, since
`searchTorrents` carries no `@AllowService()` and the machine credential is refused at the guard.

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

      *Both halves are 2160p, and since `spec_version` 0.8.0 that matters: this criterion reads the
      tier-5 table and the tier-5 skip. The 1080p shapes are AC-21 and AC-23, and they resolve the
      other way.*

- [x] **AC-4c** (upscale veto): Given a list whose only 2160p release is tagged
      `Upscaled` or `AI Upscale`, when the button is pressed, that release is absent and the
      candidate set is drawn from the next tier down — same shape as AC-4, different trigger.

- [x] **AC-4d** (cinema veto, both states) *(`0.7.0`)*: Given a film whose result list holds five
      2160p releases of which three are tagged `CAM`, `HDTS` and `DVDSCR`, and the caller's
      *Allow cinema releases* switch is **off**, when the button is pressed the candidate set holds
      exactly the other two and the three captures are absent. Given the identical list with the
      switch **on**, all five are present and ordered exactly as `0.6.0` orders them.
      *Covered by `ranking.spec.ts`'s `'vetoes a cinema capture only when cinema releases are not allowed'`, and
      re-measured 2026-09-27 against the on-disk module with the five-row list this criterion
      describes: three absent with the flag off, five present with it on.*

- [ ] **AC-4e** (failure path — the veto empties the set): Given a film whose result list holds
      *only* cinema captures and the switch is **off**, when the button is pressed the table shows
      the empty-candidate message from REQ-17 — not the "no results" copy — no error reaches the
      console, and pressing the button again restores every release in its original order.
      *Left unticked: the ranking half is proven (`'returns no candidates and throws nothing when
      every row is vetoed'`), the `web` half — REQ-17's message rather than the "no results" copy —
      has never been run live. Same standing as AC-6, and for the same reason.*

- [x] **AC-4f** (failure path — no false positives): Given a result list containing
      `… 1080p BluRay DTS-HD MA 5.1 …`, `Ghosts.of.Mars.1080p.BluRay`, `Catch.Me.If.You.Can.1080p`
      and `Camelot.1080p.WEB-DL`, and the switch is **off**, when the button is pressed **all four**
      are present — `DTS`, `Ghosts`, `Catch` and `Camelot` are not cinema captures, and the
      boundary-anchored match is what proves it.
      *Measured 2026-09-27 against the on-disk module with exactly these four names and the flag
      off: all four survive. **No unit test guards this**, which is the one gap this normalization
      found rather than closed — the token list is exercised only through `HDCAM`. `tasks.md`'s T022b
      adds the case.*

- [x] **AC-4g** (scope): Given the switch is **off** and an episode search returns a release tagged
      `HDTS`, when the button is pressed that release is present — the veto is scoped to films.
      *Enforced in `ranking-context.service.ts`, not in the heuristic: `forCaller` passes
      `allowCinemaReleases: true` for a season, an episode and a null target, and the caller's own
      column only for `{ movieId }`. Covered by `ranking-context.service.spec.ts`'s `'applies the
      caller cinema preference only to a film target'`.*

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

- [x] **AC-19** *(`0.8.0`, below 4K AVC leads)*: Given a candidate set whose best tier is 1080p and
      two `WEB-DL` releases identical except for their codec, where the `x265` one is **larger**,
      the `x264` one leads. Size is criterion 8 and codec is criterion 4, so the smaller AVC
      release winning is the whole amendment in one assertion. *`ranking.spec.ts`'s
      `'prefers AVC over a larger HEVC between two 1080p web sources (AC-19)'`.*

- [x] **AC-20** *(`0.8.0`, superseded by `0.9.0`)*: Given the same shape at 2160p — two `WEB-DL`
      releases, the `x265` one **smaller** — the `x265` one leads. Since `0.9.0` it leads by being
      the only one left: its `x264` peer is vetoed by REQ-4d, so the assertion is that the candidate
      set holds one row, not that HEVC outranked AVC. The tier is still what decides which rule
      applied, which is why this criterion keeps its 1080p twin in AC-19.
      *A test of this name already exists and asserts the **superseded** `0.8.0` outcome —
      `ranking.spec.ts`'s `'still prefers a smaller HEVC over AVC between two 2160p web sources
      (AC-20)'`, green today, with the `x264` peer present and merely outranked. T028 rewrites it;
      it is not a missing test but a wrong one, once `0.9.0` lands.*

- [x] **AC-21** *(`0.8.0`, discs compare codec below 4K)*: Given two `1080p BluRay` releases
      identical except that the `x265` one is **larger**, the `x264` one leads. Before `0.8.0` both
      were disc sources, codec was skipped, and size handed it to the `x265`. *`ranking.spec.ts`'s
      `'compares codec between two 1080p disc sources, AVC leading a larger HEVC (AC-21)'`.*

- [x] **AC-22** *(`0.8.0`, discs still skip at 4K)*: Given two `2160p UHD BluRay Remux` releases
      where the **larger** names no codec and no audio and the smaller names `x265 TrueHD Atmos`,
      the larger one leads — criteria 4 and 6 are still skipped at tier 5, so size decides. Same
      assertion AC-4b makes, restated at the tier where it still applies. *Unchanged by `0.9.0`,
      which reaches the same outcome by a second route: the terse row is now labelled `HEVC` and ranks
      3, so criterion 4 ties even where it is not skipped. The assertion holds either way, which is
      why it is not rewritten.* *`ranking.spec.ts`'s `'skips codec and audio between two 4K disc
      sources (AC-22)'`.*

- [x] **AC-23** *(`0.8.0`, unrecognised in the middle)*: Given three `1080p BluRay` releases — one
      `x264`, one naming no codec, one `x265` — they order `x264`, untagged, `x265`, whatever their
      sizes. The untagged release beating the `x265` is the half of REQ-8 that does not follow from
      "prefer AVC". *`ranking.spec.ts`'s `'orders x264, untagged, x265 at 1080p BluRay whatever the
      sizes (AC-23)'`.*

- [x] **AC-24** *(`0.8.1`, rewritten by `0.9.0`)*: Given three `2160p WEB-DL` releases — one
      `x265`, one naming no codec, one `x264` — the `x264` one is **absent** (REQ-4d) and the other
      two are ordered by **size**, both showing the chip `HEVC`. This is what replaces `0.8.1`'s
      three-way ordering: at tier 5 the two survivors carry the same codec rank, so criterion 4
      cannot separate them and must not appear to. *No test of this name exists: `0.8.1`'s
      three-way tier-5 ordering was never written, which is the one thing that saved the work
      `0.9.0` would have thrown away. T028 writes it once, in its `0.9.0` form.*

- [x] **AC-25** *(`0.9.0`, the veto reaches what a rank could not)*: Given a candidate set whose best
      tier is 2160p and which contains a `2160p BluRay x264` release **larger** than every other
      disc release in the set, that release is absent from the candidate view. It is the case no
      ranking answer could reach: REQ-11 skips criterion 4 between two disc sources at tier 5, so
      before `0.9.0` this release placed on **size** whatever rank REQ-8 gave it.

- [x] **AC-26** *(`0.9.0`, the inferred label)*: Given a `2160p UHD BluRay Remux` release whose name
      names no codec, its codec chip reads `HEVC`, not `—`. Given a `1080p BluRay` release whose name
      names no codec, its codec chip still reads `—`. Both rows in one list, so the tier and not the
      parse is visibly what decides.

- [x] **AC-27** *(`0.9.0`, failure path — the veto cannot empty the set)*: Given a list whose only
      2160p releases all name `x264`, when the button is pressed the candidate set is **non-empty**
      and is drawn from the next tier down, with no 2160p row in it. Same shape as AC-4 and AC-4c,
      third trigger: REQ-4d runs before the tier pass, so removing every 4K row demotes the film's
      candidate tier instead of returning nothing.

- [x] **AC-28** *(`0.9.0`, the inference does not outlive its precondition)*: Given a
      `2160p WEB-DL AV1` release, it is absent from the candidate set (REQ-4, unchanged) and its
      codec chip is never rendered as `HEVC` anywhere in the view. The inference of REQ-8 is only
      sound downstream of REQ-4's veto, and this is the assertion that pins the order of the two.

- [x] **AC-29** *(`0.9.0` second pass, REQ-7b — the token is not required)*: Given two `2160p` remux
      releases identical but for the literal token — one named `… 2160p REMUX …`, the other
      `… UHD BDRemux 2160p …` — both report `sourceRank` 8 and the chip `UHD BluRay Remux`, and the
      larger of the two leads. Before REQ-7b the first reported 7 and placed behind the second
      whatever its size. This is the *Interstellar* defect reduced to two rows.

- [x] **AC-30** *(`0.9.0` second pass, REQ-7b — the token does not suffice either)*: Given a
      `1080p UHD BluRay … x265` release and a `1080p BluRay Remux` release, the remux leads and the
      first reports `sourceRank` 5 with the chip `BluRay`, not 6 and `UHD BluRay`. This is the
      failure direction: a name claiming a medium the resolution contradicts.

- [x] **AC-31** *(`0.9.0` second pass, failure path — REQ-7b resizes nothing)*: Given any list, the
      set of rows reported `candidate` is **identical** before and after REQ-7b, and so is the best
      resolution tier; only `candidateRank`, `sourceRank` and `sourceLabel` may differ. A source
      rank is criterion 3 of a comparator, never a veto and never the tier, so a change here that
      admitted or dropped a candidate would mean the rank had leaked into pass 1. Verified on the
      475-row *Interstellar* corpus: 56 candidates before, 56 after.

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

- **Handling specific groups (`YTS`, `RARBG`).** Bad rips are no longer here — REQ-4c
  (`0.7.0`) removes cinema captures when the caller's *Allow cinema releases* switch is off, which
  is the "permitir cine" checkbox this section deferred at `0.4.0`. Group reputation is still
  one-directional: REQ-6 *promotes* a preferred group and nothing demotes a distrusted one, so a
  `YTS` release still competes on its name alone. A distrust list is the mirror of REQ-6 and wants
  the same per-user storage `021` gave the preferred one.

- **Widening the cinema veto to series** *(`0.7.0`)*. REQ-4c runs for films only, because the
  switch lives in the Movies panel of `/preferences` and says so. A `HDTS` of a simulcast episode
  is a real thing; covering it means deciding whether the switch is per-media-type or global, and
  moving it in the UI accordingly.

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
candidate set actually match what a user would search with. Implemented 2026-09-19 (T017–T019).

- **REQ-4b (Upscale Veto), AC-4c.** Some indexer results advertise themselves as `Upscaled` or
  `AI Upscale` — a release whose reported resolution was never actually captured at that
  resolution, only interpolated up to it after the fact. Ranking these as genuine high-resolution
  sources is worse than ranking them last: under REQ-3's tier pass, a fake 2160p release can *evict*
  every honest 1080p candidate from the set entirely, not just lose a tiebreak to one. This is the
  same failure mode REQ-4 (AV1/VP9) and REQ-4a (dead swarm) already exist to prevent, so the fix is
  the same shape — a third pass-1 veto, not a new comparator criterion. See `web/plan.md`'s
  amendments table for the implementation detail.

## Post-Implementation Amendments (2026-09-25)

One follow-up requirement, recorded against a feature already `Implemented`. It adds no service,
no Prisma column, no GraphQL field and no i18n key — every one of those already shipped under
`021-user-preferences` — so by Article VII it is an amendment here rather than a feature of its
own. `services: [web]` is unchanged.

- **REQ-4c (Cinema-Capture Veto), AC-4d–AC-4g.** `User.allowCinemaReleases` has existed, been
  editable and been persisted since `021`, and has never been read by anything: the switch in the
  Movies tab of `/preferences` writes a column no code consults. REQ-4c is what makes it mean
  something, and the meaning is exactly the one the `0.4.0` Out of Scope section wrote down —
  off hides cinema captures, on is today's behaviour unchanged.

  It lands as a **fourth pass-1 veto beside REQ-4b**, not as a comparator criterion, for the
  reason REQ-4b did: the damage a `CAM` does under REQ-3 is not that it ranks too high but that it
  *sets the tier*, taking the whole honest candidate set with it. The two are the same shape —
  a boundary-anchored token match over the lowercased title, evaluated before the tier pass —
  and REQ-4b's list is deliberately the model for REQ-4c's. Whether they share one predicate or
  stay two is `/plan-feature`'s call; what the spec fixes is that they run in the same pass, under
  the same matching discipline, with the same removal semantics.

  The one genuinely new thing is that this veto is **conditional**, where the other three are
  unconditional. That is what forces REQ-4c to answer two questions the others never had to: what
  happens for a target that is not a film (nothing — films only), and what happens when the flag
  has not loaded (the veto runs, resolving to the column default rather than to today's
  behaviour). The films-only rule has AC-4g; the not-yet-loaded rule is asserted in REQ-4c with no
  acceptance criterion of its own, because it is a state the UI reaches only through a failed
  network call and not one a user can drive from outside the code. `web` has no test runner and
  this feature must not add one (`services/web/CLAUDE.md`), so the compensating control is the
  same one every other rule in this spec relies on: the offline harness in `web/plan.md` § Tests,
  driven with the flag absent.

## Post-Implementation Amendments (2026-09-26)

One correction to a requirement that has been implemented, and wrong, since `0.1.0`. It adds no
service, no Prisma column, no GraphQL field, no i18n key and no new criterion — REQ-8's numbers and
the scope of one skip in REQ-11 are the entire change — so by Article VII it is an amendment here
rather than a feature of its own.

**Where the code is.** `spec.md`'s `services: [web]` is historical and left as the record: the
heuristic moved to `api` under `073-automatic-episode-acquisition`, and this amendment is
implemented in `services/api/src/indexer/ranking.ts`, with tests in `ranking.spec.ts` — the test
runner `web/plan.md` § Tests recorded as missing, and named as the reason to move it, now exists on
the side that owns the code. `web` and `worker` are untouched.

- **REQ-8 (Codec, by tier), REQ-11 row 4, AC-19–AC-23.** REQ-8 ranked `hevc` above `avc` at every
  resolution, which reads as the obvious ordering and is the wrong one for this feature: § Context
  says in its second paragraph that Perceptor is choosing **a source to recompress**, not a file to
  watch, and REQ-8 then graded the codecs as if it were watching them. Below 4K the more
  informative source is the `x264` — bigger, and bigger *because* it kept detail the `x265`
  discarded — so it is the one that re-encodes to a better AV1. At 4K nothing changes, because
  there the fact is the other way round: the disc is HEVC and an AVC release of it is a re-encode.

  The second half of the correction is the **scope of REQ-11's skip**. REQ-8's reason for not
  comparing codec between two disc sources is a fact about 4K discs — they are HEVC, named or not.
  Below 4K a disc is AVC, named or not, so there an explicit `x265` is not a verbose spelling of
  the same thing, it is a record of a re-encode. The skip therefore narrows to tier 5. Left as it
  was, the common `1080p BluRay x265` / `1080p BluRay x264` pair tied through criteria 4, 5 and 6
  and was settled on size, which selects the x265 for having thrown data away — the exact inversion
  this amendment is here to remove.

  Two things were deliberately **not** done, both recorded as decisions rather than omissions.
  The chain is not reordered: source stays criterion 3 and codec stays 4, so a `1080p BluRay x265`
  still outranks a `1080p WEB-DL x264` — a re-encoded disc still carries more bitrate than a web
  stream. And the audio skip (REQ-10) stays unconditional, because the fact under *it* does not
  change with the tier.

## Post-Implementation Amendments (2026-09-27)

One correction to the amendment above, found before either was implemented. It changes one number
in one table and adds one acceptance criterion; no service, column, field, key or criterion.

- **REQ-8 tier 5 (`avc` 2 → 1, unrecognised 0 → 2), AC-20 wording, AC-24.** `0.8.0` rewrote the
  sub-4K row and left tier 5 as `0.1.0` wrote it, describing that as "nothing changes at 4K". Only
  half of tier 5 was right. HEVC leading was right; unrecognised sitting **last** was the same
  playback-era reflex `0.8.0` removed below 4K, and it contradicted `0.8.0`'s own text two
  paragraphs later — the disc-skip argument is that a UHD release omitting its codec *is* HEVC and
  is missing information rather than quality, which is an argument for ranking it second, not last.
  As written, a `2160p x264` outranked it, and there is no such source: UHD BluRay mandates HEVC
  (Main 10), no streaming service delivers 4K in AVC, and H.264 at 2160p, though legal in the
  standard, is a size no group pays. A release naming `x264` at 2160p is an upscale or a mislabel.

  The correction is stated as the **symmetry** it is: at every tier an unrecognised codec is that
  tier's own codec with no evidence, so it ranks second — behind the tier's codec named explicitly,
  ahead of the other one. `0.8.1` is the sub-4K rule applied to the row `0.8.0` did not revisit,
  not a new idea.

  Deliberately **not** done: `avc` at tier 5 is not a veto. "No 4K is AVC" invites removing the row
  outright, and pass 1 is where removals live (REQ-3, REQ-4b) — but a veto driven by a codec parse
  can empty the candidate set, which § Risks names as the failure this heuristic must never produce,
  and the upscales the rule is really aimed at are already vetoed by REQ-4b on their own tag. Rank
  1, so the row sinks and stays visible.

## Post-Implementation Amendments (2026-09-27, `spec_version` 0.9.0)

One requirement added, one superseded at a single tier, one invariant deliberately broken. No
service beyond `api`, no Prisma column, no GraphQL field, no i18n key, no pipeline stage — by
Article VII an amendment here rather than a feature of its own, the third of that kind against
`src/indexer/ranking.ts`. `web` renders `codecLabel` exactly as it does today; the string it
receives is what changes.

**This amendment was measured before it was written.** The 456 real Prowlarr results for *Shutter
Island* were re-ranked offline against three variants of the module, which is where three of the
statements below come from and why one of them retires an amendment written the same day.

- **REQ-4d (4K AVC Veto), REQ-8 at tier 5, REQ-14's inferred label, AC-20/AC-24 rewritten,
  AC-25–AC-28.** The premise is one sentence: no 4K source is delivered in H.264. `0.8.1` drew the
  weakest possible conclusion from it — rank a `2160p x264` last — and the measurement showed why
  that was not enough: **the ordering did not change by a single position.** The only tier-5 AVC
  release in the set was a `2160p BluRay x264`, and REQ-11 skips criterion 4 between two disc
  sources at tier 5, so its rank was never read. At 44.5 GB it then placed on size, ahead of 14
  honest HEVC releases of the same disc. A rank cannot reach that row; only a veto can.

  So `0.9.0` splits the premise into the two places it actually applies. **REQ-4d removes** the row
  in pass 1, beside the upscale and cinema vetoes it resembles — a 2160p AVC release is not a weaker
  encode of the source, it is a re-encode or an upscale of it, which is REQ-4b's argument verbatim.
  And **REQ-8 infers** at tier 5: with AV1/VP9 vetoed by REQ-4 and AVC by REQ-4d, a 4K release that
  names no codec is HEVC, so the chip says `HEVC` instead of `—`. Measured against the same set, the
  veto removes exactly one candidate of 49 and the inference relabels 11 chips, four rows shuffling
  among positions 44–48 where the criterion is actually reachable.

  The invariant this breaks is REQ-14's, and breaking it is the point. Until now a chip was the
  parse and nothing else. A 60 GB `UHD BDRemux … Dolby Vision Profile 8` whose name omits the codec
  is not a release of unknown codec, and a `—` there did not report ignorance, it implied a
  weakness the file does not have. The exception is confined to one criterion at one tier, shown
  unmarked, and is safe in the one way that matters: the worker reads the real codec from `ffprobe`
  and never from a name, so a wrong inference misinforms a reader and cannot reach an encode.

  Three things were deliberately **not** done. The inference is **not** extended below 4K — there a
  release naming no codec really is ambiguous, since 1080p HEVC is ordinary, and `0.8.0`'s rank of 2
  is already the whole answer. REQ-11's tier-5 skip is **not** removed: with one codec surviving at
  tier 5 the criterion is inert and the skip is redundant, and it is kept as the guard that holds if
  a fourth codec ever reaches 4K. Removing it was measured too — it moves 24 of 49 rows and drops
  the 60 GB remux from 1st to 5th behind 51 GB ones for not naming its codec, which is the failure
  the skip exists to prevent. And REQ-4d is **not** generalised into "veto a codec that disagrees
  with its tier": there is no such rule below 4K to state.

  What this costs, stated once: a release that writes `x264` over a file that is really HEVC is now
  removed rather than sunk, silently, and since `073`/`076` the same ranking feeds the automatic
  episode and movie sweeps — so such a release stops being **acquirable** unattended, not merely
  displayed. Accepted on the same terms as REQ-4b's upscale tokens, and bounded by AC-27: the veto
  runs before the tier pass, so it can demote a film's candidate tier but never empty its set.


## Checkbox Normalization (2026-09-27, no version bump)

This pass changed no rule. It made the checkboxes report the code, after a reading found REQ-8
unticked while `ranking.ts` already carried `0.8.0`'s numbers.

**The cause, so it stops recurring.** `de41706` ("update 036 spec", 2026-09-26) wrote the `0.8.0`
amendment *and* implemented it — `ranking.ts` and `ranking.spec.ts` are in that same commit. The
tasks and criteria the commit added were written as pending, then satisfied a few lines later in the
same diff and never ticked. The same happened to `0.7.0`'s cinema veto. Amending a spec and shipping
the amendment in one commit is the mechanism, and the fix is to tick in the commit that implements.

What is now ticked, and what each tick rests on:

| Item | Evidence |
| :-- | :-- |
| REQ-4c | `isCinemaCapture` + the `survivors` filter in `ranking.ts`; the flag resolved in `ranking-context.service.ts` |
| AC-4d, AC-19, AC-21, AC-22, AC-23 | a named unit test each in `ranking.spec.ts`, plus a re-measurement against the on-disk module |
| AC-4f | a measurement only — **no unit test**; `tasks.md` T022b adds one |
| AC-4g | `forCaller`'s per-target flag, and its test in `ranking-context.service.spec.ts` |

What stays unticked, and why:

- **REQ-8** — for one row. `0.8.0`'s two tables are implemented and tested; `0.9.0`'s tier-5
  unrecognised branch is not. `0.8.1` was never implemented and is superseded.
- **AC-20, AC-24** — their `0.9.0` form. AC-20's test exists and asserts the superseded `0.8.0`
  outcome, so T028 rewrites a green test rather than adding a missing one.
- **AC-25 … AC-28** — `0.9.0`, not implemented. Re-measured against the on-disk module to confirm
  they fail today for the stated reason: the 44.5 GB `2160p BluRay x264` is still a candidate, and a
  `2160p UHD BluRay Remux` naming no codec still reports the chip `—`.
- **AC-4e, AC-6** — each has a proven ranking half and an unrun `web` half (REQ-17's empty-candidate
  message). `web` has no test runner, which is why both wait on a live pass.
- **Group 4 (`0.5.0`), AC-18** — untouched here; already recorded in `tasks.md` § Blocked.

**Update, 2026-09-28: REQ-8's tier-5 row, AC-20, AC-24 … AC-31 and REQ-7/REQ-7b are now
implemented and ticked** (T027/T028/T030/T031, `tasks.md` Group 8) — the two bullets above about
them are left as the record of what this normalization pass found, not as the current state; see
§ Post-Implementation Amendments' opening note for the implementation itself.

**One correction of substance, not a tick.** REQ-4d had been inserted *inside* REQ-4c, leaving
REQ-4c's last two paragraphs ("Scope: films only", "When the flag is not known") reading as part of
REQ-4d, which has no flag and no film-only scope. The paragraphs are back under REQ-4c, and the
second is annotated: since `073` the flag is read from the database before ranking, so the unknown
window it describes cannot occur in `api`.

## Post-Implementation Amendments (2026-09-27, `spec_version` 0.9.0 — second pass)

**No version bump.** `0.9.0` had not been implemented yet at the time this section was written, so
this pass folded into it rather than opening a `0.10.0`: one amendment, one implementation, one
verification. Everything below landed with REQ-4d and REQ-8's tier-5 row in the same edit to
`ranking.ts` — **done 2026-09-28**, T027/T028/T030/T031 (`tasks.md`), all of REQ-4d, REQ-8's tier-5
row and REQ-7b implemented and tested together, 56/56 `src/indexer` tests green. The narrative below
is left exactly as written at the time (before implementation), as the record of how the defect was
found and why the fix takes the shape it does.

- **REQ-7b (new), REQ-7 unticked, REQ-11 row 3, REQ-22, AC-29 … AC-31.** `source()` decided UHD-ness
  by testing the title for a `uhd` token. It now reads the resolution tier. The ladder, the families
  and every rung are unchanged.

**How it was found.** Not by reading the code — by a live pass on `ptor.local` against *Interstellar*
(503 results, 56 candidates). The obvious release, a 4K IMAX remux at 97.85 GB with 1082 seeders,
placed **#11**; the winner was a peer with **8 seeders** and a 0.3% size lead. The question that
started it was whether `IMAX` should be a criterion. It should not, and it was not the cause: six of
the seven top rows advertise IMAX. The cause was three letters missing from one release name.

**Why the whole chain collapsed onto size.** Worth recording, because it is the property that makes a
one-rung error decisive rather than cosmetic. Between two tier-5 disc sources, REQ-8's codec is
skipped (REQ-11, since `0.8.0`), REQ-10's audio is skipped, and dynamic range ties across every
remux of the same disc. So criteria 4, 5 and 6 are all inert at once, and the first criterion that
can separate two rows is **size** — which, among remuxes of one disc, differs only by which audio
tracks were kept. Seeders, the one field that says "this is the release people actually use", is
criterion 9. At tier 5 the comparator is far blunter than its ten rows suggest, and REQ-7b matters
because criterion 3 is effectively the *last* criterion with real discriminating power.

**Replace, not widen.** The conservative form — `uhd = <token> || tier >= 5` — was considered and
rejected. It fixes the release that is denied a rung and leaves untouched the release that is handed
one it has not earned: a 1080p hybrid whose name says `UHD BluRay` outranking an honest 1080p remux.
The corpus has four such rows, so this is not a hypothetical. Replacing the test fixes both
directions at the same cost.

**Measured before writing**, against the 475 rows the live search returned (of 503; the table renders
that many):

| | before | after |
| :-- | :-- | :-- |
| candidates | 56 | 56 — REQ-7b admits and drops nothing (AC-31) |
| `sourceRank` changes | — | 28 rows: 24 up, 4 down |
| the 4 that drop | 6 `UHD BluRay` | 5 `BluRay` — all tier 4, all naming `UHD` |
| `candidateRank` 1 | Rjaa, 89.56 GB, 8 seeders | the IMAX remux, 97.85 GB, 1082 seeders |

None of the four demotions is at tier 5, so none touches this film's candidate set. One edge case is
reasoned rather than measured, because the corpus contains none: a release carrying `REMUX` and `UHD`
but **no resolution token at all** parses tier 0 and drops 8 → 7. It is inconsequential in practice —
tier 0 is the floor, and it reaches the candidate set only when every row in the list is also tier 0
— but it is a real narrowing and is recorded here rather than discovered later.

**Three consequences, reviewed and accepted.**

1. **The chip text changes.** `sourceLabel` crosses GraphQL and is rendered on the row, so a release
   whose name never says `UHD` will display `UHD BluRay Remux`. This breaks REQ-14's invariant — a
   chip is the parse, never an inference — on the same terms and in the same release as REQ-8's
   inferred `HEVC` label. Accepted; two exceptions in one amendment, both written down, neither
   silent.
2. **REQ-22's promotion goes inert at tier 5 for disc sources.** Accepted as an improvement, not a
   regression: the promotion existed to lift a release within its family, and at tier 5 the family
   pair was never two qualities to begin with. A user who prefers their language over resolution is
   served by criterion 7 and by the tiers below, which are untouched. Recorded in full under REQ-22.
3. **Out of scope: `076`'s quality floors.** `minSourceRank` (digital ≥ 4, physical ≥ 6) is a gate on
   *when a film becomes eligible to search*, not a ranking concern, and it is specified in
   `076-automatic-movie-acquisition`, not here. Noted only because REQ-7b moves a value it reads: a
   tier-5 non-remux disc release that does not name `UHD` goes 5 → 6 and so begins to clear the
   physical floor. That is the floor working as `076` intends — a 4K Blu-ray rip *is* the physical
   release — so this is a second small correction, not a risk. **No requirement, task or
   acceptance criterion in `036` covers it**, and `076` needs no amendment for it.

**What this does not do.** It does not read `IMAX`, or any edition token, anywhere. It adds no
GraphQL field, no Prisma column, no i18n key, no constant beyond reusing `UHD_RESOLUTION_TIER`, and
it touches no service other than `api`. It does not re-weight, reorder or merge any criterion of
REQ-11 — including the size-before-seeders order that made this defect decisive, which is left
exactly as it is and is not this amendment's business to relitigate.
