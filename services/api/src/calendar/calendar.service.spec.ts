import { CalendarService } from './calendar.service';
import type { CalendarEpisodeRow } from './group-episodes';

// This test exists because a disabled media type leaking into the calendar,
// a short listed while shorts are off, a release date shifted by the server
// timezone, or unstable ordering all produce a plausible-looking month with
// no error anywhere. The collaborators are stubbed at the service boundary
// (Prisma reads are covered in the movies/shows specs); everything else,
// including range parsing and grouping, runs for real.
describe('CalendarService', () => {
  const from = new Date('2026-09-01T00:00:00Z');
  type Caps = { moviesEnabled: boolean; showsEnabled: boolean; shortsEnabled: boolean };

  const film = (id: number, title: string, releaseDate: string, isShort = false) => ({
    id,
    title,
    isShort,
    releaseDate: new Date(releaseDate),
    status: 'COMPLETED',
  });
  const episode = (n: number, releaseDate: string, showId = 1, showTitle = 'Show', season = 1): CalendarEpisodeRow => ({
    showId,
    showTitle,
    seasonNumber: season,
    episodeNumber: n,
    episodeTitle: `Ep ${n}`,
    releaseDate: new Date(releaseDate),
    status: 'MISSING',
  });

  function build(caps: Caps, movies: ReturnType<typeof film>[], episodes: CalendarEpisodeRow[]) {
    const moviesService = { findReleasedBetween: jest.fn().mockResolvedValue(movies) };
    const showsService = { findEpisodesReleasedBetween: jest.fn().mockResolvedValue(episodes) };
    const capabilities = { read: jest.fn().mockResolvedValue(caps) };
    const service = new CalendarService(moviesService as never, showsService as never, capabilities as never);
    return { service, moviesService, showsService, capabilities };
  }

  const all: Caps = { moviesEnabled: true, showsEnabled: true, shortsEnabled: true };
  const movies = [film(1, 'Film', '2026-09-10T00:00:00Z'), film(2, 'Short', '2026-09-10T00:00:00Z', true)];
  const episodes = [episode(1, '2026-09-10T00:00:00Z')];

  it('lists films, shorts and episode groups when everything is enabled', async () => {
    const { service, capabilities } = build(all, movies, episodes);
    const result = await service.list('u1', '2026-09-01', '2026-09-30');
    expect(result.map((e) => [e.kind, e.title])).toEqual([
      ['MOVIE', 'Film'],
      ['SHORT', 'Short'],
      ['EPISODES', 'Show'],
    ]);
    expect(capabilities.read).toHaveBeenCalledTimes(1);
  });

  it('omits films and never queries them when movies are disabled', async () => {
    const { service, moviesService } = build(
      { moviesEnabled: false, showsEnabled: true, shortsEnabled: false },
      movies,
      episodes,
    );
    const result = await service.list('u1', '2026-09-01', '2026-09-30');
    expect(result.map((e) => e.kind)).toEqual(['EPISODES']);
    expect(moviesService.findReleasedBetween).not.toHaveBeenCalled();
  });

  it('omits episodes and never queries them when shows are disabled', async () => {
    const { service, showsService } = build(
      { moviesEnabled: true, showsEnabled: false, shortsEnabled: true },
      movies,
      episodes,
    );
    const result = await service.list('u1', '2026-09-01', '2026-09-30');
    expect(result.map((e) => e.kind)).toEqual(['MOVIE', 'SHORT']);
    expect(showsService.findEpisodesReleasedBetween).not.toHaveBeenCalled();
  });

  it('drops shorts but keeps films when shorts are disabled and movies enabled', async () => {
    const { service } = build({ moviesEnabled: true, showsEnabled: true, shortsEnabled: false }, movies, episodes);
    const result = await service.list('u1', '2026-09-01', '2026-09-30');
    expect(result.map((e) => e.kind)).toEqual(['MOVIE', 'EPISODES']);
  });

  it('returns nothing when both types are disabled', async () => {
    const { service } = build({ moviesEnabled: false, showsEnabled: false, shortsEnabled: false }, movies, episodes);
    expect(await service.list('u1', '2026-09-01', '2026-09-30')).toEqual([]);
  });

  it('reads a UTC-midnight release as the same calendar day', async () => {
    const { service } = build(all, [film(1, 'Film', '2026-09-19T00:00:00Z')], []);
    const [entry] = await service.list('u1', '2026-09-01', '2026-09-30');
    expect(entry.date).toBe('2026-09-19');
  });

  it('passes the parsed inclusive range to both reads', async () => {
    const { service, moviesService, showsService } = build(all, [], []);
    await service.list('u1', '2026-09-01', '2026-09-30');
    const end = new Date('2026-10-01T00:00:00Z');
    expect(moviesService.findReleasedBetween).toHaveBeenCalledWith('u1', from, end);
    expect(showsService.findEpisodesReleasedBetween).toHaveBeenCalledWith('u1', from, end);
  });

  it('orders by date, then title, then season and first episode', async () => {
    const eps = [
      episode(5, '2026-09-10T00:00:00Z', 1, 'Show', 2),
      episode(1, '2026-09-10T00:00:00Z', 1, 'Show', 1),
      episode(1, '2026-09-09T00:00:00Z', 2, 'Zed'),
    ];
    const { service } = build(all, [film(1, 'Film', '2026-09-10T00:00:00Z')], eps);
    const result = await service.list('u1', '2026-09-01', '2026-09-30');
    expect(result.map((e) => [e.date, e.title, e.seasonNumber ?? null])).toEqual([
      ['2026-09-09', 'Zed', 1],
      ['2026-09-10', 'Film', null],
      ['2026-09-10', 'Show', 1],
      ['2026-09-10', 'Show', 2],
    ]);
  });

  it('propagates range errors before reading capabilities or the database', async () => {
    const { service, capabilities, moviesService } = build(all, [], []);
    await expect(service.list('u1', '2026-09-01', '2026-12-31')).rejects.toMatchObject({
      response: { i18n: { key: 'error.calendar.invalid_range' } },
    });
    await expect(service.list('u1', '2026-13-01', '2026-13-30')).rejects.toBeDefined();
    expect(capabilities.read).not.toHaveBeenCalled();
    expect(moviesService.findReleasedBetween).not.toHaveBeenCalled();
  });
});
