import {
  mkdir,
  mkdtemp,
  readdir,
  rm,
  stat,
  utimes,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { MediaRootsService } from '@/media-roots/media-roots.service';
import { ActiveEmbedGuard } from '@/subtitle-embed/active-embed.guard';
import { SubtitleEmbedService } from '@/subtitle-embed/subtitle-embed.service';
import { ERROR_KEYS } from '@/i18n/error-keys';
import { i18nError } from '@/i18n/i18n-error';
import { OpenSubtitlesHttpError } from '@/clients/opensubtitles/errors';
import { SubtitleCandidate } from './candidates';
import { SubtitleSearchDriver } from './subtitle-search.driver';
import { SubtitleSearchStaging } from './staging';

type Row = Record<string, unknown>;

const HOUR_MS = 60 * 60 * 1000;
const MINUTE_MS = 60 * 1000;

function matches(row: Row, where: Row = {}): boolean {
  return Object.entries(where).every(([key, expected]) => {
    const actual = row[key] ?? null;
    if (expected !== null && typeof expected === 'object') {
      const condition = expected as { in?: unknown[]; notIn?: unknown[] };
      if (condition.in) return condition.in.includes(actual);
      if (condition.notIn) return !condition.notIn.includes(actual);
    }
    return actual === expected;
  });
}

const candidate = (
  id: string,
  over: Partial<SubtitleCandidate> = {},
): SubtitleCandidate => ({
  id,
  release: `Movie ${id}`,
  fileCount: 1,
  hearingImpaired: false,
  foreignPartsOnly: false,
  machineTranslated: false,
  aiTranslated: false,
  hashMatch: false,
  downloadCount: 10,
  ...over,
});

// This suite exists because every failure of the driver is silent: it runs minutes to hours after
// the delivery that started it, in a background queue nobody watches. A WAITING step that reaches
// OpenSubtitles before the probe reported spends the shared download quota on a search with no
// file hash; a quota or authorization answer swallowed as an empty result completes the search as
// "nothing found" when the real cause is an exhausted day; a download that reports no quota left
// and is followed by one more download burns the account's next day; a language already present
// searched again spends that quota for nothing; a second set of attempts after a crash doubles the
// candidates fetched; a duplicate wake-up that rewrites a state it already left re-runs a step
// against a newer one; a staged candidate left in the downloads root is a file nobody will ever
// clean; and an embed pointed at the wrong path rewrites a different library file. It runs the real
// state machine over a stateful fake of the two tables, the real staging in a temp downloads root
// and the real MediaRootsService, with only the OpenSubtitles client, the queues and the embed
// (except for the season pack case, which uses the real one) faked (Article IX, Spec 103, REQ-7
// REQ-8 REQ-9 REQ-12 NFR-4; Spec 107, REQ-3 REQ-6 REQ-9).
describe('SubtitleSearchDriver', () => {
  let baseDir: string;
  let libDir: string;
  let downloadsDir: string;
  let movieFile: string;
  let mediaRoots: MediaRootsService;

  let searches: Row[];
  let attempts: Row[];
  let embeds: Row[];
  let nextAttemptId: number;
  let wake: jest.Mock;
  let addSync: jest.Mock;
  let embedStaged: jest.Mock;
  let addProbe: jest.Mock;
  let removeProbe: jest.Mock;
  let client: Record<string, jest.Mock>;
  let remote: Record<string, SubtitleCandidate[]>;
  let available: boolean;
  let driver: SubtitleSearchDriver;
  let prisma: Record<string, unknown>;

  const stagingDir = (searchId: number) =>
    join(downloadsDir, '.perceptor', 'subtitle-search', String(searchId));
  const exists = (path: string) =>
    stat(path).then(
      () => true,
      () => false,
    );
  const search = (id = 1): Row => searches.find((row) => row.id === id)!;
  const wakesWithDelay = (delay: number) =>
    (wake.mock.calls as Array<[number, number]>).filter(
      (call) => call[1] === delay,
    ).length;

  const seedSearch = (over: Row = {}): Row => {
    const row: Row = {
      id: 1,
      movieId: 10,
      episodeId: null,
      status: 'SEARCHING',
      errorKey: null,
      wantedLanguages: ['eng', 'spa'],
      presentLanguages: ['eng'],
      libraryPath: null,
      movieHash: 'abcdef0123456789',
      languageErrors: null,
      subtitleEmbedId: null,
      createdAt: new Date(),
      finishedAt: null,
      ...over,
    };
    searches.push(row);
    return row;
  };

  const seedAttempts = (searchId: number, language: string, count: number) => {
    for (let rank = 1; rank <= count; rank += 1) {
      attempts.push({
        id: nextAttemptId++,
        searchId,
        languageIso3: language,
        providerSubtitleId: `${language}-${rank}`,
        releaseName: `Movie ${rank}`,
        rank,
        stagedPath: null,
        status: 'QUEUED',
        offsetMs: null,
        reasonKey: null,
        finishedAt: null,
      });
    }
  };

  beforeAll(async () => {
    baseDir = await mkdtemp(join(tmpdir(), 'subtitle-search-driver-'));
    libDir = join(baseDir, 'library');
    downloadsDir = join(baseDir, 'downloads');
    await mkdir(libDir, { recursive: true });
    await mkdir(downloadsDir, { recursive: true });
    movieFile = join(libDir, 'Movie.mkv');
    await writeFile(movieFile, 'mkv');
    await writeFile(join(libDir, 'Show S01E01.mkv'), 'mkv');
    mediaRoots = new MediaRootsService([
      {
        id: 'library',
        label: 'Biblioteca',
        hostPath: '/host/library',
        containerPath: libDir,
      },
      {
        id: 'downloads',
        label: 'Descargas',
        hostPath: '/host/downloads',
        containerPath: downloadsDir,
      },
    ]);
  });

  afterAll(async () => {
    await rm(baseDir, { recursive: true, force: true });
  });

  const build = (embedService?: SubtitleEmbedService) => {
    return new SubtitleSearchDriver(
      prisma as never,
      { setHandler: jest.fn(), wake } as never,
      { addSync } as never,
      (embedService ?? { embedStaged }) as never,
      { addProbe, removeProbe } as never,
      client as never,
      {
        isSubtitleSearchAvailable: jest.fn(() => Promise.resolve(available)),
      } as never,
      new SubtitleSearchStaging(mediaRoots),
    );
  };

  beforeEach(async () => {
    await rm(join(downloadsDir, '.perceptor'), {
      recursive: true,
      force: true,
    });
    searches = [];
    attempts = [];
    embeds = [];
    nextAttemptId = 100;
    available = true;
    remote = {
      es: [candidate('a'), candidate('b'), candidate('c'), candidate('d')],
    };
    wake = jest.fn().mockResolvedValue(undefined);
    addSync = jest.fn().mockResolvedValue(undefined);
    embedStaged = jest.fn().mockResolvedValue({ id: 500 });
    addProbe = jest.fn().mockResolvedValue(undefined);
    removeProbe = jest.fn().mockResolvedValue(undefined);
    client = {
      search: jest.fn((params: { languages: string }) =>
        Promise.resolve(remote[params.languages] ?? []),
      ),
      download: jest.fn(() =>
        Promise.resolve({
          bytes: Buffer.from('1\n00:00:01,000 --> 00:00:02,000\nHi\n'),
          remaining: 10,
        }),
      ),
    };

    const withEmbed = (row: Row | undefined) => ({
      subtitleEmbed: row?.subtitleEmbedId
        ? (embeds.find((embed) => embed.id === row.subtitleEmbedId) ?? null)
        : null,
    });

    prisma = {
      subtitleSearch: {
        findUnique: jest.fn(
          ({
            where,
            include,
            select,
          }: {
            where: Row;
            include?: Row;
            select?: Row;
          }) => {
            const row = searches.find(
              (candidateRow) => candidateRow.id === where.id,
            );
            if (!row) return Promise.resolve(null);
            if (select?.subtitleEmbed) return Promise.resolve(withEmbed(row));
            if (select) return Promise.resolve({ status: row.status });
            return Promise.resolve(
              include
                ? {
                    ...row,
                    attempts: attempts
                      .filter((a) => a.searchId === row.id)
                      .sort(
                        (a, b) =>
                          String(a.languageIso3).localeCompare(
                            String(b.languageIso3),
                          ) || (a.rank as number) - (b.rank as number),
                      ),
                  }
                : row,
            );
          },
        ),
        findMany: jest.fn(({ where }: { where: Row }) =>
          Promise.resolve(
            searches
              .filter((row) => matches(row, where))
              .map((row) => ({ id: row.id })),
          ),
        ),
        updateMany: jest.fn(({ where, data }: { where: Row; data: Row }) => {
          const hit = searches.filter((row) => matches(row, where));
          hit.forEach((row) => Object.assign(row, data));
          return Promise.resolve({ count: hit.length });
        }),
      },
      subtitleSearchAttempt: {
        createMany: jest.fn(({ data }: { data: Row[] }) => {
          for (const row of data) {
            attempts.push({
              id: nextAttemptId++,
              stagedPath: null,
              status: 'QUEUED',
              offsetMs: null,
              reasonKey: null,
              finishedAt: null,
              ...row,
            });
          }
          return Promise.resolve({ count: data.length });
        }),
        findMany: jest.fn(({ where }: { where: Row }) =>
          Promise.resolve(
            attempts
              .filter((row) => matches(row, where))
              .sort((a, b) => (a.rank as number) - (b.rank as number)),
          ),
        ),
        updateMany: jest.fn(({ where, data }: { where: Row; data: Row }) => {
          const hit = attempts.filter((row) => matches(row, where));
          hit.forEach((row) => Object.assign(row, data));
          return Promise.resolve({ count: hit.length });
        }),
      },
      subtitleEmbed: {
        findUnique: jest.fn(({ where }: { where: Row }) =>
          Promise.resolve(embeds.find((row) => row.id === where.id) ?? null),
        ),
        count: jest.fn(({ where }: { where: Row }) =>
          Promise.resolve(embeds.filter((row) => matches(row, where)).length),
        ),
        create: jest.fn(({ data }: { data: Row }) => {
          const row = {
            id: 700 + embeds.length,
            status: 'QUEUED',
            errorKey: null,
            warningKey: null,
            createdAt: new Date(),
            finishedAt: null,
            ...data,
          };
          embeds.push(row);
          return Promise.resolve(row);
        }),
        delete: jest.fn(),
      },
      movie: {
        findUnique: jest
          .fn()
          .mockResolvedValue({ filePath: movieFile, tmdbId: 603 }),
        findFirst: jest.fn().mockResolvedValue({
          filePath: movieFile,
          tmdbId: 603,
          mediaServerPresentAt: null,
        }),
      },
      episode: { findUnique: jest.fn(), findFirst: jest.fn() },
      processJob: {
        findFirst: jest.fn().mockResolvedValue({
          outputFilePath: movieFile,
          sourceFile: {
            mediaSource: { downloadPath: '/downloads/Movie.2020.1080p' },
          },
        }),
        count: jest.fn().mockResolvedValue(0),
      },
      mediaSource: {
        count: jest.fn().mockResolvedValue(0),
        findMany: jest.fn().mockResolvedValue([]),
      },
      language: {
        findMany: jest
          .fn()
          .mockResolvedValue([
            { tag: 'es', iso2: 'es', iso3: 'spa', trackTitle: 'Español' },
          ]),
      },
    };
    (prisma as { $transaction: unknown }).$transaction = jest.fn(
      (fn: (tx: unknown) => Promise<unknown>) => fn(prisma),
    );

    driver = build();
  });

  describe('waiting for the probe (Spec 107 REQ-3)', () => {
    it('queues the probe and a 60-minute backstop and calls no OpenSubtitles method', async () => {
      seedSearch({
        status: 'WAITING',
        presentLanguages: null,
        movieHash: null,
      });

      await driver.advance(1);

      expect(removeProbe).toHaveBeenCalledWith(1);
      expect(addProbe).toHaveBeenCalledWith({ subtitleSearchId: 1 });
      expect(wake).toHaveBeenCalledWith(1, 60 * MINUTE_MS);
      expect(client.search).not.toHaveBeenCalled();
      expect(client.download).not.toHaveBeenCalled();
      expect(search().status).toBe('WAITING');
    });

    it('fails with probe_failed when the backstop wakes a search still waiting', async () => {
      seedSearch({
        status: 'WAITING',
        createdAt: new Date(Date.now() - 61 * MINUTE_MS),
      });

      await driver.advance(1);

      expect(search()).toMatchObject({
        status: 'FAILED',
        errorKey: ERROR_KEYS.SUBTITLE_SEARCH_PROBE_FAILED,
      });
      expect(addProbe).not.toHaveBeenCalled();
    });

    it('fails with provider_not_configured when the key or the credentials vanished', async () => {
      seedSearch({ status: 'WAITING' });
      available = false;

      await driver.advance(1);

      expect(search()).toMatchObject({
        status: 'FAILED',
        errorKey: ERROR_KEYS.SUBTITLE_SEARCH_PROVIDER_NOT_CONFIGURED,
      });
      expect(addProbe).not.toHaveBeenCalled();
    });

    it('fails with probe_failed when the probe cannot be queued', async () => {
      seedSearch({ status: 'WAITING' });
      addProbe.mockRejectedValue(new Error('redis down'));

      await driver.advance(1);

      expect(search().errorKey).toBe(ERROR_KEYS.SUBTITLE_SEARCH_PROBE_FAILED);
    });
  });

  describe('searching (REQ-7 REQ-8 REQ-9, Spec 107 REQ-6)', () => {
    it('searches the missing language with its provider code, the stored hash and the tmdb id, never a present one', async () => {
      seedSearch();

      await driver.advance(1);

      expect(client.search).toHaveBeenCalledTimes(1);
      expect(client.search).toHaveBeenCalledWith({
        tmdbId: 603,
        languages: 'es',
        moviehash: 'abcdef0123456789',
      });
      expect(attempts.filter((row) => row.languageIso3 === 'eng')).toHaveLength(
        0,
      );
    });

    it('completes with no provider call when no language is missing', async () => {
      seedSearch({ wantedLanguages: ['eng'] });

      await driver.advance(1);

      expect(client.search).not.toHaveBeenCalled();
      expect(client.download).not.toHaveBeenCalled();
      expect(search().status).toBe('COMPLETED');
    });

    it('records no attempts for a language with no candidate and moves on', async () => {
      seedSearch({ wantedLanguages: ['eng', 'fra'] });

      await driver.advance(1);

      expect(attempts).toHaveLength(0);
      expect(search().status).toBe('COMPLETED');
    });

    it('inserts at most three ranked attempts, stages only the first and queues its sync', async () => {
      seedSearch();

      await driver.advance(1);

      const rows = attempts.filter((row) => row.searchId === 1);
      expect(rows.map((row) => row.rank)).toEqual([1, 2, 3]);
      expect(client.download).toHaveBeenCalledTimes(1);
      const first = rows[0];
      expect(first.stagedPath).toBe(
        join(stagingDir(1), `${first.id as number}.srt`),
      );
      expect(await exists(first.stagedPath as string)).toBe(true);
      expect(rows[1].stagedPath).toBeNull();
      expect(addSync).toHaveBeenCalledWith({ subtitleSyncId: first.id });
      expect(search().status).toBe('VALIDATING');
      expect(wakesWithDelay(6 * HOUR_MS)).toBe(1);
    });

    it('marks a candidate whose download fails and stages the next rank in the same step', async () => {
      seedSearch();
      client.download.mockRejectedValueOnce(
        new OpenSubtitlesHttpError('unavailable', 'POST', '/download', 500),
      );

      await driver.advance(1);

      const rows = attempts.filter((row) => row.searchId === 1);
      expect(rows[0]).toMatchObject({
        status: 'FAILED',
        reasonKey: ERROR_KEYS.SUBTITLE_SEARCH_FETCH_FAILED,
      });
      expect(rows[1].stagedPath).not.toBeNull();
      expect(addSync).toHaveBeenCalledWith({ subtitleSyncId: rows[1].id });
    });

    it('does not insert a second set of attempts when re-run after a crash between insert and download', async () => {
      seedSearch();
      seedAttempts(1, 'spa', 3);

      await driver.advance(1);

      expect(attempts).toHaveLength(3);
      expect(client.search).not.toHaveBeenCalled();
      expect(attempts[0].stagedPath).not.toBeNull();
      expect(search().status).toBe('VALIDATING');
    });

    it('does not search again a language that came back empty before a later one with attempts', async () => {
      seedSearch({
        presentLanguages: [],
        wantedLanguages: ['fra', 'spa'],
      });
      seedAttempts(1, 'spa', 2);
      attempts.forEach((row) => {
        row.status = 'REJECTED';
      });

      await driver.advance(1);

      expect(client.search).not.toHaveBeenCalled();
    });

    describe('provider outcomes (Spec 107 REQ-9)', () => {
      const http = (
        kind: 'unauthorized' | 'quota' | 'rate_limited' | 'unavailable',
      ) => new OpenSubtitlesHttpError(kind, 'GET', '/x', 0);

      it('fails the search with provider_unauthorized and spends no download when the search is refused', async () => {
        seedSearch();
        client.search.mockRejectedValue(http('unauthorized'));

        await driver.advance(1);

        expect(search()).toMatchObject({
          status: 'FAILED',
          errorKey: ERROR_KEYS.SUBTITLE_SEARCH_PROVIDER_UNAUTHORIZED,
          languageErrors: {
            spa: ERROR_KEYS.SUBTITLE_SEARCH_PROVIDER_UNAUTHORIZED,
          },
        });
        expect(client.download).not.toHaveBeenCalled();
      });

      it('fails the search with provider_unauthorized when the download is refused', async () => {
        seedSearch();
        client.download.mockRejectedValue(http('unauthorized'));

        await driver.advance(1);

        expect(search()).toMatchObject({
          status: 'FAILED',
          errorKey: ERROR_KEYS.SUBTITLE_SEARCH_PROVIDER_UNAUTHORIZED,
        });
        expect(client.download).toHaveBeenCalledTimes(1);
      });

      it('records provider_unavailable for the language that was rate limited and continues with the next', async () => {
        seedSearch({ presentLanguages: [], wantedLanguages: ['fra', 'spa'] });
        remote.fr = [];
        client.search.mockImplementation((params: { languages: string }) =>
          params.languages === 'fr'
            ? Promise.reject(http('rate_limited'))
            : Promise.resolve(remote[params.languages] ?? []),
        );
        (
          prisma.language as Record<string, jest.Mock>
        ).findMany.mockResolvedValue([
          { tag: 'es', iso2: 'es', iso3: 'spa' },
          { tag: 'fr', iso2: 'fr', iso3: 'fra' },
        ]);

        await driver.advance(1);

        expect(search().languageErrors).toEqual({
          fra: ERROR_KEYS.SUBTITLE_SEARCH_PROVIDER_UNAVAILABLE,
        });
        expect(
          attempts.filter((row) => row.languageIso3 === 'spa'),
        ).toHaveLength(3);
        expect(search().status).toBe('VALIDATING');
      });

      it('stops the next download on remaining 0 and keeps the accepted language', async () => {
        seedSearch({
          presentLanguages: [],
          wantedLanguages: ['eng', 'spa'],
        });
        remote.en = [candidate('e1'), candidate('e2')];
        (
          prisma.language as Record<string, jest.Mock>
        ).findMany.mockResolvedValue([
          { tag: 'es', iso2: 'es', iso3: 'spa' },
          { tag: 'en', iso2: 'en', iso3: 'eng' },
        ]);
        client.download.mockResolvedValue({
          bytes: Buffer.from('x'),
          remaining: 0,
        });

        await driver.advance(1);
        const first = attempts.find((row) => row.languageIso3 === 'eng')!;
        expect(first.stagedPath).not.toBeNull();
        expect(search().languageErrors).toEqual({
          spa: ERROR_KEYS.SUBTITLE_SEARCH_QUOTA_EXHAUSTED,
        });

        Object.assign(first, { status: 'ACCEPTED', offsetMs: 0 });
        await driver.advance(1);
        await driver.advance(1);

        expect(client.download).toHaveBeenCalledTimes(1);
        expect(search()).toMatchObject({ status: 'EMBEDDING' });
        expect(
          (search().languageErrors as Record<string, string>).eng,
        ).toBeUndefined();
      });

      it('ends FAILED with quota_exhausted when the quota ran out and nothing was accepted', async () => {
        seedSearch();
        client.download.mockRejectedValue(http('quota'));

        await driver.advance(1);

        expect(search()).toMatchObject({
          status: 'FAILED',
          errorKey: ERROR_KEYS.SUBTITLE_SEARCH_QUOTA_EXHAUSTED,
          languageErrors: { spa: ERROR_KEYS.SUBTITLE_SEARCH_QUOTA_EXHAUSTED },
        });
        expect(attempts.every((row) => row.status === 'FAILED')).toBe(true);
      });
    });
  });

  describe('validating (REQ-9 REQ-10)', () => {
    const stageFirst = async () => {
      seedSearch();
      await driver.advance(1);
      return attempts.filter((row) => row.searchId === 1);
    };

    it('does nothing while the worker has not reported and the candidate is young', async () => {
      await stageFirst();
      const before = JSON.stringify(attempts);
      wake.mockClear();

      await driver.advance(1);

      expect(JSON.stringify(attempts)).toBe(before);
      expect(search().status).toBe('VALIDATING');
      expect(wake).not.toHaveBeenCalled();
    });

    it('deletes a rejected candidate and stages the next rank', async () => {
      const rows = await stageFirst();
      rows[0].status = 'REJECTED';

      await driver.advance(1);

      expect(await exists(rows[0].stagedPath as string)).toBe(false);
      expect(rows[1].stagedPath).not.toBeNull();
      expect(await exists(rows[1].stagedPath as string)).toBe(true);
      expect(addSync).toHaveBeenCalledWith({ subtitleSyncId: rows[1].id });
    });

    it('fails a candidate the worker never reported on after six hours and moves on', async () => {
      const rows = await stageFirst();
      const old = new Date(Date.now() - 7 * HOUR_MS);
      await utimes(rows[0].stagedPath as string, old, old);

      await driver.advance(1);

      expect(rows[0]).toMatchObject({
        status: 'FAILED',
        reasonKey: ERROR_KEYS.SUBTITLE_SEARCH_SYNC_FAILED,
      });
      expect(await exists(rows[0].stagedPath as string)).toBe(false);
      expect(rows[1].stagedPath).not.toBeNull();
    });

    it('rejects the unfetched ranks once a candidate is accepted and goes back to searching', async () => {
      const rows = await stageFirst();
      Object.assign(rows[0], { status: 'ACCEPTED', offsetMs: 250 });

      await driver.advance(1);

      expect(rows[1].status).toBe('REJECTED');
      expect(rows[2].status).toBe('REJECTED');
      expect(client.download).toHaveBeenCalledTimes(1);
      expect(await exists(rows[0].stagedPath as string)).toBe(true);
      expect(search().status).toBe('SEARCHING');
    });
  });

  describe('embedding (REQ-11 REQ-12)', () => {
    const toEmbedding = async () => {
      seedSearch();
      await driver.advance(1);
      const rows = attempts.filter((row) => row.searchId === 1);
      Object.assign(rows[0], { status: 'ACCEPTED', offsetMs: 250 });
      await driver.advance(1);
      await driver.advance(1);
      return rows[0];
    };

    it('embeds the accepted candidate in one embed, keeps polling, and removes the staging once it completes', async () => {
      const accepted = await toEmbedding();
      expect(search().status).toBe('EMBEDDING');

      await driver.advance(1);

      expect(embedStaged).toHaveBeenCalledWith(
        { kind: 'movie', id: 10 },
        [
          {
            languageIso3: 'spa',
            stagedPath: accepted.stagedPath,
            offsetMs: 250,
            provenance: 'opensubtitles:a',
          },
        ],
        movieFile,
      );
      expect(search().subtitleEmbedId).toBe(500);
      expect(await exists(accepted.stagedPath as string)).toBe(true);

      embeds.push({ id: 500, status: 'RUNNING', errorKey: null });
      await driver.advance(1);
      expect(search().status).toBe('EMBEDDING');
      expect(await exists(accepted.stagedPath as string)).toBe(true);

      embeds[0].status = 'COMPLETED';
      await driver.advance(1);
      expect(search().status).toBe('COMPLETED');
      expect(await exists(stagingDir(1))).toBe(false);
    });

    // Spec 107, AC-18
    it('stores the provider file name on the attempt and hands it on as provenance', async () => {
      remote.es = [candidate('a', { fileName: 'Movie.2020.es.srt' })];
      seedSearch();
      await driver.advance(1);
      const rows = attempts.filter((row) => row.searchId === 1);
      expect(rows[0].providerFileName).toBe('Movie.2020.es.srt');
      Object.assign(rows[0], { status: 'ACCEPTED', offsetMs: 250 });
      await driver.advance(1);
      await driver.advance(1);
      await driver.advance(1);

      expect(embedStaged).toHaveBeenCalledWith(
        expect.anything(),
        [expect.objectContaining({ provenance: 'Movie.2020.es.srt' })],
        movieFile,
      );
    });

    it('embeds into the stored libraryPath when the title has no filePath of its own', async () => {
      (prisma.movie as Record<string, jest.Mock>).findUnique.mockResolvedValue({
        filePath: null,
        tmdbId: 603,
      });
      seedSearch({ libraryPath: '/lib/Server Only.mkv' });
      await driver.advance(1);
      const rows = attempts.filter((row) => row.searchId === 1);
      Object.assign(rows[0], { status: 'ACCEPTED', offsetMs: 0 });
      await driver.advance(1);
      await driver.advance(1);
      await driver.advance(1);

      expect(embedStaged.mock.calls[0][2]).toBe('/lib/Server Only.mkv');
    });

    it('fails with the embed key and deletes the staging when the embed fails', async () => {
      await toEmbedding();
      await driver.advance(1);
      embeds.push({
        id: 500,
        status: 'FAILED',
        errorKey: ERROR_KEYS.SUBTITLE_EMBED_VERIFY_FAILED,
      });

      await driver.advance(1);

      expect(search()).toMatchObject({
        status: 'FAILED',
        errorKey: ERROR_KEYS.SUBTITLE_EMBED_VERIFY_FAILED,
      });
      expect(await exists(stagingDir(1))).toBe(false);
    });

    it('fails with error.subtitleEmbed.busy, deletes the staging and never retries', async () => {
      await toEmbedding();
      embedStaged.mockRejectedValue(
        i18nError.conflict(ERROR_KEYS.SUBTITLE_EMBED_BUSY),
      );

      await driver.advance(1);
      await driver.advance(1);

      expect(search()).toMatchObject({
        status: 'FAILED',
        errorKey: ERROR_KEYS.SUBTITLE_EMBED_BUSY,
      });
      expect(await exists(stagingDir(1))).toBe(false);
      expect(embedStaged).toHaveBeenCalledTimes(1);
    });

    it('queues the embed of E01 of a scanned pack while E02 is still encoding', async () => {
      const episode = {
        filePath: join(libDir, 'Show S01E01.mkv'),
        mediaServerPresentAt: null,
        releaseDate: new Date('2020-01-01'),
        episodeNumber: 1,
        seasonId: 9,
        season: { seasonNumber: 1, show: { tmdbId: 77 } },
      };
      (prisma.episode as Record<string, jest.Mock>).findFirst.mockResolvedValue(
        episode,
      );
      (
        prisma.episode as Record<string, jest.Mock>
      ).findUnique.mockResolvedValue(episode);
      const sources: Row[] = [
        {
          id: 1,
          seasonId: 9,
          episodeId: null,
          status: 'SCANNED',
          retiredAt: null,
        },
      ];
      const jobs: Row[] = [{ id: 2, episodeId: 2, status: 'ENCODING' }];
      (
        prisma.mediaSource as Record<string, jest.Mock>
      ).count.mockImplementation(({ where }: { where: Row }) =>
        Promise.resolve(sources.filter((row) => matches(row, where)).length),
      );
      (
        prisma.mediaSource as Record<string, jest.Mock>
      ).findMany.mockImplementation(({ where }: { where: Row }) =>
        Promise.resolve(sources.filter((row) => matches(row, where))),
      );
      (prisma.processJob as Record<string, jest.Mock>).count.mockImplementation(
        ({ where }: { where: Row }) =>
          Promise.resolve(jobs.filter((row) => matches(row, where)).length),
      );
      const addEmbed = jest.fn().mockResolvedValue(undefined);
      const real = new SubtitleEmbedService(
        prisma as never,
        {} as never,
        mediaRoots,
        { addEmbed } as never,
        new ActiveEmbedGuard(prisma as never),
        { request: jest.fn() } as never,
        {} as never,
      );
      driver = build(real);

      seedSearch({ movieId: null, episodeId: 1, status: 'EMBEDDING' });
      const stagedPath = join(stagingDir(1), '100.srt');
      await mkdir(stagingDir(1), { recursive: true });
      await writeFile(stagedPath, '1');
      attempts.push({
        id: 100,
        searchId: 1,
        languageIso3: 'spa',
        providerSubtitleId: 'x',
        releaseName: 'x',
        rank: 1,
        stagedPath,
        status: 'ACCEPTED',
        offsetMs: 0,
        reasonKey: null,
        finishedAt: null,
      });

      await driver.advance(1);

      expect(search().status).toBe('EMBEDDING');
      expect(search().errorKey).toBeNull();
      expect(search().subtitleEmbedId).toEqual(expect.any(Number));
      expect(addEmbed).toHaveBeenCalledTimes(1);
    });
  });

  describe('duplicate and stray wake-ups (NFR-4)', () => {
    it('writes nothing when woken for a search that is already terminal', async () => {
      seedSearch({
        status: 'FAILED',
        errorKey: ERROR_KEYS.SUBTITLE_SEARCH_SUPERSEDED,
      });
      const searchTable = prisma.subtitleSearch as Record<string, jest.Mock>;
      const attemptTable = prisma.subtitleSearchAttempt as Record<
        string,
        jest.Mock
      >;

      await driver.advance(1);

      expect(searchTable.updateMany).not.toHaveBeenCalled();
      expect(attemptTable.updateMany).not.toHaveBeenCalled();
      expect(attemptTable.createMany).not.toHaveBeenCalled();
    });

    it('moves a searching search forward only once when two wake-ups race', async () => {
      seedSearch();

      await Promise.all([driver.advance(1), driver.advance(1)]);

      expect(search().status).toBe('VALIDATING');
      expect(wakesWithDelay(6 * HOUR_MS)).toBeGreaterThanOrEqual(1);
      expect(attempts.filter((row) => row.stagedPath !== null)).toHaveLength(1);
    });

    it('deletes the staging directory of a search that no longer exists', async () => {
      await mkdir(stagingDir(99), { recursive: true });
      await writeFile(join(stagingDir(99), '1.srt'), '1');

      await driver.advance(99);

      expect(await exists(stagingDir(99))).toBe(false);
    });

    it('deletes the staging of a superseded search once no embed reads it', async () => {
      seedSearch({
        status: 'FAILED',
        errorKey: ERROR_KEYS.SUBTITLE_SEARCH_SUPERSEDED,
      });
      await mkdir(stagingDir(1), { recursive: true });
      await writeFile(join(stagingDir(1), '1.srt'), '1');

      await driver.advance(1);

      expect(await exists(stagingDir(1))).toBe(false);
    });

    it('keeps the staging of a superseded search while its embed still reads it', async () => {
      seedSearch({
        status: 'FAILED',
        errorKey: ERROR_KEYS.SUBTITLE_SEARCH_SUPERSEDED,
        subtitleEmbedId: 500,
      });
      embeds.push({ id: 500, status: 'RUNNING' });
      await mkdir(stagingDir(1), { recursive: true });
      await writeFile(join(stagingDir(1), '1.srt'), '1');

      await driver.advance(1);

      expect(await exists(join(stagingDir(1), '1.srt'))).toBe(true);
      expect(wake).toHaveBeenCalledWith(1, 2 * MINUTE_MS);
    });
  });

  describe('boot (NFR-4)', () => {
    it('wakes every non-terminal search at once and none of the terminal ones', async () => {
      seedSearch({ id: 1, status: 'WAITING' });
      seedSearch({ id: 2, status: 'VALIDATING' });
      seedSearch({ id: 3, status: 'EMBEDDING' });
      seedSearch({ id: 4, status: 'COMPLETED' });
      seedSearch({ id: 5, status: 'FAILED' });

      await driver.recover();

      expect((wake.mock.calls as Array<[number, number]>).sort()).toEqual([
        [1, 0],
        [2, 0],
        [3, 0],
      ]);
    });

    it('removes the directories of terminal and missing searches and keeps the live ones', async () => {
      seedSearch({ id: 1, status: 'VALIDATING' });
      seedSearch({ id: 2, status: 'COMPLETED' });
      for (const id of [1, 2, 3]) {
        await mkdir(stagingDir(id), { recursive: true });
        await writeFile(join(stagingDir(id), '1.srt'), '1');
      }
      await mkdir(join(stagingDir(1), '..', 'notes'), { recursive: true });

      await driver.recover();

      expect((await readdir(join(stagingDir(1), '..'))).sort()).toEqual([
        '1',
        'notes',
      ]);
    });
  });
});
