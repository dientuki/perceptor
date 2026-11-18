import type { SubdivxItem } from '@/clients/subdivx/types';
import {
  filterAndRank,
  MAX_CANDIDATES_PER_LANGUAGE,
  SubtitleCandidate,
} from './candidates';

// Spec 121, REQ-12
export type SubdivxTarget = { season: number; episode: number } | null;

function toCandidate(item: SubdivxItem): SubtitleCandidate {
  return {
    id: String(item.id),
    release: item.description ?? item.title ?? '',
    fileCount: 1,
    hearingImpaired: false,
    foreignPartsOnly: false,
    machineTranslated: false,
    aiTranslated: false,
    hashMatch: false,
    downloadCount: item.downloads ?? 0,
  };
}

function carriesEpisode(item: SubdivxItem, season: number, episode: number) {
  const pattern = new RegExp(
    `(?:^|[^a-z0-9])s0?${season}e0?${episode}(?![0-9])`,
    'i',
  );
  return pattern.test(item.title ?? '') || pattern.test(item.description ?? '');
}

// Spec 121, REQ-12
export function subdivxCandidates(
  items: SubdivxItem[],
  target: SubdivxTarget,
  releaseName: string,
): SubtitleCandidate[] {
  if (target === null) {
    return filterAndRank(items.map(toCandidate), releaseName);
  }
  const exact: SubtitleCandidate[] = [];
  const packs: SubtitleCandidate[] = [];
  for (const item of items) {
    const season = item.season ?? null;
    const episode = item.episode ?? null;
    if (season !== null && episode !== null) {
      if (season === target.season && episode === target.episode) {
        exact.push(toCandidate(item));
      }
    } else if (season !== null) {
      if (season === target.season) packs.push(toCandidate(item));
    } else if (carriesEpisode(item, target.season, target.episode)) {
      exact.push(toCandidate(item));
    }
  }
  return [
    ...filterAndRank(exact, releaseName),
    ...filterAndRank(packs, releaseName),
  ].slice(0, MAX_CANDIDATES_PER_LANGUAGE);
}
