// Pure, client-side selection heuristic for torrent search results — see
// docs/spec/features/036-torrent-ranking-heuristic/spec.md REQ-3 for the algorithm this
// implements. Reusable by design: SearchTorrent.tsx is the first caller, an eventual automatic
// picker is meant to be the second.
//
// This is a **lexicographic comparator, not a weighted score**. Each criterion only ever breaks
// ties in the one above it, so no amount of goodness lower down can promote a release past one
// that beat it higher up: a UHD BluRay Remux can never lose to a WEB-DL on size or seeders. A
// weighted sum cannot express that guarantee, which is why the score model it replaced kept
// producing orderings the user disagreed with.

import type { TorrentResult } from "@/types/indexer";
import type { Language } from "@/types/languages";

/** Groups the user trusts on reputation. Ranked directly under resolution, above source. */
const PREFERRED_GROUPS = ["ntb", "btm", "flux"];

/**
 * Streaming-service tags that identify a WEB-DL even when the name never spells out "WEB-DL".
 * They all rank identically — the service is not (yet) a criterion, only evidence of the source
 * type. Grows as real release names show up; nothing here may be ambiguous with a non-service
 * token (`ma` would collide with DTS-HD MA, `max` with a title word, so neither is listed).
 */
const STREAMING_SERVICES = [
  "amzn",
  "dsnp",
  "atvp",
  "nf",
  "hmax",
  "pcok",
  "hulu",
  "stan",
  "bcore",
];

/**
 * REQ-23 — the spellings release names actually use for a language that no ISO code covers.
 * Keyed by `iso3`, so adding a language is a data addition here, never a code change. Regional
 * variants collapse into the language they belong to — `castellano` and `latino` both satisfy a
 * request for Spanish, exactly like a bare `spa`.
 *
 * `MULTI`/`DUAL` are deliberately absent, for every language, and must stay that way: they assert
 * that more than one audio track exists without saying which, so reading either as a hit would
 * promote a release that may not carry the required language at all — the false positive REQ-22
 * exists to avoid.
 */
const LANGUAGE_ALIASES: Record<string, string[]> = {
  spa: ["esp", "castellano", "cast", "latino", "lat"],
};

/**
 * REQ-23 — the full boundary-anchored token set for a language: its `iso3`, its `iso2`, plus
 * whatever `LANGUAGE_ALIASES` adds for it. `Pick` rather than the whole `Language` record, since
 * this is the only part of it release-name matching ever reads.
 */
function languageTokens(language: Pick<Language, "iso2" | "iso3">): string[] {
  const tokens = [
    language.iso3,
    language.iso2,
    ...(LANGUAGE_ALIASES[language.iso3.toLowerCase()] ?? []),
  ];
  return Array.from(
    new Set(
      tokens.filter((tag) => tag.length > 0).map((tag) => tag.toLowerCase()),
    ),
  );
}

/**
 * REQ-23 — whether `title` advertises `language`: any of its tokens present as its own
 * boundary-anchored token, case-insensitively. Same `(?<![\dA-Za-z])…(?![\dA-Za-z])` discipline
 * REQ-5/REQ-7 use, and it matters more here — these are the shortest tokens in the file, and an
 * unanchored `lat` matches `Translated`/`Latvian` while an unanchored `es` matches almost every
 * release name.
 */
export function matchesLanguage(
  title: string,
  language: Pick<Language, "iso2" | "iso3">,
): boolean {
  return languageTokens(language).some((tag) =>
    new RegExp(`(?<![\\dA-Za-z])${tag}(?![\\dA-Za-z])`, "i").test(title),
  );
}

/** The parsed interpretation behind a candidate's placement — rendered per row, see REQ-14. */
export type ReleaseRanking = {
  resolutionTier: number;
  resolutionLabel: string;
  preferredGroup: boolean;
  groupLabel: string | null;
  sourceRank: number;
  sourceLabel: string;
  codecRank: number;
  codecLabel: string;
  dynamicRangeRank: number;
  dynamicRangeLabel: string;
  audioRank: number;
  audioLabel: string;
  /**
   * REQ-22/REQ-23/REQ-14, added `spec_version` 0.5.0 — the mandatory audio language advertised by
   * this release's title, as its uppercased `iso3` (e.g. `"SPA"`), or `null` when the requirement
   * is absent/unarmed or the title advertises none of the required languages. `sourceRank` above
   * already carries any promotion this produced; `sourceLabel` deliberately does not change, so a
   * promoted `BluRay Remux` never renders as if it had been read as `UHD BluRay Remux`.
   */
  matchedLanguage: string | null;
  /**
   * REQ-22/REQ-14 — whether `sourceRank` was actually raised by the promotion, as opposed to a
   * matched release that was already sitting at its family's ceiling (REQ-22's "nowhere to go"
   * case). Lets the UI distinguish a promoted rank from a genuine one at the same value.
   */
  sourcePromoted: boolean;
};

