import type { TorrentResult } from '@/clients/indexer/types';

const DEFAULT_PREFERRED_GROUPS = ['ntb', 'btm', 'flux'];

const STREAMING_SERVICES = [
  'amzn',
  'dsnp',
  'atvp',
  'nf',
  'hmax',
  'pcok',
  'hulu',
  'stan',
  'bcore',
];

const LANGUAGE_ALIASES: Record<string, string[]> = {
  spa: ['esp', 'castellano', 'cast', 'latino', 'lat'],
};

export type RankingLanguage = { iso2: string; iso3: string };

function languageTokens(language: RankingLanguage): string[] {
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

function matchesAnyToken(
  title: string,
  tokens: string[],
  flags?: string,
): boolean {
  return tokens.some((tag) =>
    new RegExp(`(?<![\\dA-Za-z])${tag}(?![\\dA-Za-z])`, flags).test(title),
  );
}

export function matchesLanguage(
  title: string,
  language: RankingLanguage,
): boolean {
  return matchesAnyToken(title, languageTokens(language), 'i');
}

export type ReleaseRankingData = {
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
  matchedLanguage: string | null;
  sourcePromoted: boolean;
};

export type LanguageRequirement = {
  mandatory: boolean;
  languages: RankingLanguage[];
};

export type RankingContext = {
  languageRequirement: LanguageRequirement | null;
  preferredGroups: string[];
  allowCinemaReleases: boolean;
  minSourceRank?: number | null;
};

export type RankedTorrentResult = TorrentResult & {
  ranking: ReleaseRankingData;
  candidate: boolean;
  candidateRank: number | null;
};

function isArmed(
  requirement: LanguageRequirement | null | undefined,
): requirement is LanguageRequirement {
  return (
    requirement != null &&
    requirement.mandatory === true &&
    requirement.languages.length > 0
  );
}

function familyCeiling(rank: number): number {
  if (rank >= 7) return 8;
  if (rank >= 5) return 6;
  if (rank >= 2) return 4;
  return 0;
}

function adjustSourceRank(
  rank: number,
  matched: boolean,
): { rank: number; promoted: boolean } {
  if (!matched) return { rank, promoted: false };
  const adjusted = Math.min(rank + 1, familyCeiling(rank));
  return { rank: adjusted, promoted: adjusted > rank };
}

const UNKNOWN_LABEL = '—';

function lowerTitle(result: TorrentResult): string {
  return result.title?.toLowerCase() ?? '';
}

function isVetoed(title: string): boolean {
  return /\bav1\b/.test(title) || /\bvp9\b/.test(title);
}

const MIN_LEECHERS_WITHOUT_SEEDERS = 5;

function isDeadSwarm(result: TorrentResult): boolean {
  return result.seeders === 0 && result.leechers < MIN_LEECHERS_WITHOUT_SEEDERS;
}

function isUpscaled(title: string): boolean {
  return /(?<![\dA-Za-z])(?:ai[\s._-]?)?upscal(?:ed|e)(?![\dA-Za-z])/.test(
    title,
  );
}

const CINEMA_CAPTURE_TOKENS = [
  'cam',
  'hdcam',
  'camrip',
  'ts',
  'hdts',
  'telesync',
  'tc',
  'telecine',
  'scr',
  'screener',
  'dvdscr',
  'bdscr',
  'dcp',
  'dcprip',
  'wp',
  'workprint',
];

function isCinemaCapture(title: string): boolean {
  return matchesAnyToken(title, CINEMA_CAPTURE_TOKENS);
}

function resolution(title: string): { tier: number; label: string } {
  if (
    /(?<![\dA-Za-z])4k(?![\dA-Za-z])/.test(title) ||
    /(?<![\dA-Za-z])2160[pi]?(?![\dA-Za-z])/.test(title)
  ) {
    return { tier: 5, label: '4K' };
  }
  if (/(?<![\dA-Za-z])1080[pi]?(?![\dA-Za-z])/.test(title)) {
    return { tier: 4, label: '1080p' };
  }
  if (/(?<![\dA-Za-z])720[pi]?(?![\dA-Za-z])/.test(title)) {
    return { tier: 3, label: '720p' };
  }
  if (/(?<![\dA-Za-z])480[pi]?(?![\dA-Za-z])/.test(title)) {
    return { tier: 2, label: '480p' };
  }
  if (/(?<![\dA-Za-z])360[pi]?(?![\dA-Za-z])/.test(title)) {
    return { tier: 1, label: '360p' };
  }
  return { tier: 0, label: UNKNOWN_LABEL };
}

function preferredGroup(
  title: string,
  groups: string[],
): {
  preferred: boolean;
  label: string | null;
} {
  const trailingSegment =
    title
      .trim()
      .replace(/\s*\[[^\]]*\]$/, '')
      .split(/[\s.-]+/)
      .pop() ?? '';
  return groups.includes(trailingSegment)
    ? { preferred: true, label: trailingSegment.toUpperCase() }
    : { preferred: false, label: null };
}

