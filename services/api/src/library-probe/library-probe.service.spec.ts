import { LibraryProbeService } from './library-probe.service';

// This suite exists because the stored track languages decide what the library page shows and what
// the user is told is missing: a report for a file that has since been replaced, a sidecar counted
// twice, or a never-read title requested forever would each write or show wrong languages with no
// error anywhere. The prisma double evaluates the real `where` against an in-memory row, so a
// dropped guard fails here instead of passing against a mock that ignores it.
type Row = {
  id: number;
  filePath: string | null;
  mediaServerPresentAt: Date | null;
  tracksReadAt: Date | null;
  fileAudioLanguages: unknown;
  fileSubtitleLanguages: unknown;
  tmdbId?: number;
};

function matches(row: Row, where: Record<string, any>): boolean {
  if (where.id !== undefined && row.id !== where.id) return false;
  if (where.OR && !where.OR.some((arm: Record<string, any>) => matches(row, arm))) {
    return false;
  }
  for (const key of ['filePath', 'mediaServerPresentAt', 'tracksReadAt'] as const) {
    if (!(key in where)) continue;
    const want = where[key];
    const have = row[key];
    if (want === null ? have !== null : typeof want === 'object' && 'not' in want ? have === null : have !== want) {
      return false;
    }
  }
  return true;
}

