import {
  CalendarEpisodeRow,
  groupEpisodes,
  groupStatus,
} from './group-episodes';
import { PipelineStatus } from '@/pipeline-status/pipeline-status';

// This suite exists because a grouped calendar entry collapses several
// episodes into one coloured cell: if the group status or counts are wrong,
// a failed episode hides behind a green group or a partial premiere reads as
// done, and nothing anywhere raises an error. Pure functions, no fixtures to mock.
function row(
  episodeNumber: number,
  status: PipelineStatus,
  over: Partial<CalendarEpisodeRow> = {},
): CalendarEpisodeRow {
  return {
    showId: 1,
    showTitle: 'Reacher',
    seasonNumber: 1,
    episodeNumber,
    episodeTitle: `Episode ${episodeNumber}`,
    releaseDate: new Date('2026-09-19T00:00:00Z'),
    status,
    ...over,
  };
}

describe('groupStatus', () => {
  it('is ERROR when any member is ERROR, even among COMPLETED', () => {
    expect(groupStatus(['COMPLETED', 'ERROR', 'COMPLETED'])).toBe('ERROR');
  });

  it('lets ERROR beat an in-progress member', () => {
    expect(groupStatus(['ENCODING', 'ERROR'])).toBe('ERROR');
  });

  it('picks the most advanced in-progress status present', () => {
    expect(groupStatus(['QUEUED', 'DOWNLOADING', 'PAUSED'])).toBe(
      'DOWNLOADING',
    );
    expect(groupStatus(['DOWNLOADED', 'ENCODING', 'QUEUED'])).toBe('ENCODING');
  });

  it('lets in-progress beat COMPLETED and MISSING', () => {
    expect(groupStatus(['COMPLETED', 'MISSING', 'QUEUED'])).toBe('QUEUED');
  });

  it('is COMPLETED only when every member is COMPLETED', () => {
    expect(groupStatus(['COMPLETED', 'COMPLETED'])).toBe('COMPLETED');
  });

  it('is MISSING for COMPLETED mixed with MISSING', () => {
    expect(groupStatus(['COMPLETED', 'MISSING'])).toBe('MISSING');
  });

  it('is MISSING when everything is MISSING', () => {
    expect(groupStatus(['MISSING', 'MISSING'])).toBe('MISSING');
  });
});

describe('groupEpisodes', () => {
  it('counts completed members and keeps a partial group MISSING', () => {
    const [g] = groupEpisodes([
      row(1, 'COMPLETED'),
      row(2, 'MISSING'),
      row(3, 'MISSING'),
    ]);
    expect(g.status).toBe('MISSING');
    expect(g.episodeCount).toBe(3);
    expect(g.completedCount).toBe(1);
  });

  it('groups a same-day premiere and leaves weekly episodes as singles', () => {
    const weekly = (n: number, day: number) =>
      row(n, 'MISSING', {
        releaseDate: new Date(`2026-09-${day}T00:00:00Z`),
      });
    const groups = groupEpisodes([
      row(1, 'COMPLETED'),
      row(3, 'COMPLETED'),
      row(2, 'COMPLETED'),
      weekly(4, 26),
      weekly(5, 27),
    ]);
    expect(groups).toHaveLength(3);
    const premiere = groups.find((g) => g.episodeCount === 3)!;
    expect(premiere.firstEpisodeNumber).toBe(1);
    expect(premiere.lastEpisodeNumber).toBe(3);
    expect(premiere.completedCount).toBe(3);
    expect(premiere.status).toBe('COMPLETED');
    expect(premiere.episodeTitle).toBeNull();
    const singles = groups.filter((g) => g.episodeCount === 1);
    expect(singles.map((g) => g.episodeTitle)).toEqual([
      'Episode 4',
      'Episode 5',
    ]);
    expect(singles.every((g) => g.firstEpisodeNumber === g.lastEpisodeNumber)).toBe(
      true,
    );
  });

  it('keeps two seasons of one show on the same day apart', () => {
    const groups = groupEpisodes([
      row(1, 'MISSING'),
      row(1, 'MISSING', { seasonNumber: 2 }),
    ]);
    expect(groups.map((g) => g.seasonNumber).sort()).toEqual([1, 2]);
  });

  it('keeps two shows on the same day apart', () => {
    const groups = groupEpisodes([
      row(1, 'MISSING'),
      row(1, 'MISSING', { showId: 2, showTitle: 'Other' }),
    ]);
    expect(groups).toHaveLength(2);
  });

  it('uses the UTC day, not the local one', () => {
    const groups = groupEpisodes([
      row(1, 'MISSING', { releaseDate: new Date('2026-09-19T23:59:59Z') }),
      row(2, 'MISSING', { releaseDate: new Date('2026-09-20T00:00:00Z') }),
    ]);
    expect(groups.map((g) => g.date).sort()).toEqual([
      '2026-09-19',
      '2026-09-20',
    ]);
  });
});