function source(title: string): { rank: number; label: string } {
  const uhd = /\buhd\b/.test(title);
  const remux = /remux/.test(title);
  const bluray =
    /\bblu-?ray\b/.test(title) ||
    /\bbd-?rip\b/.test(title) ||
    /\bbd-?remux\b/.test(title);

  if (remux || bluray) {
    if (remux) {
      return uhd
        ? { rank: 8, label: 'UHD BluRay Remux' }
        : { rank: 7, label: 'BluRay Remux' };
    }
    return uhd
      ? { rank: 6, label: 'UHD BluRay' }
      : { rank: 5, label: 'BluRay' };
  }

  const service = STREAMING_SERVICES.find((tag) =>
    new RegExp(`\\b${tag}\\b`).test(title),
  );
  if (/\bweb-?dl\b/.test(title) || service) {
    return {
      rank: 4,
      label: service ? `WEB-DL ${service.toUpperCase()}` : 'WEB-DL',
    };
  }
  if (/\bwebrip\b/.test(title)) return { rank: 3, label: 'WEBRip' };
  if (/\bhdrip\b/.test(title)) return { rank: 2, label: 'HDRip' };
  return { rank: 0, label: UNKNOWN_LABEL };
}

function codec(
  title: string,
  resolutionTier: number,
): { rank: number; label: string } {
  const uhd = resolutionTier >= UHD_RESOLUTION_TIER;
  if (
    /\bhevc\b/.test(title) ||
    /\bx265\b/.test(title) ||
    /\bh[\s.-]?265\b/.test(title)
  ) {
    return { rank: uhd ? 3 : 1, label: 'HEVC' };
  }
  if (
    /\bavc\b/.test(title) ||
    /\bx264\b/.test(title) ||
    /\bh[\s.-]?264\b/.test(title)
  ) {
    return { rank: uhd ? 2 : 3, label: 'AVC' };
  }
  return { rank: uhd ? 0 : 2, label: UNKNOWN_LABEL };
}

function dynamicRange(title: string): { rank: number; label: string } {
  const hdr10 = /\bhdr10\+?\b/.test(title);
  const hdr = /\bhdr\b/.test(title);
  const tenBit = /\b10-?bit\b/.test(title);
  if (hdr10 || (hdr && tenBit)) return { rank: 3, label: 'HDR10' };
  if (hdr) return { rank: 3, label: 'HDR' };
  if (
    /\bdv\b/.test(title) ||
    /\bdovi\b/.test(title) ||
    /\bdolby vision\b/.test(title)
  ) {
    return { rank: 2, label: 'DV' };
  }
  return { rank: 0, label: 'SDR' };
}

