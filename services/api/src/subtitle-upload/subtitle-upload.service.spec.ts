import { HttpException } from '@nestjs/common';
import {
  mkdtemp,
  mkdir,
  readFile,
  readdir,
  rm,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ERROR_KEYS } from '@/i18n/error-keys';
import { MediaRootsService } from '@/media-roots/media-roots.service';
import { ActiveEmbedGuard } from '@/subtitle-embed/active-embed.guard';
import { SubtitleEmbedService } from '@/subtitle-embed/subtitle-embed.service';
import { SubtitleEmbedSyncService } from '@/subtitle-embed/subtitle-embed-sync.service';
import { SubtitleUploadStaging } from '@/subtitle-embed/upload-staging';
import { SubtitleUploadInput } from './dto/subtitle-upload.input';
import { SubtitleUploadService } from './subtitle-upload.service';

const containing = <T extends object>(shape: T): T =>
  expect.objectContaining(shape) as T;

// This suite exists because every refusal and every stored choice of an upload is silent when it
// breaks: a request that is not refused before staging leaves subtitle copies under the downloads
// root for an embed that never existed, a regional variant stored under the base title (`Español`
// instead of `Latino`) mislabels the track forever, a forced or default flag that does not reach
// the stored track is dropped with no error, a replace for a language the file does not hold drops
// nothing and says nothing, and a non-owner who is not refused writes into someone else's library.
// It runs the real SubtitleEmbedService, MediaRootsService, ActiveEmbedGuard and staging over a
// temp directory, with only Prisma, the queues and the library lookup faked (Article IX, Spec 124,
// REQ-2 REQ-4 REQ-6 REQ-7 REQ-9 REQ-10 REQ-11 REQ-12).
describe('SubtitleUploadService', () => {
  type Model = Record<string, jest.Mock>;
  let baseDir: string;
  let libDir: string;
  let mkv: string;
  let mediaRoots: MediaRootsService;
  let prisma: {
    movie: Model;
    episode: Model;
    language: Model;
    mediaSource: Model;
    processJob: Model;
    subtitleEmbed: Model;
    subtitleSearch: Model;
    $transaction: jest.Mock;
  };
  let queue: { addEmbed: jest.Mock };
  let syncQueue: { addEmbedSync: jest.Mock };
  let location: { locate: jest.Mock };
  let service: SubtitleUploadService;

  const cue = '1\n00:01:20,000 --> 00:01:30,000\nhi\n';
  const b64 = (text: string | Buffer) => Buffer.from(text).toString('base64');

  const input = (
    over: Partial<SubtitleUploadInput> = {},
  ): SubtitleUploadInput => ({
    fileName: 'Green Book (2018).es-419.srt',
    contentBase64: b64(cue),
    languageTag: 'es-419',
    isForced: false,
    isDefault: false,
    replace: false,
    offsetMs: 0,
    autoOffset: false,
    ...over,
  });

  const movie = (over: Record<string, unknown> = {}) => ({
    tmdbId: 603,
    filePath: mkv,
    mediaServerPresentAt: null,
    fileSubtitleLanguages: ['eng'],
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

  const stagedFiles = async (): Promise<string[]> => {
    try {
      return await readdir(
        join(baseDir, 'downloads', '.perceptor', 'subtitle-upload'),
      );
    } catch {
      return [];
    }
  };

  const created = () =>
    (
      prisma.subtitleEmbed.create.mock.calls[0] as [
        { data: { status: string; tracks: Record<string, unknown>[] } },
      ]
    )[0].data;

  beforeAll(async () => {
    baseDir = await mkdtemp(join(tmpdir(), 'subtitle-upload-spec-'));
    libDir = join(baseDir, 'library');
    await mkdir(libDir, { recursive: true });
    await mkdir(join(baseDir, 'downloads'), { recursive: true });
    mkv = join(libDir, 'Movie (2020).mkv');
    await writeFile(mkv, 'mkv');
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
        containerPath: join(baseDir, 'downloads'),
      },
    ]);
  });

  afterAll(async () => {
    await rm(baseDir, { recursive: true, force: true });
  });

  beforeEach(async () => {
    await rm(join(baseDir, 'downloads', '.perceptor'), {
      recursive: true,
      force: true,
    });
    prisma = {
      movie: { findFirst: jest.fn().mockResolvedValue(movie()) },
      episode: { findFirst: jest.fn() },
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
            errorKey: null,
            warningKey: null,
            createdAt: new Date('2026-11-24'),
            finishedAt: null,
            ...data,
          }),
        ),
        update: jest.fn().mockResolvedValue({}),
        delete: jest.fn().mockResolvedValue({}),
      },
      subtitleSearch: { count: jest.fn().mockResolvedValue(0) },
      $transaction: jest.fn(),
    };
    prisma.$transaction.mockImplementation(
      (callback: (tx: unknown) => Promise<unknown>) => callback(prisma),
    );
    queue = { addEmbed: jest.fn().mockResolvedValue(undefined) };
    syncQueue = { addEmbedSync: jest.fn().mockResolvedValue(undefined) };
    location = { locate: jest.fn() };

    const staging = new SubtitleUploadStaging(mediaRoots, prisma as never);
    const embed = new SubtitleEmbedService(
      prisma as never,
      { createClient: jest.fn().mockResolvedValue(null) } as never,
      mediaRoots,
      queue as never,
      new ActiveEmbedGuard(prisma as never),
      { request: jest.fn() } as never,
      new SubtitleEmbedSyncService(
        prisma as never,
        syncQueue as never,
        queue as never,
        staging,
      ),
      staging,
    );
    service = new SubtitleUploadService(
      prisma as never,
      embed,
      staging,
      location as never,
    );
  });

  const upload = (inputs: SubtitleUploadInput[], userId = 'u1') =>
    service.upload({ kind: 'movie', id: 1 }, inputs, userId);

  describe('refusals, before anything is staged or queued', () => {
    afterEach(async () => {
      expect(prisma.subtitleEmbed.create).not.toHaveBeenCalled();
      expect(queue.addEmbed).not.toHaveBeenCalled();
      expect(syncQueue.addEmbedSync).not.toHaveBeenCalled();
      expect(await stagedFiles()).toEqual([]);
    });

    it('refuses a caller who does not own the film', async () => {
      prisma.movie.findFirst.mockResolvedValue(null);

      expect(await key(upload([input()], 'stranger'))).toBe(
        ERROR_KEYS.MOVIE_NOT_FOUND,
      );
      expect(prisma.movie.findFirst).toHaveBeenCalledWith(
        containing({
          where: { id: 1, users: { some: { userId: 'stranger' } } },
        }),
      );
    });

    it('refuses an empty selection and nine entries', async () => {
      expect(await key(upload([]))).toBe(
        ERROR_KEYS.SUBTITLE_EMBED_EMPTY_SELECTION,
      );
      const nine = Array.from({ length: 9 }, (_, index) =>
        input({ fileName: `s${index}.srt` }),
      );
      expect(await key(upload(nine))).toBe(
        ERROR_KEYS.SUBTITLE_EMBED_UPLOAD_TOO_MANY,
      );
    });

    it.each(['x.txt', '../a.srt', 'dir/a.srt', 'a\\b.srt', '.srt'])(
      'refuses the file name %j as not an srt',
      async (fileName) => {
        expect(await key(upload([input({ fileName })]))).toBe(
          ERROR_KEYS.SUBTITLE_EMBED_UPLOAD_NOT_SRT,
        );
      },
    );

    it('refuses the same name twice and two defaults', async () => {
      expect(await key(upload([input(), input()]))).toBe(
        ERROR_KEYS.SUBTITLE_EMBED_DUPLICATE_SUBTITLE,
      );
      expect(
        await key(
          upload([
            input({ isDefault: true }),
            input({ fileName: 'b.srt', isDefault: true }),
          ]),
        ),
      ).toBe(ERROR_KEYS.SUBTITLE_EMBED_MULTIPLE_DEFAULTS);
    });

    it('refuses a language tag outside the catalog', async () => {
      expect(await key(upload([input({ languageTag: 'xx' })]))).toBe(
        ERROR_KEYS.SUBTITLE_EMBED_UNKNOWN_LANGUAGE,
      );
    });

    it('refuses a manual offset out of range', async () => {
      expect(await key(upload([input({ offsetMs: 600_001 })]))).toBe(
        ERROR_KEYS.SUBTITLE_EMBED_OFFSET_OUT_OF_RANGE,
      );
    });

    it('refuses replace on a forced row', async () => {
      expect(
        await key(upload([input({ replace: true, isForced: true })])),
      ).toBe(ERROR_KEYS.SUBTITLE_EMBED_REPLACE_FORCED);
    });

    it('refuses replace for a language the file does not hold, and when the column was never read', async () => {
      expect(await key(upload([input({ replace: true })]))).toBe(
        ERROR_KEYS.SUBTITLE_SEARCH_REPLACE_LANGUAGE_NOT_PRESENT,
      );

      prisma.movie.findFirst.mockResolvedValue(
        movie({ fileSubtitleLanguages: null }),
      );
      expect(await key(upload([input({ replace: true })]))).toBe(
        ERROR_KEYS.SUBTITLE_SEARCH_REPLACE_LANGUAGE_NOT_PRESENT,
      );
    });

    it('refuses a body that is not an srt, an undetected charset and an oversized file', async () => {
      expect(
        await key(upload([input({ contentBase64: b64('just prose') })])),
      ).toBe(ERROR_KEYS.SUBTITLE_EMBED_UPLOAD_NOT_SRT);
      expect(
        await key(
          upload([input({ contentBase64: b64(Buffer.from([0, 1, 0, 2])) })]),
        ),
      ).toBe(ERROR_KEYS.SUBTITLE_EMBED_CHARSET_UNDETECTED);
      expect(
        await key(
          upload([
            input({
              contentBase64: b64(Buffer.alloc(2 * 1024 * 1024 + 1, 0x61)),
            }),
          ]),
        ),
      ).toBe(ERROR_KEYS.SUBTITLE_EMBED_UPLOAD_TOO_LARGE);
    });

    it('refuses a title that holds no file', async () => {
      prisma.movie.findFirst.mockResolvedValue(movie({ filePath: null }));

      expect(await key(upload([input()]))).toBe(
        ERROR_KEYS.SUBTITLE_EMBED_NO_FILE,
      );
    });

    it('refuses a busy title and leaves nothing staged', async () => {
      prisma.mediaSource.count.mockResolvedValue(1);

      expect(await key(upload([input()]))).toBe(ERROR_KEYS.SUBTITLE_EMBED_BUSY);
    });

    it('refuses while a subtitle search of the title is not terminal', async () => {
      prisma.subtitleSearch.count.mockResolvedValue(1);

      expect(await key(upload([input()]))).toBe(
        ERROR_KEYS.SUBTITLE_SEARCH_IN_PROGRESS,
      );
      expect(prisma.subtitleSearch.count).toHaveBeenCalledWith({
        where: {
          movieId: 1,
          status: { in: ['WAITING', 'SEARCHING', 'VALIDATING', 'EMBEDDING'] },
        },
      });
    });
  });

  describe('a title held only through the media server (REQ-10)', () => {
    beforeEach(() => {
      prisma.movie.findFirst.mockResolvedValue(
        movie({ filePath: null, mediaServerPresentAt: new Date() }),
      );
    });

    it('answers 503 with the subtitleEmbed key when the media server cannot be reached', async () => {
      location.locate.mockResolvedValue({ reason: 'unavailable' });

      const error = await upload([input()]).catch((e: HttpException) => e);

      expect((error as HttpException).getStatus()).toBe(503);
      expect(await key(upload([input()]))).toBe(
        ERROR_KEYS.SUBTITLE_EMBED_MEDIA_SERVER_UNAVAILABLE,
      );
      expect(prisma.subtitleEmbed.create).not.toHaveBeenCalled();
    });

    it('maps a path outside the library and a title the server does not hold', async () => {
      location.locate.mockResolvedValueOnce({ reason: 'outside_library' });
      expect(await key(upload([input()]))).toBe(
        ERROR_KEYS.SUBTITLE_EMBED_OUTSIDE_LIBRARY,
      );
      location.locate.mockResolvedValueOnce({ reason: 'not_held' });
      expect(await key(upload([input()]))).toBe(
        ERROR_KEYS.SUBTITLE_EMBED_NO_FILE,
      );
    });

    it('embeds into the located path', async () => {
      location.locate.mockResolvedValue({ path: mkv });

      await upload([input()]);

      expect(prisma.subtitleEmbed.create).toHaveBeenCalledWith({
        data: containing({ filePath: mkv }),
      });
    });
  });

  describe('an accepted upload', () => {
    // This test exists because otherwise a declared regional variant is stored under the base language title and the track reads `Español` instead of `Latino` forever.
    it('stores the variant title, provider user, the file name as provenance and a staged non-sidecar path', async () => {
      await upload([input()]);

      const { status, tracks } = created();
      expect(status).toBe('QUEUED');
      expect(tracks).toEqual([
        containing({
          fileName: 'Green Book (2018).es-419.srt',
          languageIso3: 'spa',
          trackTitle: 'Latino',
          provider: 'user',
          provenance: 'Green Book (2018).es-419.srt',
          offsetMs: 0,
        }),
      ]);
      const staged = tracks[0].stagedPath as string;
      expect(staged).toBe(
        join(
          baseDir,
          'downloads',
          '.perceptor',
          'subtitle-upload',
          '5',
          '0.srt',
        ),
      );
      expect(await stagedFiles()).toEqual(['5']);
      expect(queue.addEmbed).toHaveBeenCalledWith({ subtitleEmbedId: 5 });
    });

    it('stores a plain language under its base title', async () => {
      await upload([input({ languageTag: 'en', fileName: 'a.srt' })]);

      expect(created().tracks[0]).toMatchObject({
        languageIso3: 'eng',
        trackTitle: 'English',
      });
    });

    it('carries the default and forced flags and the manual offset to the stored track', async () => {
      await upload([
        input({ isDefault: true, isForced: true, offsetMs: 1500 }),
        input({ fileName: 'b.srt', languageTag: 'en', offsetMs: -250 }),
      ]);

      expect(created().tracks).toEqual([
        containing({ isDefault: true, isForced: true, offsetMs: 1500 }),
        containing({ isDefault: false, isForced: false, offsetMs: -250 }),
      ]);
    });

    it('creates the embed SYNCING for an automatic row and measures it instead of queueing the remux', async () => {
      await upload([input({ autoOffset: true, offsetMs: 9_999_999 })]);

      expect(created().status).toBe('SYNCING');
      expect(created().tracks[0]).toMatchObject({
        autoOffset: true,
        offsetMs: 0,
      });
      expect(syncQueue.addEmbedSync).toHaveBeenCalledTimes(1);
      expect(queue.addEmbed).not.toHaveBeenCalled();
    });

    it('stores the replace languages once and writes the normalized UTF-8 bytes', async () => {
      prisma.movie.findFirst.mockResolvedValue(
        movie({ fileSubtitleLanguages: ['SPA', 'eng'] }),
      );

      await upload([
        input({
          replace: true,
          contentBase64: b64(Buffer.from(`${cue}¿Señor?\n`, 'latin1')),
        }),
        input({ fileName: 'b.srt', languageTag: 'es', replace: true }),
      ]);

      expect(prisma.subtitleEmbed.create).toHaveBeenCalledWith({
        data: containing({ replaceLanguages: ['spa'] }),
      });
      const staged = await readFile(
        created().tracks[0].stagedPath as string,
        'utf8',
      );
      expect(staged).toContain('¿Señor?');
    });

    it('answers an internal server error and leaves no row when staging fails', async () => {
      const blocker = join(baseDir, 'downloads', '.perceptor');
      await mkdir(blocker, { recursive: true });
      await writeFile(join(blocker, 'subtitle-upload'), 'not a directory');

      const error = await upload([input()]).catch((e: HttpException) => e);

      expect((error as HttpException).getStatus()).toBe(500);
      expect(
        ((error as HttpException).getResponse() as { i18n: { key: string } })
          .i18n.key,
      ).toBe(ERROR_KEYS.SUBTITLE_EMBED_UPLOAD_STAGING_FAILED);
      expect(prisma.subtitleEmbed.delete).toHaveBeenCalledWith({
        where: { id: 5 },
      });
      expect(queue.addEmbed).not.toHaveBeenCalled();
    });
  });
});
