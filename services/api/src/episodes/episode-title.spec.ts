import { episodeDisplayTitle } from './episode-title';

// This test exists because otherwise a drift between this definition and the
// zero-padded "<Show> SxxEyy" prefill `web`'s SearchTorrent.tsx builds from
// `seasonNumber`/`episodeNumber` fails with no error anywhere: the conflict
// message a collision throws and the search box the user just used to find
// the release would name the same episode differently, and nothing in this
// service or in `web` would ever notice. Pinning the exact format here is
// the only thing standing between the two staying in sync.
describe('episodeDisplayTitle', () => {
  const show = { title: 'Breaking Bad' };

  it('zero-pads a single-digit season and episode number to two digits each', () => {
    const result = episodeDisplayTitle({
      episodeNumber: 5,
      season: { seasonNumber: 2, show },
    });

    expect(result).toBe('Breaking Bad S02E05');
  });

  it('does not truncate a season or episode number already two digits or more', () => {
    const result = episodeDisplayTitle({
      episodeNumber: 12,
      season: { seasonNumber: 10, show },
    });

    expect(result).toBe('Breaking Bad S10E12');
  });

  it('pads a zero season or episode number rather than rendering it bare', () => {
    const result = episodeDisplayTitle({
      episodeNumber: 1,
      season: { seasonNumber: 0, show },
    });

    expect(result).toBe('Breaking Bad S00E01');
  });
});