/**
 * REQ-25 — the audio-language requirement of the title being acquired, threaded in from whichever
 * component holds the `Movie`/`Show` (or `null`/absent for a caller with no target, e.g. the
 * eventual automatic picker — NFR-5). `Pick` mirrors `matchesLanguage`'s parameter: only `iso2`/
 * `iso3` are ever read.
 */
export type LanguageRequirement = {
  mandatory: boolean;
  languages: Pick<Language, "iso2" | "iso3">[];
};

/**
 * REQ-22/NFR-5 — "armed" means every part of the amendment actually runs: the flag is on and there
 * is at least one language to match against. Anything else (absent, `mandatory: false`, an empty
 * list) is a no-op, indistinguishable from calling `rankTorrentResults` with no second argument.
 */
function isArmed(
  requirement: LanguageRequirement | null | undefined,
): requirement is LanguageRequirement {
  return (
    requirement != null &&
    requirement.mandatory === true &&
    requirement.languages.length > 0
  );
}

/**
 * REQ-22 — the ceiling for the source family `rank` belongs to. Expressed as a per-family lookup,
 * not a single global `Math.min(rank + 1, 8)`: a global cap would let `WEB-DL` (4) climb to `5`,
 * which is `BluRay`'s rank, smuggling a web source into disc territory. Ranks 7/8 are the remux
 * family (ceiling 8), 5/6 are disc non-remux (ceiling 6), 2/3/4 are web (ceiling 4), and 0
 * (unrecognised) never promotes — its own ceiling.
 */
function familyCeiling(rank: number): number {
  if (rank >= 7) return 8;
  if (rank >= 5) return 6;
  if (rank >= 2) return 4;
  return 0;
}

/**
 * REQ-22 — the adjusted source rank: `+1` when `matched`, capped at the rank's own family ceiling,
 * a no-op when `matched` is false. `promoted` reports whether the rank actually moved, so a release
 * already sitting at its ceiling (REQ-22's "nowhere to go" case) is not misreported as promoted.
 */
function adjustSourceRank(
  rank: number,
  matched: boolean,
): { rank: number; promoted: boolean } {
  if (!matched) return { rank, promoted: false };
  const adjusted = Math.min(rank + 1, familyCeiling(rank));
  return { rank: adjusted, promoted: adjusted > rank };
}

export type RankedTorrentResult = TorrentResult & {
  ranking: ReleaseRanking;
};

/** Shown where a criterion found nothing it recognises. Language-neutral on purpose. */
const UNKNOWN_LABEL = "—";

function lowerTitle(result: TorrentResult): string {
  return result.title?.toLowerCase() ?? "";
}

/** REQ-4 — a release identified as av1 or vp9 is vetoed outright, regardless of resolution. */
function isVetoed(title: string): boolean {
  return /\bav1\b/.test(title) || /\bvp9\b/.test(title);
}

/**
 * REQ-4a — dead-swarm veto. No seeder and almost no leecher means nothing will ever finish
 * downloading, so the release is not a candidate however good its name reads. A swarm with no
 * seeders but real leecher interest is left alone: those revive, and vetoing them would discard
 * the better source for a worse one that merely happens to be alive right now.
 *
 * Like REQ-4 this runs in pass 1, so a dead 2160p release never sets the tier and evicts every
 * live 1080p one.
 */
const MIN_LEECHERS_WITHOUT_SEEDERS = 5;

function isDeadSwarm(result: TorrentResult): boolean {
  return result.seeders === 0 && result.leechers < MIN_LEECHERS_WITHOUT_SEEDERS;
}

/**
 * REQ-5 — resolution, the first and only criterion that also *removes* candidates. The number is
 * matched as its own token: a boundary that excludes an adjacent letter as well as an adjacent
 * digit, so `10800`/`21600` never match, and `DS4K` (a "downscaled from 4K" scene tag on an actual
 * 1080p release — found in real indexer data) does not misread as 4K either. The scan suffix
 * (`p`/`i`) is optional, since release names drop it often enough that requiring it would silently
 * discard those releases.
 */
