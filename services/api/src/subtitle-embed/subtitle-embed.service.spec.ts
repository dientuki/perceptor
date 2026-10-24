import { HttpException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { mkdtemp, mkdir, rm as removeTree, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { MediaRootsService } from '@/media-roots/media-roots.service';
import { ERROR_KEYS } from '@/i18n/error-keys';
import type { AuthPrincipal } from '@/auth/auth.types';
import { ActiveEmbedGuard } from './active-embed.guard';
import { SubtitleEmbedService, newRequestMemo } from './subtitle-embed.service';
import { SubtitleEmbedInput } from './dto/subtitle-embed.input';

const anyDate = (): Date => expect.any(Date) as Date;
const containing = <T extends object>(shape: T): T =>
  expect.objectContaining(shape) as T;
const firstArg = <T>(mock: jest.Mock): T => (mock.mock.calls[0] as [T])[0];

// This suite exists because every failure of the subtitle-embed API side is
// silent. A listing that throws instead of returning [] breaks the whole
// film/series detail page; an embed queued while a replacement encode is in
// flight makes two writers race on one library file and the loser vanishes with
// no error anywhere; a regional track title (`Latino`) written instead of the
// base row's (`Español`) mislabels every embedded track forever; a Jellyfin
// refresh failure that fails the completion report leaves a finished embed
// reading RUNNING; a repeated worker report that notifies Jellyfin twice or
// overwrites a warning hides the very problem the warning exists to show. It
// runs against a real temp directory, the real MediaRootsService and the real
// ActiveEmbedGuard so the path rules and busy rules under test are the
// production ones, with only Prisma, Jellyfin and the queue faked (Article IX,
// Spec 101, REQ-1 REQ-2 REQ-4 REQ-5 REQ-12 REQ-13 REQ-15 REQ-16).
describe('SubtitleEmbedService', () => {
  let baseDir: string;
  let libDir: string;
  let mkv: string;
  let mediaRoots: MediaRootsService;
  type Model = Record<string, jest.Mock>;
  let prisma: {
    user: Model;
    movie: Model;
    episode: Model;
    language: Model;
    mediaSource: Model;
    processJob: Model;
    subtitleEmbed: Model;
    $transaction: jest.Mock;
  };
  let client: Record<string, jest.Mock>;
  let mediaServer: { createClient: jest.Mock };
  let queue: { addEmbed: jest.Mock };
  let service: SubtitleEmbedService;

  const admin: AuthPrincipal = {
    type: 'user',
    id: 'u1',
    username: 'admin',
    jti: 'j',
  };
  const hostLib = '/host/library';

  const stream = (name: string, over: Record<string, unknown> = {}) => ({
    hostPath: `${hostLib}/${name}`,
    languageIso3: 'spa',
    isForced: false,
    displayTitle: 'Spanish - SUBRIP - External',
    ...over,
  });

  const input = (
    over: Partial<SubtitleEmbedInput> = {},
  ): SubtitleEmbedInput => ({
    fileName: 'Movie (2020).spa.srt',
    languageIso3: 'spa',
    isDefault: false,
    offsetMs: 0,
    ...over,
  });

  async function key(promise: Promise<unknown>): Promise<string | undefined> {
    try {
      await promise;
    } catch (error) {
      return (
        (error as HttpException).getResponse() as { i18n?: { key: string } }
      ).i18n?.key;
    }
    return undefined;
  }

  beforeAll(async () => {
    baseDir = await mkdtemp(join(tmpdir(), 'subtitle-embed-spec-'));
    libDir = join(baseDir, 'library');
    await mkdir(libDir, { recursive: true });
    mkv = join(libDir, 'Movie (2020).mkv');
    await writeFile(mkv, 'mkv');
    await writeFile(join(libDir, 'Movie (2020).spa.srt'), '1');
    await writeFile(join(libDir, 'Movie (2020).eng.srt'), '1');
    await writeFile(join(libDir, 'Movie (2020).mp4'), 'mp4');
    mediaRoots = new MediaRootsService([
      {
        id: 'library',
        label: 'Biblioteca',
        hostPath: hostLib,
        containerPath: libDir,
      },
      {
        id: 'downloads',
        label: 'Descargas',
        hostPath: '/host/downloads',
        containerPath: join(baseDir, 'downloads'),
      },
    ]);
  });

  afterAll(async () => {
    await removeTree(baseDir, { recursive: true, force: true });
  });

  beforeEach(() => {
    prisma = {
      user: { findUnique: jest.fn().mockResolvedValue({ isAdmin: true }) },
      movie: {
        findUnique: jest.fn().mockResolvedValue({ tmdbId: 603 }),
        findFirst: jest.fn().mockResolvedValue({
          tmdbId: 603,
          filePath: mkv,
          mediaServerPresentAt: null,
        }),
      },
      episode: {
        findUnique: jest.fn().mockResolvedValue({
          episodeNumber: 2,
          season: { seasonNumber: 1, show: { tmdbId: 77 } },
        }),
        findFirst: jest.fn().mockResolvedValue({
          filePath: mkv,
          mediaServerPresentAt: null,
          releaseDate: new Date('2020-01-01'),
          episodeNumber: 2,
          seasonId: 9,
          season: { seasonNumber: 1, show: { tmdbId: 77 } },
        }),
      },
      language: {
        findMany: jest.fn().mockResolvedValue([
          { tag: 'es-419', iso2: 'es', iso3: 'spa', trackTitle: 'Latino' },
          { tag: 'es', iso2: 'es', iso3: 'spa', trackTitle: 'Español' },
          { tag: 'en', iso2: 'en', iso3: 'eng', trackTitle: 'English' },
        ]),
      },
      mediaSource: {
        count: jest.fn().mockResolvedValue(0),
        findMany: jest.fn().mockResolvedValue([]),
      },
      processJob: { count: jest.fn().mockResolvedValue(0) },
      subtitleEmbed: {
        count: jest.fn().mockResolvedValue(0),
        create: jest.fn().mockImplementation(({ data }: { data: object }) =>
          Promise.resolve({
            id: 5,
            status: 'QUEUED',
            errorKey: null,
            warningKey: null,
            createdAt: new Date('2026-10-23'),
            finishedAt: null,
            ...data,
          }),
        ),
        delete: jest.fn().mockResolvedValue({}),
        findFirst: jest.fn(),
        findUnique: jest.fn(),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        update: jest.fn().mockResolvedValue({}),
      },
      $transaction: jest.fn(),
    };
    prisma.$transaction.mockImplementation(
      (callback: (tx: unknown) => Promise<unknown>) => callback(prisma),
    );

    client = {
      findByTmdbId: jest.fn().mockResolvedValue('jf-1'),
      listItemSubtitles: jest.fn().mockResolvedValue({
        itemId: 'jf-1',
        mediaHostPath: `${hostLib}/Movie (2020).mkv`,
        subtitles: [
          stream('Movie (2020).spa.srt', { isForced: true }),
          stream('Movie (2020).eng.srt', { languageIso3: 'eng' }),
        ],
      }),
      listSeriesEpisodeSubtitles: jest.fn().mockResolvedValue(
        new Map([
          [
            '1:2',
            {
              itemId: 'e2',
              mediaHostPath: `${hostLib}/Movie (2020).mkv`,
              subtitles: [stream('Movie (2020).spa.srt')],
            },
          ],
          [
            '1:3',
            {
              itemId: 'e3',
              mediaHostPath: `${hostLib}/x.mkv`,
              subtitles: [stream('x.eng.srt', { languageIso3: 'eng' })],
            },
          ],
        ]),
      ),
      modifiedMedia: jest.fn().mockResolvedValue(undefined),
    };
    mediaServer = { createClient: jest.fn().mockResolvedValue(client) };
    queue = { addEmbed: jest.fn().mockResolvedValue(undefined) };

    service = new SubtitleEmbedService(
      prisma as never,
      mediaServer as never,
      mediaRoots,
      queue as never,
      new ActiveEmbedGuard(prisma as never),
    );
  });

  describe('listing (REQ-1 REQ-2 NFR-2)', () => {
    it('answers [] and never builds a client for a non-administrator', async () => {
      prisma.user.findUnique.mockResolvedValue({ isAdmin: false });

      await expect(
        service.externalSubtitlesForMovie(1, admin),
      ).resolves.toEqual([]);
      await expect(
        service.externalSubtitlesForMovie(1, {
          type: 'service',
          name: 'worker',
        }),
      ).resolves.toEqual([]);

      expect(mediaServer.createClient).not.toHaveBeenCalled();
      expect(client.listItemSubtitles).not.toHaveBeenCalled();
    });

    it('answers [] instead of throwing when Jellyfin is unreachable', async () => {
      client.listItemSubtitles.mockRejectedValue(new Error('ECONNREFUSED'));

      await expect(
        service.externalSubtitlesForMovie(1, admin),
      ).resolves.toEqual([]);
    });

    it('answers [] for a media server that cannot list sidecars (none, Plex)', async () => {
      mediaServer.createClient.mockResolvedValue({ findByTmdbId: jest.fn() });
      await expect(
        service.externalSubtitlesForMovie(1, admin),
      ).resolves.toEqual([]);

      mediaServer.createClient.mockResolvedValue(null);
      await expect(
        service.externalSubtitlesForMovie(1, admin),
      ).resolves.toEqual([]);
    });

    it('answers [] when Jellyfin has no item for the title', async () => {
      client.findByTmdbId.mockResolvedValue(null);

      await expect(
        service.externalSubtitlesForMovie(1, admin),
      ).resolves.toEqual([]);
      expect(client.listItemSubtitles).not.toHaveBeenCalled();
    });

    it('exposes the file name as a base name, never a path, with no stream index', async () => {
      const result = await service.externalSubtitlesForMovie(1, admin);

      expect(result).toEqual([
        {
          fileName: 'Movie (2020).spa.srt',
          languageIso3: 'spa',
          isForced: true,
          title: 'Spanish - SUBRIP - External',
        },
        {
          fileName: 'Movie (2020).eng.srt',
          languageIso3: 'eng',
          isForced: false,
          title: 'Spanish - SUBRIP - External',
        },
      ]);
      expect(JSON.stringify(result)).not.toContain(hostLib);
    });

    it('costs one client call for N episodes of one series, and one admin read', async () => {
      const memo = newRequestMemo();

      const [a, b, c] = await Promise.all([
        service.externalSubtitlesForEpisode(1, admin, memo),
        service.externalSubtitlesForEpisode(2, admin, memo),
        service.externalSubtitlesForEpisode(3, admin, memo),
      ]);

      expect(client.listSeriesEpisodeSubtitles).toHaveBeenCalledTimes(1);
      expect(prisma.user.findUnique).toHaveBeenCalledTimes(1);
      expect(a).toHaveLength(1);
      expect(b).toHaveLength(1);
      expect(c).toHaveLength(1);
    });

    it('answers [] for an episode when the series read fails, and does not retry per episode', async () => {
      client.listSeriesEpisodeSubtitles.mockRejectedValue(new Error('boom'));
      const memo = newRequestMemo();

      await expect(
        service.externalSubtitlesForEpisode(1, admin, memo),
      ).resolves.toEqual([]);
      await expect(
        service.externalSubtitlesForEpisode(2, admin, memo),
      ).resolves.toEqual([]);
      expect(client.listSeriesEpisodeSubtitles).toHaveBeenCalledTimes(1);
    });

    it('reads the latest embed by creation time, newest id breaking a tie', async () => {
      prisma.subtitleEmbed.findFirst.mockResolvedValue({
        id: 9,
        status: 'FAILED',
        errorKey: 'error.subtitleEmbed.remux_failed',
        warningKey: null,
        createdAt: new Date('2026-10-23'),
        finishedAt: new Date('2026-10-23'),
        filePath: mkv,
        tracks: [],
        movieId: 1,
        episodeId: null,
      });

      const embed = await service.latestEmbedForMovie(1);

      expect(prisma.subtitleEmbed.findFirst).toHaveBeenCalledWith({
        where: { movieId: 1 },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      });
      expect(embed).toEqual({
        id: 9,
        status: 'FAILED',
        errorKey: 'error.subtitleEmbed.remux_failed',
        warningKey: null,
        createdAt: new Date('2026-10-23'),
        finishedAt: new Date('2026-10-23'),
      });

      prisma.subtitleEmbed.findFirst.mockResolvedValue(null);
      await expect(service.latestEmbedForEpisode(4)).resolves.toBeNull();
      expect(prisma.subtitleEmbed.findFirst).toHaveBeenLastCalledWith({
        where: { episodeId: 4 },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      });
    });
  });

  describe('embedding refusals, in the plan order (REQ-3 REQ-4 REQ-13 REQ-15 REQ-16)', () => {
    const embed = (subs: SubtitleEmbedInput[] = [input()]) =>
      service.embedMovie(1, subs, 'u1');

    function expectNothingQueued() {
      expect(prisma.subtitleEmbed.create).not.toHaveBeenCalled();
      expect(queue.addEmbed).not.toHaveBeenCalled();
    }

    it('refuses a film or episode the caller cannot see with the existing not-found keys', async () => {
      prisma.movie.findFirst.mockResolvedValue(null);
      expect(await key(embed())).toBe(ERROR_KEYS.MOVIE_NOT_FOUND);

      prisma.episode.findFirst.mockResolvedValue(null);
      expect(await key(service.embedEpisode(1, [input()], 'u1'))).toBe(
        ERROR_KEYS.EPISODE_NOT_FOUND,
      );
      expectNothingQueued();
    });

    it('refuses a media server that cannot list sidecars before any validation', async () => {
      mediaServer.createClient.mockResolvedValue({ findByTmdbId: jest.fn() });
      expect(await key(embed([]))).toBe(
        ERROR_KEYS.SUBTITLE_EMBED_UNSUPPORTED_MEDIA_SERVER,
      );

      mediaServer.createClient.mockResolvedValue(null);
      expect(await key(embed())).toBe(
        ERROR_KEYS.SUBTITLE_EMBED_UNSUPPORTED_MEDIA_SERVER,
      );
      expectNothingQueued();
    });

    it('refuses an empty selection', async () => {
      expect(await key(embed([]))).toBe(
        ERROR_KEYS.SUBTITLE_EMBED_EMPTY_SELECTION,
      );
    });

    it('refuses the same file name twice', async () => {
      expect(await key(embed([input(), input({ languageIso3: 'eng' })]))).toBe(
        ERROR_KEYS.SUBTITLE_EMBED_DUPLICATE_SUBTITLE,
      );
    });

    it('refuses two default tracks', async () => {
      expect(
        await key(
          embed([
            input({ isDefault: true }),
            input({
              fileName: 'Movie (2020).eng.srt',
              languageIso3: 'eng',
              isDefault: true,
            }),
          ]),
        ),
      ).toBe(ERROR_KEYS.SUBTITLE_EMBED_MULTIPLE_DEFAULTS);
    });

    it.each([600_001, -600_001])(
      'refuses an offset of %i',
      async (offsetMs) => {
        expect(await key(embed([input({ offsetMs })]))).toBe(
          ERROR_KEYS.SUBTITLE_EMBED_OFFSET_OUT_OF_RANGE,
        );
      },
    );

    it.each([600_000, -600_000])(
      'accepts the boundary offset %i',
      async (offsetMs) => {
        expect(await key(embed([input({ offsetMs })]))).toBeUndefined();
      },
    );

    it('refuses a language that is not in the Language table', async () => {
      prisma.language.findMany.mockResolvedValue([]);

      let thrown: HttpException | undefined;
      try {
        await embed([input({ languageIso3: 'zzz' })]);
      } catch (error) {
        thrown = error as HttpException;
      }
      expect((thrown!.getResponse() as { i18n: unknown }).i18n).toEqual({
        key: ERROR_KEYS.SUBTITLE_EMBED_UNKNOWN_LANGUAGE,
        params: { language: 'zzz' },
      });
    });

    it.each(['../Movie.srt', 'sub/Movie.srt', 'sub\\Movie.srt', '..'])(
      'treats the file name %p as a stale listing, never as a path',
      async (fileName) => {
        expect(await key(embed([input({ fileName })]))).toBe(
          ERROR_KEYS.SUBTITLE_EMBED_STALE_LISTING,
        );
        expectNothingQueued();
      },
    );

    it('refuses a title holding no file', async () => {
      prisma.movie.findFirst.mockResolvedValue({
        tmdbId: 603,
        filePath: null,
        mediaServerPresentAt: null,
      });
      expect(await key(embed())).toBe(ERROR_KEYS.SUBTITLE_EMBED_NO_FILE);
    });

    it('refuses a library file that is not an .mkv', async () => {
      prisma.movie.findFirst.mockResolvedValue({
        tmdbId: 603,
        filePath: join(libDir, 'Movie (2020).mp4'),
        mediaServerPresentAt: null,
      });
      expect(await key(embed())).toBe(ERROR_KEYS.SUBTITLE_EMBED_NOT_MKV);
    });

    it('refuses an .mkv outside the library root', async () => {
      prisma.movie.findFirst.mockResolvedValue({
        tmdbId: 603,
        filePath: join(libDir, '..', 'elsewhere', 'Movie.mkv'),
        mediaServerPresentAt: null,
      });
      expect(await key(embed())).toBe(
        ERROR_KEYS.SUBTITLE_EMBED_OUTSIDE_LIBRARY,
      );
    });

    it('refuses an .mkv that is gone from disk as no_file', async () => {
      prisma.movie.findFirst.mockResolvedValue({
        tmdbId: 603,
        filePath: join(libDir, 'Gone.mkv'),
        mediaServerPresentAt: null,
      });
      expect(await key(embed())).toBe(ERROR_KEYS.SUBTITLE_EMBED_NO_FILE);
    });

    describe('a title held only through the media server (REQ-13)', () => {
      beforeEach(() => {
        prisma.movie.findFirst.mockResolvedValue({
          tmdbId: 603,
          filePath: null,
          mediaServerPresentAt: new Date(),
        });
      });

      it("uses Jellyfin's path translated host to container", async () => {
        await embed();

        expect(prisma.subtitleEmbed.create).toHaveBeenCalledWith({
          data: containing({ movieId: 1, filePath: mkv }),
        });
      });

      it('refuses a Jellyfin path outside the library mount as outside_library', async () => {
        client.listItemSubtitles.mockResolvedValue({
          itemId: 'jf-1',
          mediaHostPath: '/other/mount/Movie (2020).mkv',
          subtitles: [stream('Movie (2020).spa.srt')],
        });
        expect(await key(embed())).toBe(
          ERROR_KEYS.SUBTITLE_EMBED_OUTSIDE_LIBRARY,
        );
      });

      it('refuses with no_file when Jellyfin has no item', async () => {
        client.findByTmdbId.mockResolvedValue(null);
        expect(await key(embed())).toBe(ERROR_KEYS.SUBTITLE_EMBED_NO_FILE);
      });
    });

    describe('busy (REQ-16)', () => {
      it('refuses while a source of the target is downloading, before reading Jellyfin', async () => {
        prisma.mediaSource.count.mockResolvedValue(1);

        expect(await key(embed())).toBe(ERROR_KEYS.SUBTITLE_EMBED_BUSY);

        expect(prisma.mediaSource.count).toHaveBeenCalledWith({
          where: {
            movieId: 1,
            retiredAt: null,
            status: { notIn: ['ERROR', 'SCANNED'] },
          },
        });
        expect(client.listItemSubtitles).not.toHaveBeenCalled();
        expectNothingQueued();
      });

      it('refuses while a job of the target is STOPPED, which still counts as in flight', async () => {
        prisma.processJob.count.mockResolvedValue(1);

        expect(await key(embed())).toBe(ERROR_KEYS.SUBTITLE_EMBED_BUSY);

        const where = firstArg<{
          where: { movieId: number; status: { in: string[] } };
        }>(prisma.processJob.count).where;
        expect(where.movieId).toBe(1);
        expect(where.status.in).toEqual(
          expect.arrayContaining(['WAITING', 'QUEUED', 'ENCODING', 'STOPPED']),
        );
        expectNothingQueued();
      });

      it('refuses an episode whose season has a pack in flight and the episode has aired', async () => {
        prisma.mediaSource.findMany.mockResolvedValue([
          { status: 'DOWNLOADING' },
        ]);

        expect(await key(service.embedEpisode(1, [input()], 'u1'))).toBe(
          ERROR_KEYS.SUBTITLE_EMBED_BUSY,
        );
        expect(prisma.mediaSource.findMany).toHaveBeenCalledWith({
          where: { seasonId: 9 },
          select: { status: true },
        });
        expectNothingQueued();
      });

      it('does not treat a scanned season pack as in flight', async () => {
        prisma.mediaSource.findMany.mockResolvedValue([{ status: 'SCANNED' }]);

        expect(
          await key(service.embedEpisode(1, [input()], 'u1')),
        ).toBeUndefined();
      });

      it('refuses while another embed of the target is queued or running', async () => {
        prisma.subtitleEmbed.count.mockResolvedValue(1);

        expect(await key(embed())).toBe(ERROR_KEYS.SUBTITLE_EMBED_BUSY);
        expect(prisma.subtitleEmbed.count).toHaveBeenCalledWith({
          where: { status: { in: ['QUEUED', 'RUNNING'] }, movieId: 1 },
        });
        expectNothingQueued();
      });

      it('refuses the second of two concurrent embeds that both passed the early check', async () => {
        prisma.subtitleEmbed.count
          .mockResolvedValueOnce(0)
          .mockResolvedValueOnce(1);

        expect(await key(embed())).toBe(ERROR_KEYS.SUBTITLE_EMBED_BUSY);

        expect(prisma.subtitleEmbed.create).not.toHaveBeenCalled();
        expect(queue.addEmbed).not.toHaveBeenCalled();
      });

      it('maps a lost serializable transaction (P2034) to busy', async () => {
        prisma.$transaction.mockRejectedValue(
          new Prisma.PrismaClientKnownRequestError('conflict', {
            code: 'P2034',
            clientVersion: 'test',
          }),
        );

        expect(await key(embed())).toBe(ERROR_KEYS.SUBTITLE_EMBED_BUSY);
        expect(queue.addEmbed).not.toHaveBeenCalled();
      });
    });

    describe('the Jellyfin re-read (REQ-15)', () => {
      it('maps an unreachable Jellyfin to media_server_unavailable', async () => {
        client.listItemSubtitles.mockRejectedValue(new Error('ECONNREFUSED'));

        expect(await key(embed())).toBe(
          ERROR_KEYS.SUBTITLE_EMBED_MEDIA_SERVER_UNAVAILABLE,
        );
        expectNothingQueued();
      });

      it('refuses a file name Jellyfin no longer lists', async () => {
        client.listItemSubtitles.mockResolvedValue({
          itemId: 'jf-1',
          mediaHostPath: `${hostLib}/Movie (2020).mkv`,
          subtitles: [stream('Movie (2020).eng.srt')],
        });

        expect(await key(embed())).toBe(
          ERROR_KEYS.SUBTITLE_EMBED_STALE_LISTING,
        );
        expectNothingQueued();
      });

      it('refuses a file name Jellyfin lists but that is gone from disk', async () => {
        client.listItemSubtitles.mockResolvedValue({
          itemId: 'jf-1',
          mediaHostPath: `${hostLib}/Movie (2020).mkv`,
          subtitles: [stream('Vanished.spa.srt')],
        });

        expect(
          await key(embed([input({ fileName: 'Vanished.spa.srt' })])),
        ).toBe(ERROR_KEYS.SUBTITLE_EMBED_STALE_LISTING);
        expectNothingQueued();
      });
    });
  });

  describe('a valid embed (REQ-5 REQ-14)', () => {
    it('stores the base language row title, never a regional variant, and enqueues once', async () => {
      const result = await service.embedMovie(
        1,
        [
          input({ offsetMs: 1200, isDefault: true }),
          input({ fileName: 'Movie (2020).eng.srt', languageIso3: 'eng' }),
        ],
        'u1',
      );

      const { data } = firstArg<{
        data: { filePath: string; movieId: number; tracks: unknown };
      }>(prisma.subtitleEmbed.create);
      expect(data.filePath).toBe(mkv);
      expect(data.movieId).toBe(1);
      expect(data.tracks).toEqual([
        {
          fileName: 'Movie (2020).spa.srt',
          languageIso3: 'spa',
          trackTitle: 'Español',
          isDefault: true,
          isForced: true,
          offsetMs: 1200,
        },
        {
          fileName: 'Movie (2020).eng.srt',
          languageIso3: 'eng',
          trackTitle: 'English',
          isDefault: false,
          isForced: false,
          offsetMs: 0,
        },
      ]);
      expect(queue.addEmbed).toHaveBeenCalledWith({ subtitleEmbedId: 5 });
      expect(result).toMatchObject({ id: 5, status: 'QUEUED' });
      expect(result).not.toHaveProperty('filePath');
    });

    it('falls back to the bare ISO code when only a variant row carries the language', async () => {
      prisma.language.findMany.mockResolvedValue([
        { tag: 'es-419', iso2: 'es', iso3: 'spa', trackTitle: 'Latino' },
      ]);

      await service.embedMovie(1, [input()], 'u1');

      expect(
        firstArg<{ data: { tracks: { trackTitle: string }[] } }>(
          prisma.subtitleEmbed.create,
        ).data.tracks[0].trackTitle,
      ).toBe('spa');
    });

    it('embeds an episode against its own row', async () => {
      await service.embedEpisode(1, [input()], 'u1');

      expect(prisma.subtitleEmbed.create).toHaveBeenCalledWith({
        data: containing({ episodeId: 1, filePath: mkv }),
      });
      expect(client.listSeriesEpisodeSubtitles).toHaveBeenCalledTimes(1);
    });

    it('removes the row when the enqueue fails, so the title is not busy forever', async () => {
      queue.addEmbed.mockRejectedValue(new Error('redis down'));

      await expect(service.embedMovie(1, [input()], 'u1')).rejects.toThrow(
        'redis down',
      );

      expect(prisma.subtitleEmbed.delete).toHaveBeenCalledWith({
        where: { id: 5 },
      });
    });
  });

  describe('worker reports (REQ-11 REQ-12)', () => {
    const row = (over: Record<string, unknown> = {}) => ({
      id: 5,
      status: 'RUNNING',
      filePath: mkv,
      tracks: [],
      ...over,
    });

    it('started is true only when the row moved out of QUEUED', async () => {
      expect(await service.started(5)).toBe(true);
      expect(prisma.subtitleEmbed.updateMany).toHaveBeenCalledWith({
        where: { id: 5, status: 'QUEUED' },
        data: { status: 'RUNNING' },
      });

      prisma.subtitleEmbed.updateMany.mockResolvedValue({ count: 0 });
      expect(await service.started(5)).toBe(false);
    });

    describe('completed', () => {
      it('moves RUNNING to COMPLETED and notifies Jellyfin once with the host path', async () => {
        prisma.subtitleEmbed.findUnique.mockResolvedValue(row());

        expect(await service.completed(5, null)).toBe(true);

        expect(prisma.subtitleEmbed.updateMany).toHaveBeenCalledWith({
          where: { id: 5, status: 'RUNNING' },
          data: {
            status: 'COMPLETED',
            warningKey: null,
            finishedAt: anyDate(),
          },
        });
        expect(client.modifiedMedia).toHaveBeenCalledTimes(1);
        expect(client.modifiedMedia).toHaveBeenCalledWith(
          `${hostLib}/Movie (2020).mkv`,
        );
        expect(prisma.subtitleEmbed.update).not.toHaveBeenCalled();
      });

      it('writes and notifies nothing on a repeat, and when it lost the claim', async () => {
        prisma.subtitleEmbed.findUnique.mockResolvedValue(
          row({ status: 'COMPLETED' }),
        );
        expect(await service.completed(5, null)).toBe(true);

        prisma.subtitleEmbed.findUnique.mockResolvedValue(row());
        prisma.subtitleEmbed.updateMany.mockResolvedValue({ count: 0 });
        expect(await service.completed(5, null)).toBe(true);

        expect(client.modifiedMedia).not.toHaveBeenCalled();
        expect(prisma.subtitleEmbed.update).not.toHaveBeenCalled();
        expect(prisma.subtitleEmbed.updateMany).toHaveBeenCalledTimes(1);
      });

      it('answers false for an embed that does not exist', async () => {
        prisma.subtitleEmbed.findUnique.mockResolvedValue(null);
        expect(await service.completed(5, null)).toBe(false);
      });

      it('records jellyfin_refresh_failed when the notification throws, and still answers true', async () => {
        prisma.subtitleEmbed.findUnique.mockResolvedValue(row());
        client.modifiedMedia.mockRejectedValue(new Error('503'));

        expect(await service.completed(5, null)).toBe(true);

        expect(prisma.subtitleEmbed.update).toHaveBeenCalledWith({
          where: { id: 5 },
          data: {
            warningKey: ERROR_KEYS.SUBTITLE_EMBED_JELLYFIN_REFRESH_FAILED,
          },
        });
      });

      it.each([
        [
          'no client at all',
          () => mediaServer.createClient.mockResolvedValue(null),
        ],
        [
          'a client that cannot be notified',
          () => mediaServer.createClient.mockResolvedValue({}),
        ],
      ])('records jellyfin_refresh_failed for %s', async (_name, arrange) => {
        prisma.subtitleEmbed.findUnique.mockResolvedValue(row());
        arrange();

        expect(await service.completed(5, null)).toBe(true);
        expect(prisma.subtitleEmbed.update).toHaveBeenCalledWith({
          where: { id: 5 },
          data: {
            warningKey: ERROR_KEYS.SUBTITLE_EMBED_JELLYFIN_REFRESH_FAILED,
          },
        });
      });

      it('records jellyfin_refresh_failed when the path has no host translation', async () => {
        prisma.subtitleEmbed.findUnique.mockResolvedValue(
          row({ filePath: '/not/in/the/library.mkv' }),
        );

        await service.completed(5, null);

        expect(client.modifiedMedia).not.toHaveBeenCalled();
        expect(prisma.subtitleEmbed.update).toHaveBeenCalledWith({
          where: { id: 5 },
          data: {
            warningKey: ERROR_KEYS.SUBTITLE_EMBED_JELLYFIN_REFRESH_FAILED,
          },
        });
      });

      it("keeps the worker's sidecar_delete_failed over a refresh failure", async () => {
        prisma.subtitleEmbed.findUnique.mockResolvedValue(row());
        client.modifiedMedia.mockRejectedValue(new Error('503'));

        await service.completed(
          5,
          ERROR_KEYS.SUBTITLE_EMBED_SIDECAR_DELETE_FAILED,
        );

        expect(prisma.subtitleEmbed.updateMany).toHaveBeenCalledWith({
          where: { id: 5, status: 'RUNNING' },
          data: containing({
            warningKey: ERROR_KEYS.SUBTITLE_EMBED_SIDECAR_DELETE_FAILED,
          }),
        });
        expect(prisma.subtitleEmbed.update).not.toHaveBeenCalled();
      });

      it('stores an unexpected worker warning as sidecar_delete_failed', async () => {
        prisma.subtitleEmbed.findUnique.mockResolvedValue(row());

        await service.completed(5, 'error.something.else');

        expect(prisma.subtitleEmbed.updateMany).toHaveBeenCalledWith({
          where: { id: 5, status: 'RUNNING' },
          data: containing({
            warningKey: ERROR_KEYS.SUBTITLE_EMBED_SIDECAR_DELETE_FAILED,
          }),
        });
      });
    });

    describe('failed', () => {
      it('stores a known key with a finishedAt', async () => {
        prisma.subtitleEmbed.findUnique.mockResolvedValue(row());

        expect(
          await service.failed(5, ERROR_KEYS.SUBTITLE_EMBED_CHARSET_UNDETECTED),
        ).toBe(true);

        expect(prisma.subtitleEmbed.updateMany).toHaveBeenCalledWith({
          where: { id: 5, status: { in: ['QUEUED', 'RUNNING'] } },
          data: {
            status: 'FAILED',
            errorKey: ERROR_KEYS.SUBTITLE_EMBED_CHARSET_UNDETECTED,
            finishedAt: anyDate(),
          },
        });
      });

      it('stores an unknown key as remux_failed', async () => {
        prisma.subtitleEmbed.findUnique.mockResolvedValue(row());

        await service.failed(5, 'error.nonsense');

        expect(prisma.subtitleEmbed.updateMany).toHaveBeenCalledWith({
          where: { id: 5, status: { in: ['QUEUED', 'RUNNING'] } },
          data: containing({
            errorKey: ERROR_KEYS.SUBTITLE_EMBED_REMUX_FAILED,
          }),
        });
      });

      it.each(['FAILED', 'COMPLETED'])(
        'writes nothing for a repeat on a %s row and answers true',
        async (status) => {
          prisma.subtitleEmbed.findUnique.mockResolvedValue(row({ status }));

          expect(
            await service.failed(5, ERROR_KEYS.SUBTITLE_EMBED_REMUX_FAILED),
          ).toBe(true);
          expect(prisma.subtitleEmbed.updateMany).not.toHaveBeenCalled();
        },
      );
    });

    describe('details', () => {
      it('answers for a FAILED row, with every sourcePath in the directory of filePath', async () => {
        prisma.subtitleEmbed.findUnique.mockResolvedValue(
          row({
            status: 'FAILED',
            tracks: [
              {
                fileName: 'Movie (2020).spa.srt',
                languageIso3: 'spa',
                trackTitle: 'Español',
                isDefault: true,
                isForced: false,
                offsetMs: 1200,
              },
            ],
          }),
        );

        const details = await service.details(5);

        expect(details).toEqual({
          id: 5,
          filePath: mkv,
          tracks: [
            {
              sourcePath: join(libDir, 'Movie (2020).spa.srt'),
              languageIso3: 'spa',
              trackTitle: 'Español',
              isDefault: true,
              isForced: false,
              offsetMs: 1200,
            },
          ],
        });
      });

      it('refuses an unknown id', async () => {
        prisma.subtitleEmbed.findUnique.mockResolvedValue(null);
        await expect(service.details(404)).rejects.toThrow('404');
      });
    });
  });
});
