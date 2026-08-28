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
    processJob: { findUnique: jest.Mock; update: jest.Mock; findMany: jest.Mock };
    language: { findUnique: jest.Mock; findMany: jest.Mock };
    userMovie: { findMany: jest.Mock };
    userShow: { findMany: jest.Mock };
    movie: { update: jest.Mock };
    episode: { update: jest.Mock };
    mediaSource: { findUnique: jest.Mock; findMany: jest.Mock; delete: jest.Mock };
  };
  let settings: { getMap: jest.Mock };
  let mediaRoots: { resolveFromRoot: jest.Mock };
  let mediaServer: { notifyCreated: jest.Mock };
  let torrentClient: { remove: jest.Mock };

  beforeEach(async () => {
    prisma = {
      processJob: { findUnique: jest.fn(), update: jest.fn(), findMany: jest.fn() },
      language: { findUnique: jest.fn(), findMany: jest.fn().mockResolvedValue([]) },
      userMovie: { findMany: jest.fn() },
      userShow: { findMany: jest.fn() },
      movie: { update: jest.fn() },
      episode: { update: jest.fn() },
      mediaSource: { findUnique: jest.fn(), findMany: jest.fn().mockResolvedValue([]), delete: jest.fn() },
    };
    settings = { getMap: jest.fn().mockResolvedValue({ path_movies: 'Movies', path_shows: 'Shows' }) };
    mediaRoots = { resolveFromRoot: jest.fn().mockResolvedValue('/library/Movies') };
    mediaServer = { notifyCreated: jest.fn().mockResolvedValue(undefined) };
    torrentClient = { remove: jest.fn().mockResolvedValue(undefined) };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ProcessJobsService,
        { provide: PrismaService, useValue: prisma },
        { provide: QbittorrentClient, useValue: torrentClient },
        { provide: SettingsService, useValue: settings },
        { provide: MediaRootsService, useValue: mediaRoots },
        { provide: MediaServerService, useValue: mediaServer },
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
  // with the `select` used in the service — per-title (languages) preference
  // only. The global level (029) is a `default_languages` setting, not a
  // per-owner row anymore.
  const owner = (titleIso3s: string[]) => ({
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

  describe('getEncodeJobDetails — REQ-3/REQ-8 language merge', () => {
    it('unions the original language, the installation default and one per-title extra', async () => {
      prisma.processJob.findUnique.mockResolvedValue(movieProcessJob());
      // resolveIso3 (original language) and resolveDefaultLanguagesIso3
      // (default_languages) both call language table methods, so both must
      // be stubbed distinctly.
      prisma.language.findUnique.mockResolvedValue(languageRow('ja', 'jpn'));
      prisma.language.findMany.mockResolvedValue([{ iso2: 'es', iso3: 'spa' }]);
      settings.getMap.mockResolvedValue({ path_movies: 'Movies', path_shows: 'Shows', default_languages: 'es' });
      prisma.userMovie.findMany.mockResolvedValue([owner(['eng'])]);

      const details = await service.getEncodeJobDetails(1);

      expect(details.allowedLanguagesIso3.sort()).toEqual(['eng', 'jpn', 'spa'].sort());
    });

    it('always includes the original language even with zero preferences and no default set', async () => {
      prisma.processJob.findUnique.mockResolvedValue(movieProcessJob());
      prisma.language.findUnique.mockResolvedValue(languageRow('ja', 'jpn'));
      prisma.userMovie.findMany.mockResolvedValue([owner([])]);

      const details = await service.getEncodeJobDetails(1);

      expect(details.allowedLanguagesIso3).toEqual(['jpn']);
    });

    it('returns iso3 codes, not iso2 — fails if the join selects the wrong field', async () => {
      prisma.processJob.findUnique.mockResolvedValue(movieProcessJob());
      prisma.language.findUnique.mockResolvedValue(languageRow('ja', 'jpn'));
      prisma.userMovie.findMany.mockResolvedValue([owner(['spa'])]);

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
      prisma.userShow.findMany.mockResolvedValue([owner(['eng'])]);

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

    // AC-8 / T011: the plan's headline silent failure — a forgotten
    // `default_languages` read narrows every future encode with no error.
    // This asserts the setting's codes land in the union alongside a
    // per-title preference, original first, deduplicated.
    it('unions default_languages with a per-title preference, original first, no duplicates', async () => {
      prisma.processJob.findUnique.mockResolvedValue(movieProcessJob());
      prisma.language.findUnique.mockResolvedValue(languageRow('ja', 'jpn'));
      prisma.language.findMany.mockResolvedValue([{ iso2: 'es', iso3: 'spa' }]);
      settings.getMap.mockResolvedValue({ path_movies: 'Movies', path_shows: 'Shows', default_languages: 'es' });
      prisma.userMovie.findMany.mockResolvedValue([owner(['fra'])]);

      const details = await service.getEncodeJobDetails(1);

      expect(details.allowedLanguagesIso3[0]).toBe('jpn');
      expect(details.allowedLanguagesIso3.sort()).toEqual(['fra', 'jpn', 'spa'].sort());
      expect(new Set(details.allowedLanguagesIso3).size).toBe(details.allowedLanguagesIso3.length);
    });
  });

  // This block exists because encodeCompleted's three cleanup instructions
  // (013-season-pack-processing, REQ-8/REQ-9/REQ-10/REQ-11) are the only
  // signal the worker gets for when it is safe to delete a file. A wrong
  // verdict here either deletes the input of a sibling episode that hasn't
  // encoded yet — with every job still reporting COMPLETED — or never
  // deletes the download path at all, filling the disk. Neither failure
  // logs anything; the only proof is watching what a retry needs disappear
  // or a folder never go away.
  describe('encodeCompleted — cleanup verdict', () => {
    // The completed job's own update() result, shaped like a single-job
    // (film/episode) source unless overridden.
    const completedJob = (overrides: Partial<Record<string, unknown>> = {}) => ({
      id: 1,
      movieId: 42,
      episodeId: null,
      sourceFile: { mediaSourceId: 10 },
      ...overrides,
    });

    beforeEach(() => {
      prisma.movie.update.mockResolvedValue({});
      prisma.episode.update.mockResolvedValue({});
    });

    it('single-job source: (removeTorrent: true, deleteInputFile: false, deleteDownloadPath: true)', async () => {
      prisma.processJob.update.mockResolvedValue(completedJob());
      prisma.processJob.findMany.mockResolvedValue([{ id: 1, status: 'COMPLETED' }]);
      prisma.mediaSource.findUnique.mockResolvedValue({ hasUnmatchedFiles: false });

      const result = await service.encodeCompleted(1, '/library/movie.mkv', 'ffmpeg …');

      expect(result.removeTorrent).toBe(true);
      expect(result.deleteInputFile).toBe(false);
      expect(result.deleteDownloadPath).toBe(true);
    });

    it('a middle job of a three-episode pack: (false, true, false)', async () => {
      prisma.processJob.update.mockResolvedValue(completedJob({ movieId: null, episodeId: 2 }));
      prisma.processJob.findMany.mockResolvedValue([
        { id: 1, status: 'COMPLETED' },
        { id: 2, status: 'COMPLETED' },
        { id: 3, status: 'ENCODING' },
      ]);
      prisma.mediaSource.findUnique.mockResolvedValue({ hasUnmatchedFiles: false });

      const result = await service.encodeCompleted(2, '/library/ep2.mkv', 'ffmpeg …');

      expect(result.removeTorrent).toBe(false);
      expect(result.deleteInputFile).toBe(true);
      expect(result.deleteDownloadPath).toBe(false);
    });

    it('last job of a pack with every sibling COMPLETED: (true, true, true)', async () => {
      prisma.processJob.update.mockResolvedValue(completedJob({ movieId: null, episodeId: 3 }));
      prisma.processJob.findMany.mockResolvedValue([
        { id: 1, status: 'COMPLETED' },
        { id: 2, status: 'COMPLETED' },
        { id: 3, status: 'COMPLETED' },
      ]);
      prisma.mediaSource.findUnique.mockResolvedValue({ hasUnmatchedFiles: false });

      const result = await service.encodeCompleted(3, '/library/ep3.mkv', 'ffmpeg …');

      expect(result.removeTorrent).toBe(true);
      expect(result.deleteInputFile).toBe(true);
      expect(result.deleteDownloadPath).toBe(true);
    });

    it('last job to finish, but a sibling ended in ERROR: (true, true, false)', async () => {
      prisma.processJob.update.mockResolvedValue(completedJob({ movieId: null, episodeId: 3 }));
      prisma.processJob.findMany.mockResolvedValue([
        { id: 1, status: 'COMPLETED' },
        { id: 2, status: 'ERROR' },
        { id: 3, status: 'COMPLETED' },
      ]);
      prisma.mediaSource.findUnique.mockResolvedValue({ hasUnmatchedFiles: false });

      const result = await service.encodeCompleted(3, '/library/ep3.mkv', 'ffmpeg …');

      expect(result.removeTorrent).toBe(true);
      expect(result.deleteInputFile).toBe(true);
      expect(result.deleteDownloadPath).toBe(false);
    });

    it('last job to finish, every sibling COMPLETED, but hasUnmatchedFiles: (true, true, false)', async () => {
      prisma.processJob.update.mockResolvedValue(completedJob({ movieId: null, episodeId: 3 }));
      prisma.processJob.findMany.mockResolvedValue([
        { id: 1, status: 'COMPLETED' },
        { id: 2, status: 'COMPLETED' },
        { id: 3, status: 'COMPLETED' },
      ]);
      prisma.mediaSource.findUnique.mockResolvedValue({ hasUnmatchedFiles: true });

      const result = await service.encodeCompleted(3, '/library/ep3.mkv', 'ffmpeg …');

      expect(result.removeTorrent).toBe(true);
      expect(result.deleteInputFile).toBe(true);
      expect(result.deleteDownloadPath).toBe(false);
    });
  });

  // downloadRemove is the only path that reaches the torrent client's own
  // delete-files option. This exists because a silently-flipped default
  // here would delete files through a path with no isInsideRoot guard in
  // front of it — see spec.md's "downloadRemove(deleteFiles: false) looks
  // like a regression" note in plan.md.
  describe('downloadRemove — deleteFiles forwarding', () => {
    it('forwards deleteFiles: false to torrentClient.remove unchanged', async () => {
      prisma.mediaSource.findUnique.mockResolvedValue({ id: 10, infoHash: 'abc123' });

      await service.downloadRemove(10, false);

      expect(torrentClient.remove).toHaveBeenCalledWith('abc123', false);
    });

    it('defaults deleteFiles to true when the caller omits it', async () => {
      prisma.mediaSource.findUnique.mockResolvedValue({ id: 10, infoHash: 'abc123' });

      await service.downloadRemove(10);

      expect(torrentClient.remove).toHaveBeenCalledWith('abc123', true);
    });
  });

  // This suite exists because REQ-15's sweep has two failure classes that
  // both produce no error anywhere (spec.md NFR-5 (b)/(c)):
  //
  //  - selecting siblings by tag instead of by target id: a second title
  //    that happens to share a tag string loses downloads the user never
  //    touched, and the deletion *succeeds*, so there is nothing to catch it;
  //  - an upload winning a race and sweeping nothing, because the
  //    `!infoHash` early return fired in front of the sweep instead of only
  //    guarding the winner's own `remove` call — the upload files
  //    correctly, the encode succeeds, and two losing torrents keep
  //    downloading and seeding forever with no row and no log pointing at
  //    them.
  describe('downloadRemove — REQ-15 loser sweep', () => {
    it('removes every other sibling of the same movie, with files, and deletes their rows', async () => {
      prisma.mediaSource.findUnique.mockResolvedValue({ id: 10, infoHash: 'winner-hash', movieId: 7 });
      prisma.mediaSource.findMany.mockResolvedValue([
        { id: 11, infoHash: 'loser-hash-1' },
        { id: 12, infoHash: 'loser-hash-2' },
      ]);

      await service.downloadRemove(10, false);

      // Selected by movieId — never by tag (REQ-14). Removing this `where`
      // and matching by a tag string instead would let a second title
      // sharing that tag lose downloads it never asked to touch, silently.
      expect(prisma.mediaSource.findMany).toHaveBeenCalledWith({
        where: { movieId: 7, id: { not: 10 } },
      });

      // The winner's own removal keeps whatever deleteFiles the caller
      // passed (the worker always passes false); the losers are always
      // removed WITH their files — the two must never be swapped.
      expect(torrentClient.remove).toHaveBeenCalledWith('winner-hash', false);
      expect(torrentClient.remove).toHaveBeenCalledWith('loser-hash-1', true);
      expect(torrentClient.remove).toHaveBeenCalledWith('loser-hash-2', true);

      expect(prisma.mediaSource.delete).toHaveBeenCalledWith({ where: { id: 11 } });
      expect(prisma.mediaSource.delete).toHaveBeenCalledWith({ where: { id: 12 } });
      // The winner's own row is never deleted here — only its torrent is
      // removed; the caller (cleanup-source.ts) owns the winner's row.
      expect(prisma.mediaSource.delete).not.toHaveBeenCalledWith({ where: { id: 10 } });
    });

    // NFR-5 (c): the sweep must run for a winner of either kind — restoring
    // the old `!infoHash` early return in front of it (instead of only
    // guarding the winner's own torrentClient.remove call) makes this case
    // fail, because the sweep would never run for an upload winner.
    it('still sweeps losing torrent siblings when the winner itself is a LOCAL_FILE upload with no infoHash', async () => {
      prisma.mediaSource.findUnique.mockResolvedValue({ id: 20, infoHash: null, movieId: 8 });
      prisma.mediaSource.findMany.mockResolvedValue([{ id: 21, infoHash: 'loser-hash' }]);

      const result = await service.downloadRemove(20, false);

      expect(result).toBe('omitido: mediaSource 20 no es un torrent');
      // The winner has no infoHash, so torrentClient.remove must be called
      // exactly once — for the losing torrent, never for the winner itself.
      expect(torrentClient.remove).toHaveBeenCalledTimes(1);
      expect(torrentClient.remove).toHaveBeenCalledWith('loser-hash', true);
      expect(prisma.mediaSource.delete).toHaveBeenCalledWith({ where: { id: 21 } });
    });

    it('does not delete a loser whose torrent removal the client rejected, and leaves its row intact', async () => {
      prisma.mediaSource.findUnique.mockResolvedValue({ id: 10, infoHash: 'winner-hash', movieId: 7 });
      prisma.mediaSource.findMany.mockResolvedValue([{ id: 11, infoHash: 'unreachable-hash' }]);
      torrentClient.remove.mockImplementation(async (hash: string) => {
        if (hash === 'unreachable-hash') throw new Error('qBittorrent unreachable');
      });

      await service.downloadRemove(10, false);

      // NFR-6: an unacknowledged delete must not delete the row either —
      // that would leave the file on disk with nothing tracking it.
      expect(prisma.mediaSource.delete).not.toHaveBeenCalledWith({ where: { id: 11 } });
    });
  });
});