function resolution(title: string): { tier: number; label: string } {
  if (
    /(?<![\dA-Za-z])4k(?![\dA-Za-z])/.test(title) ||
    /(?<![\dA-Za-z])2160[pi]?(?![\dA-Za-z])/.test(title)
  ) {
    return { tier: 5, label: "4K" };
  }
  if (/(?<![\dA-Za-z])1080[pi]?(?![\dA-Za-z])/.test(title)) {
    return { tier: 4, label: "1080p" };
  }
  if (/(?<![\dA-Za-z])720[pi]?(?![\dA-Za-z])/.test(title)) {
    return { tier: 3, label: "720p" };
  }
  if (/(?<![\dA-Za-z])480[pi]?(?![\dA-Za-z])/.test(title)) {
    return { tier: 2, label: "480p" };
  }
  if (/(?<![\dA-Za-z])360[pi]?(?![\dA-Za-z])/.test(title)) {
    return { tier: 1, label: "360p" };
  }
  return { tier: 0, label: UNKNOWN_LABEL };
}

/**
 * REQ-6 — preferred group. Ranked directly under resolution and **above source**, deliberately:
 * the group is a reputation signal the user trusts for reasons the release name cannot express,
 * so a 2160p release from a preferred group outranks a 2160p UHD BluRay Remux from an unknown one.
 * Matched on the trailing release-group segment only, so a title merely containing `flux`
 * mid-string does not match.
 */
function preferredGroup(title: string): {
  preferred: boolean;
  label: string | null;
} {
  const trailingSegment =
    title
      .trim()
      .split(/[\s.-]+/)
      .pop() ?? "";
  return PREFERRED_GROUPS.includes(trailingSegment)
    ? { preferred: true, label: trailingSegment.toUpperCase() }
    : { preferred: false, label: null };
}

/**
 * REQ-7 — source. **Remux-ness is the primary split, ahead of the `UHD` tag.** A remux is an
 * already-usable video file pulled straight off the disc; a non-remux BluRay/UHD BluRay release
 * is frequently a raw ISO image, which contributes nothing until someone extracts it — so a plain
 * `BluRay Remux` outranks a tagless `UHD BluRay`, even though `UHD` alone reads as the fancier
 * label. `UHD` only breaks the tie *within* each of those two groups. A bare `REMUX` with no disc
 * token is treated as a BluRay remux, which is what it always is in practice. `BDRip` is a BluRay
 * encode and ranks with `BluRay`. A streaming-service tag identifies a WEB-DL on its own, since
 * many releases carry `AMZN`/`DSNP`/`ATVP` and never the literal `WEB-DL`.
 */
function source(title: string): { rank: number; label: string } {
  const uhd = /\buhd\b/.test(title);
  // No leading boundary: `BDRemux` is a single token in real release names, and requiring one
  // made every `UHD BDRemux` fall through to "unrecognised" — the worst rank instead of the best.
  const remux = /remux/.test(title);
  const bluray =
    /\bblu-?ray\b/.test(title) ||
    /\bbd-?rip\b/.test(title) ||
    /\bbd-?remux\b/.test(title);

  if (remux || bluray) {
    if (remux) {
      return uhd
        ? { rank: 8, label: "UHD BluRay Remux" }
        : { rank: 7, label: "BluRay Remux" };
    }
    return uhd
      ? { rank: 6, label: "UHD BluRay" }
      : { rank: 5, label: "BluRay" };
  }

  const service = STREAMING_SERVICES.find((tag) =>
    new RegExp(`\\b${tag}\\b`).test(title),
  );
  if (/\bweb-?dl\b/.test(title) || service) {
    return {
      rank: 4,
      label: service ? `WEB-DL ${service.toUpperCase()}` : "WEB-DL",
    };
  }
  if (/\bwebrip\b/.test(title)) return { rank: 3, label: "WEBRip" };
  if (/\bhdrip\b/.test(title)) return { rank: 2, label: "HDRip" };
  return { rank: 0, label: UNKNOWN_LABEL };
}

/**
 * REQ-8 — codec. `av1`/`vp9` never reach here; REQ-4 removed them. `H 265` and `H.265` are as
 * common as `H265` in real release names, so the separator is optional.
 */
function codec(title: string): { rank: number; label: string } {
  if (
    /\bhevc\b/.test(title) ||
    /\bx265\b/.test(title) ||
    /\bh[\s.-]?265\b/.test(title)
  ) {
    return { rank: 3, label: "HEVC" };
  }
  if (
    /\bavc\b/.test(title) ||
    /\bx264\b/.test(title) ||
    /\bh[\s.-]?264\b/.test(title)
  ) {
    return { rank: 2, label: "AVC" };
  }
  return { rank: 0, label: UNKNOWN_LABEL };
}

