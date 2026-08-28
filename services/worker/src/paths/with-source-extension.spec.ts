// Defends REQ-10: with compression off, the file that lands in the library
// must carry the source's own container extension, not the `.mkv`
// `buildOutputPath` always produces. A `.mp4` source filed as `Movie
// (2019).mkv` is a mislabelled container — it plays, the job reports
// COMPLETED, and nothing in this pipeline ever fails; only the media server,
// picking a demuxer off the wrong extension, ever complains. A regression
// here — swapping the wrong substring, or mangling a title that itself
// contains a dot — produces exactly that silent failure with no error in any
// log.

import { describe, expect, it } from 'vitest';
import { withSourceExtension } from './with-source-extension';

describe('withSourceExtension', () => {
  it('replaces .mkv with .mp4 for an mp4 source', () => {
    expect(
      withSourceExtension(
        '/library/movies/Some Film (2019) [tmdbid=123]/Some Film (2019).mkv',
        '/downloads/Some.Film.2019.mp4',
      ),
    ).toBe('/library/movies/Some Film (2019) [tmdbid=123]/Some Film (2019).mp4');
  });

  it('replaces .mkv with .avi for an avi source', () => {
    expect(
      withSourceExtension('/library/movies/Film (2020)/Film (2020).mkv', '/downloads/Film.avi'),
    ).toBe('/library/movies/Film (2020)/Film (2020).avi');
  });

  it('keeps .mkv when the source is already .mkv', () => {
    expect(
      withSourceExtension('/library/movies/Film (2020)/Film (2020).mkv', '/downloads/Film.mkv'),
    ).toBe('/library/movies/Film (2020)/Film (2020).mkv');
  });

  it('leaves the output extension untouched when the source has none', () => {
    expect(
      withSourceExtension('/library/movies/Film (2020)/Film (2020).mkv', '/downloads/Film'),
    ).toBe('/library/movies/Film (2020)/Film (2020).mkv');
  });

  it('replaces only the last extension when the base name itself contains a dot', () => {
    expect(
      withSourceExtension(
        '/library/movies/The Super Mario Bros. Movie (2023) [tmdbid=502356]/The Super Mario Bros. Movie (2023).mkv',
        '/downloads/The.Super.Mario.Bros.Movie.2023.mp4',
      ),
    ).toBe(
      '/library/movies/The Super Mario Bros. Movie (2023) [tmdbid=502356]/The Super Mario Bros. Movie (2023).mp4',
    );
  });

  it('leaves the folder and base name untouched, changing only the extension', () => {
    const result = withSourceExtension(
      '/library/shows/Show (2021) [tmdbid=9] [q]/Season 01/Show S01E03 Episode Title.mkv',
      '/downloads/show.s01e03.avi',
    );

    expect(result).toBe(
      '/library/shows/Show (2021) [tmdbid=9] [q]/Season 01/Show S01E03 Episode Title.avi',
    );
  });
});
