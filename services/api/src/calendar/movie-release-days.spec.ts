import { movieReleaseDays, MovieReleaseDatesRow } from './movie-release-days';
import { MovieReleaseType as T } from '@/movies/entities/movie-release-type.enum';

// This suite exists because every failure in movieReleaseDays is silent: a
// duplicated, missing or misplaced coloured calendar cell, or a release type
// tagged on the wrong day, with no error anywhere. Pure function, no mocks.
const range = {
  from: new Date('2026-10-01T00:00:00Z'),
  toExclusive: new Date('2026-11-01T00:00:00Z'),
};

function row(over: Partial<MovieReleaseDatesRow> = {}): MovieReleaseDatesRow {
  return {
    releaseDate: null,
    theatricalReleaseDate: null,
    digitalReleaseDate: null,
    physicalReleaseDate: null,
    ...over,
  };
}

const d = (s: string) => new Date(`${s}T00:00:00Z`);

describe('movieReleaseDays', () => {
  it('gives three items with one type each for three distinct in-range days', () => {
    expect(
      movieReleaseDays(
        row({
          physicalReleaseDate: d('2026-10-25'),
          theatricalReleaseDate: d('2026-10-05'),
          digitalReleaseDate: d('2026-10-15'),
        }),
        range,
      ),
    ).toEqual([
      { date: '2026-10-05', releaseTypes: [T.THEATRICAL] },
      { date: '2026-10-15', releaseTypes: [T.DIGITAL] },
      { date: '2026-10-25', releaseTypes: [T.PHYSICAL] },
    ]);
  });

  it('merges theatrical and digital on the same day into one item', () => {
    expect(
      movieReleaseDays(
        row({
          theatricalReleaseDate: d('2026-10-05'),
          digitalReleaseDate: d('2026-10-05'),
        }),
        range,
      ),
    ).toEqual([{ date: '2026-10-05', releaseTypes: [T.THEATRICAL, T.DIGITAL] }]);
  });

  it('merges all three on one day in the fixed order', () => {
    expect(
      movieReleaseDays(
        row({
          physicalReleaseDate: d('2026-10-05'),
          digitalReleaseDate: d('2026-10-05'),
          theatricalReleaseDate: d('2026-10-05'),
        }),
        range,
      ),
    ).toEqual([
      { date: '2026-10-05', releaseTypes: [T.THEATRICAL, T.DIGITAL, T.PHYSICAL] },
    ]);
  });

  it('keeps only the in-range item when another typed date is out of range', () => {
    expect(
      movieReleaseDays(
        row({
          theatricalReleaseDate: d('2026-09-30'),
          digitalReleaseDate: d('2026-10-10'),
        }),
        range,
      ),
    ).toEqual([{ date: '2026-10-10', releaseTypes: [T.DIGITAL] }]);
  });

  it('gives zero items when typed dates are all out of range, even with releaseDate in range', () => {
    expect(
      movieReleaseDays(
        row({
          releaseDate: d('2026-10-10'),
          theatricalReleaseDate: d('2026-09-01'),
          physicalReleaseDate: d('2026-12-01'),
        }),
        range,
      ),
    ).toEqual([]);
  });

  it('falls back to releaseDate with empty types when all typed dates are null', () => {
    expect(movieReleaseDays(row({ releaseDate: d('2026-10-10') }), range)).toEqual([
      { date: '2026-10-10', releaseTypes: [] },
    ]);
  });

  it('gives zero items when every date is null', () => {
    expect(movieReleaseDays(row(), range)).toEqual([]);
  });

  it('includes a date equal to from and excludes one equal to toExclusive', () => {
    expect(
      movieReleaseDays(
        row({
          theatricalReleaseDate: range.from,
          digitalReleaseDate: range.toExclusive,
        }),
        range,
      ),
    ).toEqual([{ date: '2026-10-01', releaseTypes: [T.THEATRICAL] }]);
  });
});