/**
 * REQ-9 — dynamic range. `10bit`/`10-bit` alongside a bare `hdr` counts as HDR10: scene releases
 * routinely spell out the bit depth instead of writing `HDR10`, and the two mean the same thing.
 * Highest match wins, never combined — a `DV HDR10+` release is ranked as HDR10, not as both.
 */
function dynamicRange(title: string): { rank: number; label: string } {
  const hdr10 = /\bhdr10\+?\b/.test(title);
  const hdr = /\bhdr\b/.test(title);
  const tenBit = /\b10-?bit\b/.test(title);
  // HDR and HDR10 rank *equally*. A release tagged plain `HDR` is HDR10 in practice — HDR10 is
  // the baseline every UHD disc and stream carries, and the bare tag is just a shorter spelling.
  // The labels stay distinct so the parse remains visible, but neither wins over the other.
  if (hdr10 || (hdr && tenBit)) return { rank: 3, label: "HDR10" };
  if (hdr) return { rank: 3, label: "HDR" };
  if (
    /\bdv\b/.test(title) ||
    /\bdovi\b/.test(title) ||
    /\bdolby vision\b/.test(title)
  ) {
    return { rank: 2, label: "DV" };
  }
  return { rank: 0, label: "SDR" };
}

/**
 * REQ-10 — audio. A lossless core (`TrueHD`, `DTS-HD MA`) carrying object audio (`Atmos`) is the
 * best input; lossless alone next; a lossy object-capable track (`DDP`/`E-AC3`, including the
 * `DDPA` spelling that means DDP+Atmos) next; a plain lossy core last. Highest match wins.
 */
function audio(title: string): { rank: number; label: string } {
  const lossless =
    /\btruehd\b/.test(title) ||
    (/\bdts-hd\b/.test(title) && /\bma\b/.test(title));
  const atmos = /\batmos\b/.test(title) || /\bddpa\d/.test(title);

  if (lossless && atmos) return { rank: 4, label: "Lossless+Atmos" };
  if (lossless) return { rank: 3, label: "Lossless" };
  if (atmos || /\bddp/.test(title) || /\beac3\b/.test(title)) {
    return { rank: 2, label: atmos ? "Atmos" : "DDP" };
  }
  if (/\bdts\b/.test(title) || /\bdd\b/.test(title) || /\bac3\b/.test(title)) {
    return { rank: 1, label: "DTS/DD" };
  }
  if (/\baac/.test(title)) return { rank: 1, label: "AAC" };
  return { rank: 0, label: UNKNOWN_LABEL };
}

function buildRanking(
  title: string,
  requirement: LanguageRequirement | null | undefined,
): ReleaseRanking {
  const res = resolution(title);
  const group = preferredGroup(title);
  const src = source(title);
  const cod = codec(title);
  const range = dynamicRange(title);
  const aud = audio(title);

  // REQ-23 — first requested language whose tokens appear in the title, or none. `matchedLanguage`
  // stays `null` whenever the requirement is absent/unarmed (REQ-22, NFR-5), which is also what
  // keeps `adjustSourceRank` a no-op below.
  const armed = isArmed(requirement);
  const match = armed
    ? requirement.languages.find((language) => matchesLanguage(title, language))
    : undefined;
  const matchedLanguage = match ? match.iso3.toUpperCase() : null;

  const { rank: adjustedSourceRank, promoted } = adjustSourceRank(
    src.rank,
    matchedLanguage !== null,
  );

  return {
    resolutionTier: res.tier,
    resolutionLabel: res.label,
    preferredGroup: group.preferred,
    groupLabel: group.label,
    // REQ-7/REQ-22 — the adjusted rank. `sourceLabel` deliberately stays `src.label`: the promotion
    // moves the rank, never the read label, so a promoted release is never rendered as if its name
    // had said something it didn't (REQ-14).
    sourceRank: adjustedSourceRank,
    sourceLabel: src.label,
    codecRank: cod.rank,
    codecLabel: cod.label,
    dynamicRangeRank: range.rank,
    dynamicRangeLabel: range.label,
    audioRank: aud.rank,
    audioLabel: aud.label,
    matchedLanguage,
    sourcePromoted: promoted,
  };
}

/** The lowest source rank that still means "came off a disc" — see DISC_SOURCE_MIN_RANK use. */
const DISC_SOURCE_MIN_RANK = 5;

