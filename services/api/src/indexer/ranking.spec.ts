import type { TorrentResult } from '@/clients/indexer/types';
import { RankingContext, rankTorrentResults } from './ranking';

// This comparator picks the release the nightly sweep downloads with nobody
// watching. A criterion that drifts while being moved between services (a
// regex, a veto, a line swapped in the comparator) still yields a plausible
// ordering: the modal looks fine and the wrong release is fetched forever
// with no error anywhere. Every case below pins one rule with real release
// names, so removing or reordering that rule turns exactly one case red.
function release(
  title: string,
  overrides: Partial<TorrentResult> = {},
): TorrentResult {
  return {
    id: title,
    infoHash: null,
    title,
    size: 1_000,
    seeders: 10,
    leechers: 1,
    items: [],
    infoUrl: [],
    ...overrides,
  };
}

const UNARMED: RankingContext = {
  languageRequirement: null,
  preferredGroups: [],
  allowCinemaReleases: true,
};

function spanishRequired(): RankingContext {
  return {
    ...UNARMED,
    languageRequirement: {
      mandatory: true,
      languages: [{ iso2: 'es', iso3: 'spa' }],
    },
  };
}

function ordered(results: TorrentResult[], context: RankingContext) {
  return rankTorrentResults(results, context)
    .filter((r) => r.candidate)
    .sort((a, b) => a.candidateRank! - b.candidateRank!)
    .map((r) => r.title);
}

