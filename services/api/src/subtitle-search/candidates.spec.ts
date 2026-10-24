// The filter is the only guard between a forced, machine-translated or
// non-SRT candidate and the library file: one that slips through is fetched,
// may even validate, and is embedded with no error anywhere. The ranking
// decides which of the quota-limited fetches are spent, so a lost ordering
// rule silently burns the daily quota on the worst candidates.

import { RemoteSubtitleCandidate } from '@/clients/media-server/types';
import { filterAndRank, releaseSimilarity } from './candidates';

const cand = (
  id: string,
  over: Partial<RemoteSubtitleCandidate> = {},
): RemoteSubtitleCandidate => ({
  id,
  languageIso3: 'spa',
  name: 'Movie.2020.1080p.WEB-DL',
  format: 'srt',
  isForced: false,
  isHearingImpaired: false,
  isMachineTranslated: false,
  isAiTranslated: false,
  isHashMatch: false,
  downloadCount: 0,
  ...over,
});

const ids = (list: RemoteSubtitleCandidate[]) => list.map((c) => c.id);
const RELEASE = 'Movie.2020.1080p.WEB-DL.x264-GRP';

describe('filterAndRank filtering', () => {
  it('drops forced, machine-translated, AI-translated and non-SRT candidates', () => {
    const result = filterAndRank(
      [
        cand('forced', { isForced: true }),
        cand('machine', { isMachineTranslated: true }),
        cand('ai', { isAiTranslated: true }),
        cand('ass', { format: 'ass' }),
        cand('ok'),
      ],
      RELEASE,
    );

    expect(ids(result)).toEqual(['ok']);
  });

  it('matches the SRT format case-insensitively', () => {
    expect(ids(filterAndRank([cand('a', { format: 'SRT' })], RELEASE))).toEqual(
      ['a'],
    );
  });
});

describe('filterAndRank ordering', () => {
  it('puts a hash match before a closer release name', () => {
    const result = filterAndRank(
      [
        cand('close', { name: RELEASE }),
        cand('hash', { name: 'Other', isHashMatch: true }),
      ],
      RELEASE,
    );
    expect(ids(result)).toEqual(['hash', 'close']);
  });

  it('puts the closer release name first', () => {
    const result = filterAndRank(
      [
        cand('far', { name: 'Movie.2020.BluRay.REMUX', downloadCount: 999 }),
        cand('near', { name: 'Movie.2020.1080p.WEB-DL.x264-GRP' }),
      ],
      RELEASE,
    );
    expect(ids(result)).toEqual(['near', 'far']);
  });

  it('puts a non hearing-impaired candidate before a hearing-impaired one of equal similarity', () => {
    const result = filterAndRank(
      [
        cand('hi', { isHearingImpaired: true, downloadCount: 500 }),
        cand('plain'),
      ],
      RELEASE,
    );
    expect(ids(result)).toEqual(['plain', 'hi']);
  });

  it('breaks the remaining tie by download count', () => {
    const result = filterAndRank(
      [cand('few', { downloadCount: 1 }), cand('many', { downloadCount: 50 })],
      RELEASE,
    );
    expect(ids(result)).toEqual(['many', 'few']);
  });

  it('keeps at most 3 candidates', () => {
    const many = ['a', 'b', 'c', 'd', 'e'].map((id, i) =>
      cand(id, { downloadCount: 10 - i }),
    );
    expect(ids(filterAndRank(many, RELEASE))).toEqual(['a', 'b', 'c']);
  });

  it('returns nothing for no candidates', () => {
    expect(filterAndRank([], RELEASE)).toEqual([]);
  });
});

describe('releaseSimilarity', () => {
  it('is the Jaccard index of the lowercase alphanumeric tokens', () => {
    expect(releaseSimilarity('A.B.C', 'a b d')).toBeCloseTo(2 / 4);
    expect(releaseSimilarity('Same.Name', 'same-name')).toBe(1);
  });

  it('is 0 when either name has no tokens', () => {
    expect(releaseSimilarity('', 'abc')).toBe(0);
    expect(releaseSimilarity('...', 'abc')).toBe(0);
  });
});