function audio(title: string): { rank: number; label: string } {
  const lossless =
    /\btruehd\b/.test(title) ||
    (/\bdts-hd\b/.test(title) && /\bma\b/.test(title));
  const atmos = /\batmos\b/.test(title) || /\bddpa\d/.test(title);

  if (lossless && atmos) return { rank: 4, label: 'Lossless+Atmos' };
  if (lossless) return { rank: 3, label: 'Lossless' };
  if (atmos || /\bddp/.test(title) || /\beac3\b/.test(title)) {
    return { rank: 2, label: atmos ? 'Atmos' : 'DDP' };
  }
  if (/\bdts\b/.test(title) || /\bdd\b/.test(title) || /\bac3\b/.test(title)) {
    return { rank: 1, label: 'DTS/DD' };
  }
  if (/\baac/.test(title)) return { rank: 1, label: 'AAC' };
  return { rank: 0, label: UNKNOWN_LABEL };
}

function buildRanking(
  title: string,
  requirement: LanguageRequirement | null | undefined,
  groups: string[],
): ReleaseRankingData {
  const res = resolution(title);
  const group = preferredGroup(title, groups);
  const src = source(title);
  const cod = codec(title, res.tier);
  const range = dynamicRange(title);
  const aud = audio(title);

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

const DISC_SOURCE_MIN_RANK = 5;
const UHD_RESOLUTION_TIER = 5;

type Ranked = TorrentResult & { ranking: ReleaseRankingData };

function compareCandidates(a: Ranked, b: Ranked): number {
  const bothFromDisc = a.ranking.sourceRank >= DISC_SOURCE_MIN_RANK;
  const skipCodec =
    bothFromDisc && a.ranking.resolutionTier >= UHD_RESOLUTION_TIER;

  return (
    b.ranking.resolutionTier - a.ranking.resolutionTier ||
    Number(b.ranking.preferredGroup) - Number(a.ranking.preferredGroup) ||
    b.ranking.sourceRank - a.ranking.sourceRank ||
    (skipCodec ? 0 : b.ranking.codecRank - a.ranking.codecRank) ||
    b.ranking.dynamicRangeRank - a.ranking.dynamicRangeRank ||
    (bothFromDisc ? 0 : b.ranking.audioRank - a.ranking.audioRank) ||
    Number(b.ranking.matchedLanguage !== null) -
      Number(a.ranking.matchedLanguage !== null) ||
    (b.size ?? 0) - (a.size ?? 0) ||
    b.seeders - a.seeders ||
    a.leechers - b.leechers
  );
}

export function rankTorrentResults(
  results: TorrentResult[],
  context: RankingContext,
): RankedTorrentResult[] {
  const groups =
    context.preferredGroups.length > 0
      ? context.preferredGroups.map((g) => g.toLowerCase())
      : DEFAULT_PREFERRED_GROUPS;

  const ranked: Ranked[] = results.map((result) => ({
    ...result,
    ranking: buildRanking(
      lowerTitle(result),
      context.languageRequirement,
      groups,
    ),
  }));

  const survivors = ranked.filter(
    (entry) =>
      !isVetoed(lowerTitle(entry)) &&
      !isDeadSwarm(entry) &&
      !isUpscaled(lowerTitle(entry)) &&
      !(!context.allowCinemaReleases && isCinemaCapture(lowerTitle(entry))) &&
      !(
        context.minSourceRank != null &&
        entry.ranking.sourceRank < context.minSourceRank
      ),
  );

  const maxTier = survivors.reduce(
    (max, entry) => Math.max(max, entry.ranking.resolutionTier),
    -1,
  );
  const candidates = survivors
    .filter((entry) => entry.ranking.resolutionTier === maxTier)
    .sort(compareCandidates);

  const rankByEntry = new Map<Ranked, number>();
  candidates.forEach((entry, index) => rankByEntry.set(entry, index + 1));

  return ranked.map((entry) => {
    const candidateRank = rankByEntry.get(entry) ?? null;
    return { ...entry, candidate: candidateRank !== null, candidateRank };
  });
}