describe('rankTorrentResults', () => {
  it('returns every row in input order with vetoed ones marked as non-candidates', () => {
    const input = [
      release('Show.S01E01.1080p.WEB-DL.x264-GRP'),
      release('Show.S01E01.1080p.WEB-DL.AV1-GRP'),
      release('Show.S01E01.1080p.WEB-DL.x264-DEAD', { seeders: 0, leechers: 2 }),
      release('Show.S01E01.1080p.AI.Upscale.WEB-DL.x264-GRP'),
    ];

    const out = rankTorrentResults(input, UNARMED);

    expect(out.map((r) => r.title)).toEqual(input.map((r) => r.title));
    expect(out.map((r) => r.candidate)).toEqual([true, false, false, false]);
    expect(out.map((r) => r.candidateRank)).toEqual([1, null, null, null]);
  });

  it('vetoes a cinema capture only when cinema releases are not allowed', () => {
    const input = [
      release('Movie.2026.1080p.HDCAM.x264-GRP'),
      release('Movie.2026.720p.WEB-DL.x264-GRP'),
    ];

    const blocked = rankTorrentResults(input, {
      ...UNARMED,
      allowCinemaReleases: false,
    });
    const allowed = rankTorrentResults(input, UNARMED);

    expect(blocked.map((r) => r.candidate)).toEqual([false, true]);
    expect(allowed.map((r) => r.candidate)).toEqual([true, false]);
  });

  it('does not let a vetoed 2160p row set the tier for the survivors', () => {
    const out = rankTorrentResults(
      [
        release('Show.S01E01.2160p.WEB-DL.AV1-GRP'),
        release('Show.S01E01.2160p.Upscaled.WEB-DL.x265-GRP'),
        release('Show.S01E01.1080p.WEB-DL.x264-GRP'),
        release('Show.S01E01.720p.WEB-DL.x264-GRP'),
      ],
      UNARMED,
    );

    expect(out.map((r) => r.candidate)).toEqual([false, false, true, false]);
  });

  it('keeps only the best resolution tier among survivors as candidates', () => {
    const out = rankTorrentResults(
      [
        release('Show.S01E01.720p.BluRay.Remux.x264-GRP'),
        release('Show.S01E01.1080p.HDRip.x264-GRP'),
      ],
      UNARMED,
    );

    expect(out.map((r) => r.candidateRank)).toEqual([null, 1]);
  });

  it('returns no candidates and throws nothing when every row is vetoed', () => {
    const out = rankTorrentResults(
      [
        release('Show.S01E01.1080p.WEB-DL.AV1-GRP'),
        release('Show.S01E01.1080p.WEB-DL.VP9-GRP', { seeders: 0, leechers: 0 }),
      ],
      UNARMED,
    );

    expect(out).toHaveLength(2);
    expect(out.every((r) => !r.candidate && r.candidateRank === null)).toBe(true);
    expect(rankTorrentResults([], UNARMED)).toEqual([]);
  });

  it('ranks a preferred group above a better source at the same resolution', () => {
    const titles = ordered(
      [
        release('Show.S01E01.1080p.BluRay.Remux.x264-OTHER'),
        release('Show.S01E01.1080p.WEB-DL.x264-NTB'),
      ],
      UNARMED,
    );

    expect(titles[0]).toBe('Show.S01E01.1080p.WEB-DL.x264-NTB');
  });

  it('uses the caller preferred groups instead of the defaults when given', () => {
    const input = [
      release('Show.S01E01.1080p.WEB-DL.x264-NTB'),
      release('Show.S01E01.1080p.WEB-DL.x264-MYGROUP'),
    ];

    const titles = ordered(input, { ...UNARMED, preferredGroups: ['MyGroup'] });

    expect(titles[0]).toBe('Show.S01E01.1080p.WEB-DL.x264-MYGROUP');
  });

  it('ranks source above codec, audio and size', () => {
    const titles = ordered(
      [
        release('Show.S01E01.1080p.WEBRip.x265.TrueHD.Atmos-GRP', { size: 9_000 }),
        release('Show.S01E01.1080p.WEB-DL.x264-GRP', { size: 1 }),
      ],
      UNARMED,
    );

    expect(titles[0]).toBe('Show.S01E01.1080p.WEB-DL.x264-GRP');
  });

  it('ranks a remux above an untagged UHD BluRay', () => {
    const titles = ordered(
      [
        release('Movie.2026.2160p.UHD.BluRay.x265-GRP'),
        release('Movie.2026.2160p.BluRay.Remux-GRP'),
      ],
      UNARMED,
    );

    expect(titles[0]).toBe('Movie.2026.2160p.BluRay.Remux-GRP');
  });

  it('skips codec and audio between two 4K disc sources (AC-22)', () => {
    const terse = release('Movie.2026.2160p.UHD.BluRay.Remux-GRP', {
      size: 5_000,
    });
    const verbose = release(
      'Movie.2026.2160p.UHD.BluRay.Remux.x265.TrueHD.Atmos-GRP',
      { size: 1_000 },
    );

    expect(ordered([verbose, terse], UNARMED)[0]).toBe(terse.title);
  });

  it('compares codec between two 1080p disc sources, AVC leading a larger HEVC (AC-21)', () => {
    const avc = release('Movie.2026.1080p.BluRay.x264-GRP', { size: 1_000 });
    const hevc = release('Movie.2026.1080p.BluRay.x265-GRP', { size: 5_000 });

    expect(ordered([hevc, avc], UNARMED)).toEqual([avc.title, hevc.title]);
  });

  it('prefers AVC over a larger HEVC between two 1080p web sources (AC-19)', () => {
    const avc = release('Show.S01E01.1080p.WEB-DL.x264-GRP', { size: 1_000 });
    const hevc = release('Show.S01E01.1080p.WEB-DL.x265-GRP', { size: 5_000 });

    expect(ordered([hevc, avc], UNARMED)[0]).toBe(avc.title);
  });

  it('still prefers a smaller HEVC over AVC between two 2160p web sources (AC-20)', () => {
    const avc = release('Show.S01E01.2160p.WEB-DL.x264-GRP', { size: 5_000 });
    const hevc = release('Show.S01E01.2160p.WEB-DL.x265-GRP', { size: 1_000 });

    expect(ordered([avc, hevc], UNARMED)[0]).toBe(hevc.title);
  });

  it('orders x264, untagged, x265 at 1080p BluRay whatever the sizes (AC-23)', () => {
    const avc = release('Movie.2026.1080p.BluRay.x264-GRP', { size: 1_000 });
    const untagged = release('Movie.2026.1080p.BluRay-GRP', { size: 3_000 });
    const hevc = release('Movie.2026.1080p.BluRay.x265-GRP', { size: 5_000 });

    expect(ordered([hevc, untagged, avc], UNARMED)).toEqual([
      avc.title,
      untagged.title,
      hevc.title,
    ]);
  });

  it('reports codecRank 3 for 1080p x264 and for 2160p x265', () => {
    const out = rankTorrentResults(
      [
        release('Movie.2026.1080p.WEB-DL.x264-GRP'),
        release('Movie.2026.2160p.WEB-DL.x265-GRP'),
      ],
      UNARMED,
    );

    expect(out[0].ranking.codecRank).toBe(3);
    expect(out[1].ranking.codecRank).toBe(3);
  });

  it('breaks a full tie by size, then seeders, then fewer leechers, then input order', () => {
    const big = release('Show.S01E01.1080p.WEB-DL.x264-A', { size: 2 });
    const small = release('Show.S01E01.1080p.WEB-DL.x264-B', { size: 1 });
    expect(ordered([small, big], UNARMED)).toEqual([big.title, small.title]);

    const seeded = release('Show.S01E01.1080p.WEB-DL.x264-C', { seeders: 50 });
    const lean = release('Show.S01E01.1080p.WEB-DL.x264-D', { seeders: 5 });
    expect(ordered([lean, seeded], UNARMED)).toEqual([seeded.title, lean.title]);

    const fewer = release('Show.S01E01.1080p.WEB-DL.x264-E', { leechers: 1 });
    const more = release('Show.S01E01.1080p.WEB-DL.x264-F', { leechers: 9 });
    expect(ordered([more, fewer], UNARMED)).toEqual([fewer.title, more.title]);

    const first = release('Show.S01E01.1080p.WEB-DL.x264-G');
    const second = release('Show.S01E01.1080p.WEB-DL.x264-H');
    expect(ordered([first, second], UNARMED)).toEqual([first.title, second.title]);
  });

  it('gives candidateRank 1 to the row the comparator sorts first', () => {
    const out = rankTorrentResults(
      [
        release('Show.S01E01.1080p.HDRip.x264-GRP'),
        release('Show.S01E01.1080p.WEB-DL.x265-GRP'),
        release('Show.S01E01.1080p.WEBRip.x265-GRP'),
      ],
      UNARMED,
    );

    expect(out.map((r) => r.candidateRank)).toEqual([3, 1, 2]);
  });

  it('promotes a release advertising the required language one source step', () => {
    const out = rankTorrentResults(
      [
        release('Show.S01E01.1080p.WEBRip.x264.Latino-GRP'),
        release('Show.S01E01.1080p.WEB-DL.x264-GRP'),
      ],
      spanishRequired(),
    );

    expect(out[0].ranking.sourceRank).toBe(4);
    expect(out[0].ranking.sourcePromoted).toBe(true);
    expect(out[0].ranking.sourceLabel).toBe('WEBRip');
    expect(out[0].ranking.matchedLanguage).toBe('SPA');
    expect(out[0].candidateRank).toBe(1);
  });

  it('never promotes across a source family ceiling', () => {
    const out = rankTorrentResults(
      [release('Show.S01E01.1080p.WEB-DL.x264.Latino-GRP')],
      spanishRequired(),
    );

    expect(out[0].ranking.sourceRank).toBe(4);
    expect(out[0].ranking.sourcePromoted).toBe(false);
    expect(out[0].ranking.matchedLanguage).toBe('SPA');
  });

  it('does not treat MULTI as advertising the required language', () => {
    const out = rankTorrentResults(
      [release('Show.S01E01.1080p.WEBRip.x264.MULTI-GRP')],
      spanishRequired(),
    );

    expect(out[0].ranking.matchedLanguage).toBeNull();
  });

  it('leaves the ranking untouched when the requirement is not armed', () => {
    const optional: RankingContext = {
      ...UNARMED,
      languageRequirement: {
        mandatory: false,
        languages: [{ iso2: 'es', iso3: 'spa' }],
      },
    };

    const out = rankTorrentResults(
      [release('Show.S01E01.1080p.WEBRip.x264.Latino-GRP')],
      optional,
    );

    expect(out[0].ranking.matchedLanguage).toBeNull();
    expect(out[0].ranking.sourcePromoted).toBe(false);
  });

  it('still prefers the language match between two disc sources', () => {
    const english = release('Movie.2026.1080p.UHD.BluRay.Remux-GRP', { size: 9_000 });
    const spanish = release('Movie.2026.1080p.UHD.BluRay.Remux.Castellano-GRP', {
      size: 1_000,
    });

    expect(ordered([english, spanish], spanishRequired())[0]).toBe(spanish.title);
  });

  it('does not match a language token inside a longer word', () => {
    const out = rankTorrentResults(
      [release('Show.S01E01.1080p.WEBRip.x264.Translated-GRP')],
      spanishRequired(),
    );

    expect(out[0].ranking.matchedLanguage).toBeNull();
  });

  it('reads a BDRemux as a remux and DS4K as 1080p', () => {
    const out = rankTorrentResults(
      [release('Movie.2026.DS4K.1080p.UHD.BDRemux-GRP')],
      UNARMED,
    );

    expect(out[0].ranking.sourceRank).toBe(8);
    expect(out[0].ranking.resolutionTier).toBe(4);
  });

  it('drops rows below minSourceRank before the best tier is chosen', () => {
    const input = [
      release('Movie.2026.2160p.WEB-DL.x265-GRP'),
      release('Movie.2026.1080p.BluRay.REMUX.x264-GRP'),
    ];

    const out = rankTorrentResults(input, { ...UNARMED, minSourceRank: 6 });

    expect(out.map((r) => r.candidateRank)).toEqual([null, 1]);
  });

  it('ranks identically when minSourceRank is absent, null or zero', () => {
    const input = [
      release('Movie.2026.2160p.WEB-DL.x265-GRP'),
      release('Movie.2026.1080p.BluRay.REMUX.x264-GRP'),
    ];

    const baseline = rankTorrentResults(input, UNARMED);

    expect(baseline.map((r) => r.candidateRank)).toEqual([1, null]);
    expect(
      rankTorrentResults(input, { ...UNARMED, minSourceRank: null }),
    ).toEqual(baseline);
    expect(
      rankTorrentResults(input, { ...UNARMED, minSourceRank: 0 }),
    ).toEqual(baseline);
  });
});
