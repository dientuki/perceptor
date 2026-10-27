// The filter is the only guard between a forced, machine-translated or
// non-SRT candidate and the library file: one that slips through is fetched,
// may even validate, and is embedded with no error anywhere. The ranking
// decides which of the quota-limited fetches are spent, so a lost ordering
// rule silently burns the daily quota on the worst candidates.

import {
  SubtitleCandidate,
  filterAndRank,
  releaseSimilarity,
} from './candidates';

const cand = (
  id: string,
  over: Partial<SubtitleCandidate> = {},
): SubtitleCandidate => ({
  id,
  release: 'Movie.2020.1080p.WEB-DL',
  fileCount: 1,
  hearingImpaired: false,
  foreignPartsOnly: false,
  machineTranslated: false,
  aiTranslated: false,
  hashMatch: false,
  downloadCount: 0,
  ...over,
});

const ids = (list: SubtitleCandidate[]) => list.map((c) => c.id);
const RELEASE = 'Movie.2020.1080p.WEB-DL.x264-GRP';

describe('filterAndRank filtering', () => {
  it('drops foreign-parts-only, machine-translated, AI-translated and multi-file candidates', () => {
    const result = filterAndRank(
      [
        cand('forced', { foreignPartsOnly: true }),
        cand('machine', { machineTranslated: true }),
        cand('ai', { aiTranslated: true }),
        cand('two', { fileCount: 2 }),
        cand('ok'),
      ],
      RELEASE,
    );

    expect(ids(result)).toEqual(['ok']);
  });
});

describe('filterAndRank ordering', () => {
  it('drops a two-file result even when it would rank first', () => {
    const result = filterAndRank(
      [
        cand('pack', { fileCount: 2, release: RELEASE, hashMatch: true }),
        cand('single', { release: 'Other' }),
      ],
      RELEASE,
    );
    expect(ids(result)).toEqual(['single']);
  });

  it('puts a hash match before a closer release name', () => {
    const result = filterAndRank(
      [
        cand('close', { release: RELEASE }),
        cand('hash', { release: 'Other', hashMatch: true }),
      ],
      RELEASE,
    );
    expect(ids(result)).toEqual(['hash', 'close']);
  });

  it('puts the closer release name first', () => {
    const result = filterAndRank(
      [
        cand('far', { release: 'Movie.2020.BluRay.REMUX', downloadCount: 999 }),
        cand('near', { release: 'Movie.2020.1080p.WEB-DL.x264-GRP' }),
      ],
      RELEASE,
    );
    expect(ids(result)).toEqual(['near', 'far']);
  });

  it('puts a non hearing-impaired candidate before a hearing-impaired one of equal similarity', () => {
    const result = filterAndRank(
      [
        cand('hi', { hearingImpaired: true, downloadCount: 500 }),
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
