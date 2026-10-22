import { MovieReleaseType } from '@/movies/entities/movie-release-type.enum';

export type MovieReleaseDatesRow = {
  releaseDate: Date | null;
  theatricalReleaseDate: Date | null;
  digitalReleaseDate: Date | null;
  physicalReleaseDate: Date | null;
};

export type MovieReleaseRange = { from: Date; toExclusive: Date };

export type MovieReleaseDay = {
  date: string;
  releaseTypes: MovieReleaseType[];
};

// Spec 093, REQ-6
export function movieReleaseDays(
  row: MovieReleaseDatesRow,
  range: MovieReleaseRange,
): MovieReleaseDay[] {
  const inRange = (d: Date) => d >= range.from && d < range.toExclusive;
  const day = (d: Date) => d.toISOString().slice(0, 10);

  const typed: [MovieReleaseType, Date | null][] = [
    [MovieReleaseType.THEATRICAL, row.theatricalReleaseDate],
    [MovieReleaseType.DIGITAL, row.digitalReleaseDate],
    [MovieReleaseType.PHYSICAL, row.physicalReleaseDate],
  ];

  if (typed.some(([, d]) => d !== null)) {
    const buckets = new Map<string, MovieReleaseType[]>();
    for (const [type, d] of typed) {
      if (!d || !inRange(d)) continue;
      const key = day(d);
      const bucket = buckets.get(key);
      if (bucket) bucket.push(type);
      else buckets.set(key, [type]);
    }
    return [...buckets.entries()]
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      .map(([date, releaseTypes]) => ({ date, releaseTypes }));
  }

  if (row.releaseDate && inRange(row.releaseDate)) {
    return [{ date: day(row.releaseDate), releaseTypes: [] }];
  }
  return [];
}
