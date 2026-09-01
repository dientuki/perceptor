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
};

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

function buildRanking(title: string): ReleaseRanking {
  const res = resolution(title);
  const group = preferredGroup(title);
  const src = source(title);
  const cod = codec(title);
  const range = dynamicRange(title);
  const aud = audio(title);

  return {
    resolutionTier: res.tier,
    resolutionLabel: res.label,
    preferredGroup: group.preferred,
    groupLabel: group.label,
    sourceRank: src.rank,
    sourceLabel: src.label,
    codecRank: cod.rank,
    codecLabel: cod.label,
    dynamicRangeRank: range.rank,
    dynamicRangeLabel: range.label,
    audioRank: aud.rank,
    audioLabel: aud.label,
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
 * returned non-zero otherwise — so testing one is testing both.
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
    (b.size ?? 0) - (a.size ?? 0) ||
    b.seeders - a.seeders ||
    a.leechers - b.leechers
  );
}

/**
 * The single exported entry point (REQ-1). Vetoes, keeps only the highest resolution tier, then
 * orders what remains through the lexicographic comparator. Never mutates its argument.
 */
export function rankTorrentResults(
  results: TorrentResult[],
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
    ranking: buildRanking(lowerTitle(result)),
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