/**
 * REQ-11 — the comparator. Each line only runs when every line above it tied. Ordered best-first,
 * so every criterion is "higher wins" except leechers, where fewer is better.
 *
 * **Codec and audio are both skipped between two disc sources.** A UHD BluRay is HEVC and carries
 * the disc's lossless track whether or not the release name bothers to say so, so an unmentioned
 * codec or track is missing *information*, not missing quality — comparing them on it would rank a
 * verbose title above an identical terse one purely for being verbose. Both still decide between
 * two web sources, where the name is the only evidence there is.
 *
 * This never lets an AV1 or VP9 disc rip through: REQ-4 vetoes those in pass 1, before any source
 * is looked at, so they are gone long before this comparator runs.
 *
 * Both candidates are known to share a source rank by the time either check runs — the line above
 * returned non-zero otherwise — so testing one is testing both. `ranking.sourceRank` is already the
 * REQ-22-adjusted value (see `buildRanking`), so `bothFromDisc` is read off it directly rather than
 * off a second, unadjusted copy — this can never change the answer, since the promotion never
 * crosses the disc boundary, but it keeps one source of truth for "is this a disc source".
 *
 * **Criterion 7 (REQ-24), between audio and size, is the mandatory-audio-language tiebreak — and it
 * is deliberately *not* skipped for two disc sources**, unlike codec and audio just above. Those two
 * are skipped because a disc source *implies* them: a BluRay is HEVC and carries the disc's lossless
 * track whether the name says so or not. A disc source implies nothing about which languages it
 * carries — a US UHD disc may hold no Spanish at all — so the tag is real, non-redundant information
 * for a remux exactly as it is for a WEB-DL, and skipping it here would throw that information away.
 * It is inert (both `null`) whenever the requirement is absent/unarmed.
 */
function compareCandidates(
  a: RankedTorrentResult,
  b: RankedTorrentResult,
): number {
  const bothFromDisc = a.ranking.sourceRank >= DISC_SOURCE_MIN_RANK;

  return (
    b.ranking.resolutionTier - a.ranking.resolutionTier ||
    Number(b.ranking.preferredGroup) - Number(a.ranking.preferredGroup) ||
    b.ranking.sourceRank - a.ranking.sourceRank ||
    (bothFromDisc ? 0 : b.ranking.codecRank - a.ranking.codecRank) ||
    b.ranking.dynamicRangeRank - a.ranking.dynamicRangeRank ||
    (bothFromDisc ? 0 : b.ranking.audioRank - a.ranking.audioRank) ||
    Number(b.ranking.matchedLanguage !== null) -
      Number(a.ranking.matchedLanguage !== null) ||
    (b.size ?? 0) - (a.size ?? 0) ||
    b.seeders - a.seeders ||
    a.leechers - b.leechers
  );
}

/**
 * The single exported entry point (REQ-1). Vetoes, keeps only the highest resolution tier, then
 * orders what remains through the lexicographic comparator. Never mutates its argument.
 *
 * `requirement` is REQ-25's second, optional argument (REQ-22/NFR-5): the target title's audio
 * requirement, or `null`/absent for a caller with no target — the eventual automatic picker running
 * over a bare list, a future season-pack entry point. Absent, unarmed or empty-listed, it is a
 * complete no-op: this produces exactly the `spec_version` 0.4.0 ordering (AC-14).
 */
export function rankTorrentResults(
  results: TorrentResult[],
  requirement?: LanguageRequirement | null,
): RankedTorrentResult[] {
  // Pass 1 — veto (REQ-4, REQ-4a). Runs first, so a vetoed release never sets the tier for pass 2.
  const notVetoed = results.filter(
    (result) => !isVetoed(lowerTitle(result)) && !isDeadSwarm(result),
  );

  // Pass 2 — tier. Guard the empty-survivor case explicitly rather than letting Math.max
  // return -Infinity over an empty array.
  if (notVetoed.length === 0) {
    return [];
  }

  const ranked: RankedTorrentResult[] = notVetoed.map((result) => ({
    ...result,
    ranking: buildRanking(lowerTitle(result), requirement),
  }));

  const maxTier = Math.max(
    ...ranked.map((entry) => entry.ranking.resolutionTier),
  );
  const candidates = ranked.filter(
    (entry) => entry.ranking.resolutionTier === maxTier,
  );

  // Pass 3 — order. `sort` is stable, so candidates that tie on every criterion keep the order
  // the API returned them in rather than being shuffled (NFR-4).
  return [...candidates].sort(compareCandidates);
}
