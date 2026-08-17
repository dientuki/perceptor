import { Test, TestingModule } from '@nestjs/testing';
import { ProcessJobsService } from './process-jobs.service';
import { PrismaService } from '@/prisma/prisma.service';
import { QbittorrentClient } from '@/clients/torrent/client';
import { SettingsService } from '@/settings/settings.service';
import { MediaRootsService } from '@/media-roots/media-roots.service';
import { MediaServerService } from '@/media-server/media-server.service';

// This suite exists because getEncodeJobDetails's REQ-3 merge is the only
// place that decides which audio/subtitle languages an encode is allowed to
// keep. A wrong `where` clause here — scoping to the wrong id, reading the
// wrong join, or selecting `iso2` where `iso3` belongs — drops a language a
// user asked for. The encode still completes, ffprobe still reports valid
// output, and nothing anywhere logs an error: the user only finds out while
// watching a file that is missing a track (Article IX, spec.md's REQ-3/NFR-4).
describe('ProcessJobsService', () => {
  let service: ProcessJobsService;
  let prisma: {
    processJob: { findUnique: jest.Mock };
    language: { findUnique: jest.Mock };
    userMovie: { findMany: jest.Mock };
    userShow: { findMany: jest.Mock };
  };
  let settings: { getMap: jest.Mock };
  let mediaRoots: { resolveFromRoot: jest.Mock };

  beforeEach(async () => {
    prisma = {
      processJob: { findUnique: jest.fn() },
      language: { findUnique: jest.fn() },
      userMovie: { findMany: jest.fn() },
      userShow: { findMany: jest.fn() },
    };
    settings = { getMap: jest.fn().mockResolvedValue({ path_movies: 'Movies', path_shows: 'Shows' }) };
    mediaRoots = { resolveFromRoot: jest.fn().mockResolvedValue('/library/Movies') };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ProcessJobsService,
        { provide: PrismaService, useValue: prisma },
        { provide: QbittorrentClient, useValue: {} },
        { provide: SettingsService, useValue: settings },
        { provide: MediaRootsService, useValue: mediaRoots },
        { provide: MediaServerService, useValue: {} },
      ],
    }).compile();

    service = module.get<ProcessJobsService>(ProcessJobsService);
  });

  // A language row keyed by iso2, carrying both iso2 and iso3 — the shape
  // resolveIso3()/language.findUnique returns.
  const languageRow = (iso2: string, iso3: string) => ({ iso2, iso3 });

  const movieProcessJob = (overrides: Partial<Record<string, unknown>> = {}) => ({
    id: 1,
    status: 'QUEUED',
    sourceFile: {
      filePath: '/downloads/movie.mkv',
      mediaSource: { id: 10, kind: 'TORRENT_SEARCH', infoHash: 'abc', downloadPath: null },
    },
    movie: {
      id: 42,
      tmdbId: 999,
      title: 'A Japanese Film',
      releaseDate: new Date('2020-01-01'),
      originalLanguage: 'ja',
      isLiveAction: true,
    },
    episode: null,
    ...overrides,
  });

  const episodeProcessJob = (overrides: Partial<Record<string, unknown>> = {}) => ({
    id: 2,
    status: 'QUEUED',
    sourceFile: {
      filePath: '/downloads/episode.mkv',
      mediaSource: { id: 11, kind: 'TORRENT_SEARCH', infoHash: 'def', downloadPath: null },
    },
    movie: null,
    episode: {
      episodeNumber: 3,
      title: 'The One With The Bug',
      season: {
        seasonNumber: 1,
        show: {
          id: 77,
          tmdbId: 888,
          title: 'A Japanese Show',
          releaseDate: new Date('2019-01-01'),
          originalLanguage: 'ja',
          isLiveAction: true,
        },
      },
    },
    ...overrides,
  });

  // Owner row shape returned by both userMovie.findMany and userShow.findMany
  // with the `select` used in the service — nested global (user.languages)
  // and per-title (languages) preferences.
  const owner = (globalIso3s: string[], titleIso3s: string[]) => ({
    user: { languages: globalIso3s.map((iso3) => ({ language: { iso3 } })) },
    languages: titleIso3s.map((iso3) => ({ language: { iso3 } })),
  });

  // This block exists because getEncodeJobDetails's downloadsRoot is the only
  // input the worker's cleanup containment check (REQ-12) has to decide
  // whether a path is safe to delete. Resolving the narrower `path_downloads`
  // setting instead of the downloads root itself would make every uploaded
  // file — staged under `<root>/imports/<uploadId>`, outside `path_downloads`
  // — fail that check, so cleanup would silently skip it forever, with no
  // error anywhere and the disk filling up (012-post-download-processing's
  // REQ-10/REQ-12, and the bug this feature exists to fix).
  describe('getEncodeJobDetails — downloadsRoot', () => {
    it('resolves the downloads root itself, not the path_downloads setting', async () => {
      prisma.processJob.findUnique.mockResolvedValue(movieProcessJob());
      prisma.language.findUnique.mockResolvedValue(languageRow('ja', 'jpn'));
      prisma.userMovie.findMany.mockResolvedValue([]);

      await service.getEncodeJobDetails(1);

      expect(mediaRoots.resolveFromRoot).toHaveBeenCalledWith('downloads', '.');
    });

    it('carries the resolved downloads root on a MOVIE payload', async () => {
      prisma.processJob.findUnique.mockResolvedValue(movieProcessJob());
      prisma.language.findUnique.mockResolvedValue(languageRow('ja', 'jpn'));
      prisma.userMovie.findMany.mockResolvedValue([]);
      mediaRoots.resolveFromRoot.mockImplementation((rootId: string) =>
        Promise.resolve(rootId === 'downloads' ? '/downloads' : '/library/Movies'),
      );

      const details = await service.getEncodeJobDetails(1);

      expect(details.downloadsRoot).toBe('/downloads');
    });

    it('carries the resolved downloads root on an EPISODE payload', async () => {
      prisma.processJob.findUnique.mockResolvedValue(episodeProcessJob());
      prisma.language.findUnique.mockResolvedValue(languageRow('ja', 'jpn'));
      prisma.userShow.findMany.mockResolvedValue([]);
      mediaRoots.resolveFromRoot.mockImplementation((rootId: string) =>
        Promise.resolve(rootId === 'downloads' ? '/downloads' : '/library/Shows'),
      );

      const details = await service.getEncodeJobDetails(2);

      expect(details.downloadsRoot).toBe('/downloads');
    });
  });

  describe('getEncodeJobDetails — REQ-3 language merge', () => {
    it('unions two owners with different global preferences and one per-title extra', async () => {
      prisma.processJob.findUnique.mockResolvedValue(movieProcessJob());
      prisma.language.findUnique.mockResolvedValue(languageRow('ja', 'jpn'));
      prisma.userMovie.findMany.mockResolvedValue([
        owner(['spa'], []),
        owner([], ['eng']),
      ]);

      const details = await service.getEncodeJobDetails(1);

      expect(details.allowedLanguagesIso3.sort()).toEqual(['eng', 'jpn', 'spa'].sort());
    });

    it('always includes the original language even with zero preferences', async () => {
      prisma.processJob.findUnique.mockResolvedValue(movieProcessJob());
      prisma.language.findUnique.mockResolvedValue(languageRow('ja', 'jpn'));
      prisma.userMovie.findMany.mockResolvedValue([owner([], [])]);

      const details = await service.getEncodeJobDetails(1);

      expect(details.allowedLanguagesIso3).toEqual(['jpn']);
    });

    it('returns iso3 codes, not iso2 — fails if the join selects the wrong field', async () => {
      prisma.processJob.findUnique.mockResolvedValue(movieProcessJob());
      prisma.language.findUnique.mockResolvedValue(languageRow('ja', 'jpn'));
      prisma.userMovie.findMany.mockResolvedValue([owner(['spa'], [])]);

      const details = await service.getEncodeJobDetails(1);

      // Asserting the real ISO-639-2 code ('spa'), not the ISO-639-1 one
      // ('es') that would leak through if the select were switched to
      // `language.iso2` — that mistake would still produce a two-element
      // array and pass a looser assertion, so the exact string matters.
      expect(details.allowedLanguagesIso3).toContain('spa');
      expect(details.allowedLanguagesIso3).not.toContain('es');
    });

    it('resolves an episode\'s owners through season.show, not through the episode', async () => {
      prisma.processJob.findUnique.mockResolvedValue(episodeProcessJob());
      prisma.language.findUnique.mockResolvedValue(languageRow('ja', 'jpn'));
      prisma.userShow.findMany.mockResolvedValue([owner(['eng'], [])]);

      const details = await service.getEncodeJobDetails(2);

      expect(prisma.userShow.findMany).toHaveBeenCalledTimes(1);
      const [args] = prisma.userShow.findMany.mock.calls[0];
      // The failure this guards against: scoping the owner lookup to the
      // episode (which has no owners of its own) instead of to
      // episode.season.showId would silently return an empty owner set for
      // every episode, even when the show has real language preferences.
      expect(args.where).toEqual({ showId: 77 });
      expect(details.allowedLanguagesIso3.sort()).toEqual(['eng', 'jpn'].sort());
    });

    it('returns exactly one element — the original — for a title with no owners', async () => {
      prisma.processJob.findUnique.mockResolvedValue(movieProcessJob());
      prisma.language.findUnique.mockResolvedValue(languageRow('ja', 'jpn'));
      prisma.userMovie.findMany.mockResolvedValue([]);

      const details = await service.getEncodeJobDetails(1);

      expect(details.allowedLanguagesIso3).toEqual(['jpn']);
    });
  });
});