describe('LibraryProbeService', () => {
  let rows: Row[];
  let languages: { tag: string; iso2: string; iso3: string }[];
  let location: { locate: jest.Mock };
  let queue: { request: jest.Mock };
  let languageFind: jest.Mock;
  let service: LibraryProbeService;

  const row = (over: Partial<Row>): Row => ({
    id: 1,
    filePath: '/lib/a.mkv',
    mediaServerPresentAt: null,
    tracksReadAt: null,
    fileAudioLanguages: null,
    fileSubtitleLanguages: null,
    tmdbId: 7,
    ...over,
  });

  beforeEach(() => {
    rows = [row({})];
    languages = [{ tag: 'es', iso2: 'es', iso3: 'spa' }];
    location = { locate: jest.fn() };
    queue = { request: jest.fn().mockResolvedValue(undefined) };
    languageFind = jest.fn(() => Promise.resolve(languages));
    const table = {
      findUnique: jest.fn(({ where }: any) =>
        Promise.resolve(rows.find((r) => r.id === where.id) ?? null),
      ),
      findMany: jest.fn(({ where }: any) =>
        Promise.resolve(rows.filter((r) => matches(r, where))),
      ),
      updateMany: jest.fn(({ where, data }: any) => {
        const hit = rows.filter((r) => matches(r, where));
        hit.forEach((r) => Object.assign(r, data));
        return Promise.resolve({ count: hit.length });
      }),
    };
    const prisma = {
      movie: table,
      episode: {
        ...table,
        findUnique: jest.fn(({ where }: any) => {
          const r = rows.find((x) => x.id === where.id);
          return Promise.resolve(
            r && { ...r, episodeNumber: 3, season: { seasonNumber: 2, show: { tmdbId: 9 } } },
          );
        }),
      },
      language: { findMany: languageFind },
    };
    service = new LibraryProbeService(prisma as never, location as never, queue as never);
  });

  describe('details', () => {
    it('rejects neither or both ids', async () => {
      await expect(service.details({})).rejects.toMatchObject({
        response: { i18n: { key: 'error.libraryProbe.invalid_target' } },
      });
      await expect(service.details({ movieId: 1, episodeId: 1 })).rejects.toMatchObject({
        response: { i18n: { key: 'error.libraryProbe.invalid_target' } },
      });
    });

    it('prefers the stored filePath over the media server', async () => {
      rows[0].mediaServerPresentAt = new Date();
      await expect(service.details({ movieId: 1 })).resolves.toEqual({ filePath: '/lib/a.mkv' });
      expect(location.locate).not.toHaveBeenCalled();
    });

    it('locates a media-server-only title', async () => {
      rows[0] = row({ filePath: null, mediaServerPresentAt: new Date() });
      location.locate.mockResolvedValue({ path: '/lib/b.mkv' });
      await expect(service.details({ movieId: 1 })).resolves.toEqual({ filePath: '/lib/b.mkv' });
      expect(location.locate).toHaveBeenCalledWith({ kind: 'movie', tmdbId: 7 });
    });

    it('passes season and episode numbers for an episode', async () => {
      rows[0] = row({ filePath: null, mediaServerPresentAt: new Date() });
      location.locate.mockResolvedValue({ path: '/lib/e.mkv' });
      await service.details({ episodeId: 1 });
      expect(location.locate).toHaveBeenCalledWith({
        kind: 'episode',
        tmdbId: 9,
        seasonNumber: 2,
        episodeNumber: 3,
      });
    });

    it('maps unavailable to media_server_unavailable and other reasons to not_found', async () => {
      rows[0] = row({ filePath: null, mediaServerPresentAt: new Date() });
      location.locate.mockResolvedValue({ reason: 'unavailable' });
      await expect(service.details({ movieId: 1 })).rejects.toMatchObject({
        response: { i18n: { key: 'error.libraryProbe.media_server_unavailable' } },
      });
      location.locate.mockResolvedValue({ reason: 'outside_library' });
      await expect(service.details({ movieId: 1 })).rejects.toMatchObject({
        response: { i18n: { key: 'error.libraryProbe.not_found' } },
      });
    });

    it('is not_found without a file, without asking the media server', async () => {
      rows[0] = row({ filePath: null });
      await expect(service.details({ movieId: 1 })).rejects.toMatchObject({
        response: { i18n: { key: 'error.libraryProbe.not_found' } },
      });
      await expect(service.details({ movieId: 99 })).rejects.toMatchObject({
        response: { i18n: { key: 'error.libraryProbe.not_found' } },
      });
      expect(location.locate).not.toHaveBeenCalled();
    });
  });

  describe('completed', () => {
    it('stores one spa when an embedded and a sidecar track agree, in embedded-first order', async () => {
      await expect(
        service.completed({ movieId: 1 }, '/lib/a.mkv', ['eng', 'eng'], ['spa', 'eng'], ['es']),
      ).resolves.toBe(true);
      expect(rows[0].fileAudioLanguages).toEqual(['eng']);
      expect(rows[0].fileSubtitleLanguages).toEqual(['spa', 'eng']);
      expect(rows[0].tracksReadAt).toBeInstanceOf(Date);
    });

    it('drops a sidecar tag that resolves to no language', async () => {
      await service.completed({ movieId: 1 }, '/lib/a.mkv', [], ['eng'], ['zz-nonsense']);
      expect(rows[0].fileSubtitleLanguages).toEqual(['eng']);
    });

    it('does not load languages when there are no sidecar tags', async () => {
      await service.completed({ movieId: 1 }, '/lib/a.mkv', [], [], []);
      expect(languageFind).not.toHaveBeenCalled();
    });

    it('discards a report for a path that is no longer the title file', async () => {
      await expect(
        service.completed({ movieId: 1 }, '/lib/old.mkv', ['eng'], [], []),
      ).resolves.toBe(false);
      expect(rows[0].tracksReadAt).toBeNull();
      expect(rows[0].fileAudioLanguages).toBeNull();
    });

    it('accepts a located path while the title has no filePath but the server holds it', async () => {
      rows[0] = row({ filePath: null, mediaServerPresentAt: new Date() });
      await expect(
        service.completed({ movieId: 1 }, '/lib/b.mkv', ['eng'], [], []),
      ).resolves.toBe(true);
    });

    it('does not accept a located path once the title has its own filePath', async () => {
      rows[0] = row({ filePath: '/lib/a.mkv', mediaServerPresentAt: new Date() });
      await expect(
        service.completed({ movieId: 1 }, '/lib/other.mkv', ['eng'], [], []),
      ).resolves.toBe(false);
    });

    it('stores an empty read as [] and not null', async () => {
      await service.completed({ movieId: 1 }, '/lib/a.mkv', [], [], []);
      expect(rows[0].fileAudioLanguages).toEqual([]);
      expect(rows[0].fileSubtitleLanguages).toEqual([]);
    });

    it('resolves false for a missing title', async () => {
      await expect(service.completed({ movieId: 99 }, '/x', [], [], [])).resolves.toBe(false);
    });
  });

  describe('backfill', () => {
    it('requests only titles that hold a file and were never read', async () => {
      rows = [
        row({ id: 1 }),
        row({ id: 2, tracksReadAt: new Date() }),
        row({ id: 3, filePath: null }),
        row({ id: 4, filePath: null, mediaServerPresentAt: new Date() }),
      ];
      await service.backfill();
      const requested = queue.request.mock.calls.map((c) => c[0]);
      expect(requested).toEqual(
        expect.arrayContaining([{ movieId: 1 }, { movieId: 4 }, { episodeId: 1 }, { episodeId: 4 }]),
      );
      expect(requested).toHaveLength(4);
    });
  });
});
