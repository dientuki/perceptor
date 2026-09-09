import { Test, TestingModule } from '@nestjs/testing';
import { ProcessJobsService } from './process-jobs.service';
import { PrismaService } from '@/prisma/prisma.service';
import { QbittorrentClient } from '@/clients/torrent/client';
import { SettingsService } from '@/settings/settings.service';
import { MediaRootsService } from '@/media-roots/media-roots.service';
import { MediaServerService } from '@/media-server/media-server.service';
import { MediaCapabilitiesService } from '@/media/media-capabilities.service';
import { ERROR_KEYS } from '@/i18n/error-keys';

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
  let mediaCapabilities: { isShortsEnabled: jest.Mock };

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
    mediaCapabilities = { isShortsEnabled: jest.fn().mockResolvedValue(false) };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ProcessJobsService,
        { provide: PrismaService, useValue: prisma },
        { provide: QbittorrentClient, useValue: torrentClient },
        { provide: SettingsService, useValue: settings },
        { provide: MediaRootsService, useValue: mediaRoots },
        { provide: MediaServerService, useValue: mediaServer },
        { provide: MediaCapabilitiesService, useValue: mediaCapabilities },
      ],
    }).compile();

    service = module.get<ProcessJobsService>(ProcessJobsService);
  });

  // A language row as `resolveOriginalLanguage()`/`language.findUnique`
  // returns it — keyed by `tag` (030-language-regional-variants), `tag`
  // defaults to `iso2` for the ordinary case where a language has no
  // regional variant.
  const languageRow = (iso2: string, iso3: string, tag: string = iso2) => ({ tag, iso2, iso3 });

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
      isShort: false,
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
  // plus, since 042-encode-global-language-preferences, the owning user's
  // global preference nested under `user.languages` (the relation Prisma
  // exposes on `User` — see prisma/schema.prisma; NOT to be confused with
  // this same select's outer `languages`, the per-title UserMovie/UserShowLanguage
  // rows). Since 030-language-regional-variants the select also carries
  // `tag`, defaulting to `iso3` for the ordinary case where a preference has
  // no regional variant (tag === iso2 !== iso3, but the tests that only care
  // about iso3 pass an iso3-shaped tag on purpose — the tag vocabulary is
  // exercised explicitly where it matters). Since 039-per-title-language-split
  // the select also carries `kind`, defaulting to `'AUDIO'` so every
  // pre-existing case (all written before the split) keeps exercising the
  // audio pair without change. The global-list parameters default to empty,
  // so every call site written before 042 keeps working unchanged.
  const owner = (
    titleIso3s: string[],
    tags: string[] = titleIso3s,
    kind: 'AUDIO' | 'SUBTITLE' = 'AUDIO',
    globalIso3s: string[] = [],
    globalTags: string[] = globalIso3s,
    globalKind: 'AUDIO' | 'SUBTITLE' = 'AUDIO',
  ) => ({
    languages: titleIso3s.map((iso3, i) => ({ kind, language: { iso3, tag: tags[i] } })),
    user: {
      languages: globalIso3s.map((iso3, i) => ({ kind: globalKind, language: { iso3, tag: globalTags[i] } })),
    },
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

  // REQ-7: reading a missing/unexpected `compression_enabled` row as "off"
  // produces no error anywhere — every job still completes, every file still
  // lands in the right place, and an entire library is quietly left
  // un-transcoded, discovered only by disk usage months later.
  describe('getEncodeJobDetails — REQ-7 compressionEnabled', () => {
    it('resolves to true when the compression_enabled row is missing', async () => {
      prisma.processJob.findUnique.mockResolvedValue(movieProcessJob());
      prisma.language.findUnique.mockResolvedValue(languageRow('ja', 'jpn'));
      prisma.userMovie.findMany.mockResolvedValue([]);
      settings.getMap.mockResolvedValue({ path_movies: 'Movies', path_shows: 'Shows' });

      const details = await service.getEncodeJobDetails(1);

      expect(details.compressionEnabled).toBe(true);
    });

    it('resolves to true for the exact string "true"', async () => {
      prisma.processJob.findUnique.mockResolvedValue(movieProcessJob());
      prisma.language.findUnique.mockResolvedValue(languageRow('ja', 'jpn'));
      prisma.userMovie.findMany.mockResolvedValue([]);
      settings.getMap.mockResolvedValue({ path_movies: 'Movies', path_shows: 'Shows', compression_enabled: 'true' });

      const details = await service.getEncodeJobDetails(1);

      expect(details.compressionEnabled).toBe(true);
    });

    it('resolves to false only for the exact string "false"', async () => {
      prisma.processJob.findUnique.mockResolvedValue(movieProcessJob());
      prisma.language.findUnique.mockResolvedValue(languageRow('ja', 'jpn'));
      prisma.userMovie.findMany.mockResolvedValue([]);
      settings.getMap.mockResolvedValue({ path_movies: 'Movies', path_shows: 'Shows', compression_enabled: 'false' });

      const details = await service.getEncodeJobDetails(1);

      expect(details.compressionEnabled).toBe(false);
    });

    it('resolves to true for a junk value that somehow reached the row', async () => {
      prisma.processJob.findUnique.mockResolvedValue(movieProcessJob());
      prisma.language.findUnique.mockResolvedValue(languageRow('ja', 'jpn'));
      prisma.userMovie.findMany.mockResolvedValue([]);
      settings.getMap.mockResolvedValue({ path_movies: 'Movies', path_shows: 'Shows', compression_enabled: 'maybe' });

      const details = await service.getEncodeJobDetails(1);

      expect(details.compressionEnabled).toBe(true);
    });

    it('is present on the EPISODE branch too', async () => {
      prisma.processJob.findUnique.mockResolvedValue(episodeProcessJob());
      prisma.language.findUnique.mockResolvedValue(languageRow('ja', 'jpn'));
      prisma.userShow.findMany.mockResolvedValue([]);
      settings.getMap.mockResolvedValue({ path_movies: 'Movies', path_shows: 'Shows', compression_enabled: 'false' });

      const details = await service.getEncodeJobDetails(2);

      expect(details.compressionEnabled).toBe(false);
    });
  });

  // REQ-12/REQ-13 (048-shorts-category): a film flagged `isShort` must land
  // under `path_shorts` instead of `path_movies`, but only while the shorts
  // category is *effectively* enabled — a wrong branch here transcodes
  // successfully (no ffmpeg error, no status change) and just files the
  // output somewhere the user never looks, forever, with nothing anywhere
  // logging the mistake.
  describe('getEncodeJobDetails — REQ-12 shorts outputRoot', () => {
    it('resolves outputRoot from path_movies when the film is not flagged short, shorts enabled', async () => {
      mediaCapabilities.isShortsEnabled.mockResolvedValue(true);
      prisma.processJob.findUnique.mockResolvedValue(
        movieProcessJob({
          movie: {
            id: 42,
            tmdbId: 999,
            title: 'A Japanese Film',
            releaseDate: new Date('2020-01-01'),
            originalLanguage: 'ja',
            isLiveAction: true,
            isShort: false,
          },
        }),
      );
      prisma.language.findUnique.mockResolvedValue(languageRow('ja', 'jpn'));
      prisma.userMovie.findMany.mockResolvedValue([]);
      settings.getMap.mockResolvedValue({ path_movies: 'Movies', path_shows: 'Shows', path_shorts: 'Shorts' });

      await service.getEncodeJobDetails(1);

      expect(mediaRoots.resolveFromRoot).toHaveBeenCalledWith('library', 'Movies');
    });

    it('resolves outputRoot from path_movies when the film is flagged short but shorts are disabled', async () => {
      mediaCapabilities.isShortsEnabled.mockResolvedValue(false);
      prisma.processJob.findUnique.mockResolvedValue(
        movieProcessJob({
          movie: {
            id: 42,
            tmdbId: 999,
            title: 'A Japanese Film',
            releaseDate: new Date('2020-01-01'),
            originalLanguage: 'ja',
            isLiveAction: true,
            isShort: true,
          },
        }),
      );
      prisma.language.findUnique.mockResolvedValue(languageRow('ja', 'jpn'));
      prisma.userMovie.findMany.mockResolvedValue([]);
      settings.getMap.mockResolvedValue({ path_movies: 'Movies', path_shows: 'Shows', path_shorts: 'Shorts' });

      await service.getEncodeJobDetails(1);

      expect(mediaRoots.resolveFromRoot).toHaveBeenCalledWith('library', 'Movies');
    });

    it('resolves outputRoot from path_movies when the film is not flagged short and shorts are disabled', async () => {
      mediaCapabilities.isShortsEnabled.mockResolvedValue(false);
      prisma.processJob.findUnique.mockResolvedValue(movieProcessJob());
      prisma.language.findUnique.mockResolvedValue(languageRow('ja', 'jpn'));
      prisma.userMovie.findMany.mockResolvedValue([]);
      settings.getMap.mockResolvedValue({ path_movies: 'Movies', path_shows: 'Shows', path_shorts: 'Shorts' });

      await service.getEncodeJobDetails(1);

      expect(mediaRoots.resolveFromRoot).toHaveBeenCalledWith('library', 'Movies');
    });

    it('resolves outputRoot from path_shorts only when the film is flagged short AND shorts are effectively enabled', async () => {
      mediaCapabilities.isShortsEnabled.mockResolvedValue(true);
      prisma.processJob.findUnique.mockResolvedValue(
        movieProcessJob({
          movie: {
            id: 42,
            tmdbId: 999,
            title: 'A Japanese Film',
            releaseDate: new Date('2020-01-01'),
            originalLanguage: 'ja',
            isLiveAction: true,
            isShort: true,
          },
        }),
      );
      prisma.language.findUnique.mockResolvedValue(languageRow('ja', 'jpn'));
      prisma.userMovie.findMany.mockResolvedValue([]);
      settings.getMap.mockResolvedValue({ path_movies: 'Movies', path_shows: 'Shows', path_shorts: 'Shorts' });

      const details = await service.getEncodeJobDetails(1);

      expect(mediaRoots.resolveFromRoot).toHaveBeenCalledWith('library', 'Shorts');
      expect(details.outputRoot).toBe('/library/Movies'); // stubbed mediaRoots.resolveFromRoot return value
    });

    it('raises error.setting.missing for a flagged, effectively-enabled short when path_shorts is absent', async () => {
      mediaCapabilities.isShortsEnabled.mockResolvedValue(true);
      prisma.processJob.findUnique.mockResolvedValue(
        movieProcessJob({
          movie: {
            id: 42,
            tmdbId: 999,
            title: 'A Japanese Film',
            releaseDate: new Date('2020-01-01'),
            originalLanguage: 'ja',
            isLiveAction: true,
            isShort: true,
          },
        }),
      );
      prisma.language.findUnique.mockResolvedValue(languageRow('ja', 'jpn'));
      prisma.userMovie.findMany.mockResolvedValue([]);
      settings.getMap.mockResolvedValue({ path_movies: 'Movies', path_shows: 'Shows' });

      await expect(service.getEncodeJobDetails(1)).rejects.toMatchObject({
        status: 404,
        response: { i18n: { key: ERROR_KEYS.SETTING_MISSING, params: { key: 'path_shorts' } } },
      });
    });
  });

  describe('getEncodeJobDetails — REQ-3/REQ-8 language merge', () => {
    it('unions the original language, the installation default and one per-title extra', async () => {
      prisma.processJob.findUnique.mockResolvedValue(movieProcessJob());
      // resolveOriginalLanguage (original language) and
      // resolveDefaultLanguages (default_languages) both call language table
      // methods, so both must be stubbed distinctly.
      prisma.language.findUnique.mockResolvedValue(languageRow('ja', 'jpn'));
      prisma.language.findMany.mockResolvedValue([{ tag: 'es', iso2: 'es', iso3: 'spa' }]);
      settings.getMap.mockResolvedValue({ path_movies: 'Movies', path_shows: 'Shows', default_languages: 'es' });
      prisma.userMovie.findMany.mockResolvedValue([owner(['eng'])]);

      const details = await service.getEncodeJobDetails(1);

      expect(details.allowedAudioLanguagesIso3.sort()).toEqual(['eng', 'jpn', 'spa'].sort());
    });

    it('always includes the original language even with zero preferences and no default set', async () => {
      prisma.processJob.findUnique.mockResolvedValue(movieProcessJob());
      prisma.language.findUnique.mockResolvedValue(languageRow('ja', 'jpn'));
      prisma.userMovie.findMany.mockResolvedValue([owner([])]);

      const details = await service.getEncodeJobDetails(1);

      expect(details.allowedAudioLanguagesIso3).toEqual(['jpn']);
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
      expect(details.allowedAudioLanguagesIso3).toContain('spa');
      expect(details.allowedAudioLanguagesIso3).not.toContain('es');
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
      expect(details.allowedAudioLanguagesIso3.sort()).toEqual(['eng', 'jpn'].sort());
    });

    it('returns exactly one element — the original — for a title with no owners', async () => {
      prisma.processJob.findUnique.mockResolvedValue(movieProcessJob());
      prisma.language.findUnique.mockResolvedValue(languageRow('ja', 'jpn'));
      prisma.userMovie.findMany.mockResolvedValue([]);

      const details = await service.getEncodeJobDetails(1);

      expect(details.allowedAudioLanguagesIso3).toEqual(['jpn']);
    });

    // AC-8 / T011: the plan's headline silent failure — a forgotten
    // `default_languages` read narrows every future encode with no error.
    // This asserts the setting's codes land in the union alongside a
    // per-title preference, original first, deduplicated.
    it('unions default_languages with a per-title preference, original first, no duplicates', async () => {
      prisma.processJob.findUnique.mockResolvedValue(movieProcessJob());
      prisma.language.findUnique.mockResolvedValue(languageRow('ja', 'jpn'));
      prisma.language.findMany.mockResolvedValue([{ tag: 'es', iso2: 'es', iso3: 'spa' }]);
      settings.getMap.mockResolvedValue({ path_movies: 'Movies', path_shows: 'Shows', default_languages: 'es' });
      prisma.userMovie.findMany.mockResolvedValue([owner(['fra'])]);

      const details = await service.getEncodeJobDetails(1);

      expect(details.allowedAudioLanguagesIso3[0]).toBe('jpn');
      expect(details.allowedAudioLanguagesIso3.sort()).toEqual(['fra', 'jpn', 'spa'].sort());
      expect(new Set(details.allowedAudioLanguagesIso3).size).toBe(details.allowedAudioLanguagesIso3.length);
    });

    // AC-10 / T008: `resolveOriginalLanguage` looks up by `tag`, not by
    // `findFirst` on `iso2`. Once `es-419`/`es-ES` exist, `iso2` is no
    // longer unique — a `findFirst({ where: { iso2: 'es' } })` could
    // nondeterministically return a variant row instead of the base `es`
    // row. That would still resolve `originalLanguageIso3` to `spa`
    // (harmless), but it would resolve `tag` to a variant the film's TMDB
    // metadata never asked for — the exact bug the follow-up spec's
    // `allowedLanguageTags` merge depends on this method getting right.
    it('resolves a Spanish film\'s original language to the base `es` row, never a variant', async () => {
      prisma.processJob.findUnique.mockResolvedValue(
        movieProcessJob({ movie: { ...movieProcessJob().movie, originalLanguage: 'es' } }),
      );
      // Only the base row answers a lookup keyed by tag 'es'; a variant row
      // has its own distinct tag ('es-419'/'es-ES') and would never be
      // returned by this query in the first place — which is the point.
      prisma.language.findUnique.mockResolvedValue(languageRow('es', 'spa', 'es'));
      prisma.userMovie.findMany.mockResolvedValue([]);

      const details = await service.getEncodeJobDetails(1);

      expect(prisma.language.findUnique).toHaveBeenCalledWith({ where: { tag: 'es' } });
      expect(details.originalLanguageIso3).toBe('spa');
      expect(details.allowedAudioLanguagesIso3).toEqual(['spa']);
      expect(details.allowedAudioLanguageTags).toEqual(['es']);
    });
  });

  // 039-per-title-language-split, REQ-5: the two silent failures the plan
  // names for this merge — a kind-blind filter that starves the subtitle
  // pair of the original language/default (AC-8), and an owner preference
  // that leaks into the pair it does not belong to (AC-9). Neither produces
  // an error anywhere: the encode still completes, just with the wrong
  // tracks kept or dropped.
  describe('getEncodeJobDetails — REQ-5 audio/subtitle split', () => {
    // AC-8: with no per-title preference of either kind, both pairs must be
    // identical to each other and to what the single pre-split list would
    // have produced (original + installation default).
    it('AC-8: with no per-title preference, both pairs are identical to each other and to the single-list case', async () => {
      prisma.processJob.findUnique.mockResolvedValue(movieProcessJob());
      prisma.language.findUnique.mockResolvedValue(languageRow('ja', 'jpn'));
      prisma.language.findMany.mockResolvedValue([{ tag: 'es', iso2: 'es', iso3: 'spa' }]);
      settings.getMap.mockResolvedValue({ path_movies: 'Movies', path_shows: 'Shows', default_languages: 'es' });
      prisma.userMovie.findMany.mockResolvedValue([]);

      const details = await service.getEncodeJobDetails(1);

      expect(details.allowedAudioLanguagesIso3.sort()).toEqual(['jpn', 'spa'].sort());
      expect(details.allowedSubtitleLanguagesIso3.sort()).toEqual(details.allowedAudioLanguagesIso3.sort());
      expect(details.allowedSubtitleLanguageTags.sort()).toEqual(details.allowedAudioLanguageTags.sort());
    });

    // AC-9: an audio-only per-title preference must reach the audio pair and
    // must not leak into the subtitle pair.
    it('AC-9: an audio-only per-title preference reaches only the audio pair, not the subtitle one', async () => {
      prisma.processJob.findUnique.mockResolvedValue(movieProcessJob());
      prisma.language.findUnique.mockResolvedValue(languageRow('ja', 'jpn'));
      prisma.userMovie.findMany.mockResolvedValue([owner(['fre'], ['fr'], 'AUDIO')]);

      const details = await service.getEncodeJobDetails(1);

      expect(details.allowedAudioLanguagesIso3).toContain('fre');
      expect(details.allowedSubtitleLanguagesIso3).not.toContain('fre');
    });

    // The mirror case: a subtitle-only preference must not leak into audio.
    it('a subtitle-only per-title preference reaches only the subtitle pair, not the audio one', async () => {
      prisma.processJob.findUnique.mockResolvedValue(movieProcessJob());
      prisma.language.findUnique.mockResolvedValue(languageRow('ja', 'jpn'));
      prisma.userMovie.findMany.mockResolvedValue([owner(['fre'], ['fr'], 'SUBTITLE')]);

      const details = await service.getEncodeJobDetails(1);

      expect(details.allowedSubtitleLanguagesIso3).toContain('fre');
      expect(details.allowedAudioLanguagesIso3).not.toContain('fre');
    });
  });

  // 030-language-regional-variants, T009: `allowedAudioLanguageTags` and
  // `allowedAudioLanguagesIso3` are produced from the SAME merge walk
  // (`collectAllowedLanguages`), not two separate ones. A drift between them
  // — e.g. a tag added to one Set but not the other, or `resolveDefaultLanguages`
  // left querying by `iso2` instead of `tag` — ships an `allowedAudioLanguageTags`
  // that silently disagrees with `allowedAudioLanguagesIso3`, or an empty one, with
  // no error anywhere: the worker doesn't read the field yet (NFR-4), so
  // nothing fails until the follow-up spec ships and its rules see a stale or
  // empty tag list.
  describe('getEncodeJobDetails — allowedAudioLanguageTags (030-language-regional-variants)', () => {
    it('AC-9: carries a chosen variant tag, and collapses both Spanish variants to `spa` exactly once', async () => {
      prisma.processJob.findUnique.mockResolvedValue(movieProcessJob());
      prisma.language.findUnique.mockResolvedValue(languageRow('ja', 'jpn'));
      prisma.userMovie.findMany.mockResolvedValue([owner(['spa', 'spa'], ['es-419', 'es-ES'])]);

      const details = await service.getEncodeJobDetails(1);

      expect(details.allowedAudioLanguageTags).toContain('es-419');
      expect(details.allowedAudioLanguageTags).toContain('es-ES');
      expect(details.allowedAudioLanguagesIso3.filter((code) => code === 'spa')).toHaveLength(1);
    });

    it('resolves the installation default by `tag`, not `iso2` — a stale `iso2` lookup would silently drop it', async () => {
      prisma.processJob.findUnique.mockResolvedValue(movieProcessJob());
      prisma.language.findUnique.mockResolvedValue(languageRow('ja', 'jpn'));
      prisma.language.findMany.mockResolvedValue([{ tag: 'es-419', iso2: 'es', iso3: 'spa' }]);
      settings.getMap.mockResolvedValue({
        path_movies: 'Movies',
        path_shows: 'Shows',
        default_languages: 'es-419',
      });
      prisma.userMovie.findMany.mockResolvedValue([]);

      const details = await service.getEncodeJobDetails(1);

      expect(prisma.language.findMany).toHaveBeenCalledWith({ where: { tag: { in: ['es-419'] } } });
      expect(details.allowedAudioLanguageTags).toContain('es-419');
      expect(details.allowedAudioLanguagesIso3).toContain('spa');
    });

    it('is original-tag-first and deduplicated, mirroring allowedAudioLanguagesIso3\'s ordering exactly', async () => {
      prisma.processJob.findUnique.mockResolvedValue(movieProcessJob());
      prisma.language.findUnique.mockResolvedValue(languageRow('ja', 'jpn'));
      prisma.userMovie.findMany.mockResolvedValue([owner(['eng', 'eng'], ['en', 'en'])]);

      const details = await service.getEncodeJobDetails(1);

      expect(details.allowedAudioLanguageTags[0]).toBe('ja');
      expect(details.allowedAudioLanguageTags).toEqual(['ja', 'en']);
    });

    it('is emitted on the EPISODE branch too', async () => {
      prisma.processJob.findUnique.mockResolvedValue(episodeProcessJob());
      prisma.language.findUnique.mockResolvedValue(languageRow('ja', 'jpn'));
      prisma.userShow.findMany.mockResolvedValue([owner(['spa'], ['es-ES'])]);

      const details = await service.getEncodeJobDetails(2);

      expect(details.allowedAudioLanguageTags).toEqual(['ja', 'es-ES']);
    });
  });

  // 042-encode-global-language-preferences, REQ-1/REQ-2/REQ-3/REQ-5: every
  // owner's global `UserLanguagePreference` (not just their per-title one)
  // must reach the merge, additively, scoped to owners only, matched by
  // `kind`, and on both the movie and episode branch. Each case here is
  // verified to fail when the fold in `collectAllowedLanguages` is removed
  // (Article IX) — done by hand for this diff and restored before reporting.
  describe('getEncodeJobDetails — 042 global language preference merge', () => {
    // AC-1: a language with NO per-title row at all, contributed only
    // through the owner's global preference, still reaches both lists of
    // its kind. `kor`/`ko` is distinct from the fixture's original (`ja`/
    // `jpn`) and from every per-title fixture value in this file, so a
    // regression that reads `User.languages` (a different, unrelated
    // relation than the global-preference one this select actually nests
    // under `user`) instead of the global preference relation returns no
    // rows and this assertion goes red too, not just an empty-fold bug.
    it('AC-1: a global-only audio preference reaches both the iso3 and the tag list', async () => {
      prisma.processJob.findUnique.mockResolvedValue(movieProcessJob());
      prisma.language.findUnique.mockResolvedValue(languageRow('ja', 'jpn'));
      prisma.userMovie.findMany.mockResolvedValue([owner([], [], 'AUDIO', ['kor'], ['ko'], 'AUDIO')]);

      const details = await service.getEncodeJobDetails(1);

      expect(details.allowedAudioLanguagesIso3).toContain('kor');
      expect(details.allowedAudioLanguageTags).toContain('ko');
    });

    // AC-2 (failure path): a global AUDIO-only preference must not widen the
    // subtitle allow-list — the same kind-blind-leak bug class REQ-5 (039)
    // exists to forbid, now reachable a second way through the global level.
    it('AC-2: a global AUDIO-only preference does not leak into either subtitle list', async () => {
      prisma.processJob.findUnique.mockResolvedValue(movieProcessJob());
      prisma.language.findUnique.mockResolvedValue(languageRow('ja', 'jpn'));
      prisma.userMovie.findMany.mockResolvedValue([owner([], [], 'AUDIO', ['spa'], ['es-419'], 'AUDIO')]);

      const details = await service.getEncodeJobDetails(1);

      expect(details.allowedSubtitleLanguagesIso3).not.toContain('spa');
      expect(details.allowedSubtitleLanguageTags).not.toContain('es-419');
    });

    // AC-3 (failure path): a user who does not own the title never shapes
    // its encode. `userMovie.findMany`'s own `where: { movieId }` is the
    // only thing enforcing that — there is no second, narrower filter to
    // drop — so this asserts that scope directly: a fold that started
    // reading every user's global preference instead of only the rows this
    // query returns would still pass every other case in this file, since
    // none of them mocks a second, unrelated owner.
    it('AC-3: a non-owner never contributes, because they never appear in the scoped owners row', async () => {
      prisma.processJob.findUnique.mockResolvedValue(movieProcessJob());
      prisma.language.findUnique.mockResolvedValue(languageRow('ja', 'jpn'));
      // Only the film's real owner is returned. A user who owns nothing but
      // has `fr` in both their global lists is never part of this array —
      // the `where: { movieId }` clause asserted below is what keeps them
      // out in the real query.
      prisma.userMovie.findMany.mockResolvedValue([owner(['eng'])]);

      const details = await service.getEncodeJobDetails(1);

      expect(prisma.userMovie.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { movieId: 42 } }));
      expect(details.allowedAudioLanguagesIso3).not.toContain('fra');
      expect(details.allowedAudioLanguageTags).not.toContain('fr');
      expect(details.allowedSubtitleLanguagesIso3).not.toContain('fra');
      expect(details.allowedSubtitleLanguageTags).not.toContain('fr');
    });

    // AC-4: two owners' global preferences, plus one owner's per-title
    // override duplicating the *other* owner's global entry — the union
    // stays deduplicated across sources and across owners, and the
    // per-title level neither replaces nor duplicates the global one.
    it('AC-4: two owners plus a per-title override duplicating a global entry — each language exactly once', async () => {
      prisma.processJob.findUnique.mockResolvedValue(movieProcessJob());
      prisma.language.findUnique.mockResolvedValue(languageRow('ja', 'jpn'));
      const ownerA = owner([], [], 'AUDIO', ['spa'], ['es-419'], 'AUDIO');
      const ownerB = owner(['spa'], ['es-419'], 'AUDIO', ['por'], ['pt'], 'AUDIO');
      prisma.userMovie.findMany.mockResolvedValue([ownerA, ownerB]);

      const details = await service.getEncodeJobDetails(1);

      expect(details.allowedAudioLanguagesIso3.sort()).toEqual(['jpn', 'por', 'spa'].sort());
      expect(details.allowedAudioLanguagesIso3.filter((code) => code === 'spa')).toHaveLength(1);
      expect(details.allowedAudioLanguageTags.sort()).toEqual(['es-419', 'ja', 'pt'].sort());
      expect(details.allowedAudioLanguageTags.filter((tag) => tag === 'es-419')).toHaveLength(1);
    });

    // REQ-5: mergeShowAllowedLanguages is an independent copy of the same
    // select — a correct movie branch proves nothing about it.
    it('REQ-5: a global preference reaches the episode branch too', async () => {
      prisma.processJob.findUnique.mockResolvedValue(episodeProcessJob());
      prisma.language.findUnique.mockResolvedValue(languageRow('ja', 'jpn'));
      prisma.userShow.findMany.mockResolvedValue([owner([], [], 'AUDIO', ['kor'], ['ko'], 'AUDIO')]);

      const details = await service.getEncodeJobDetails(2);

      expect(details.allowedAudioLanguagesIso3).toContain('kor');
      expect(details.allowedAudioLanguageTags).toContain('ko');
    });

    // NFR-2: folding the global list must not cost a second query — a
    // per-owner `findPreferredTrackLanguagesFor` call (the alternative
    // ../plan.md rejects) would multiply calls here instead of staying at
    // one, on a resolver the worker hits once per encode job.
    it('NFR-2: userMovie.findMany / userShow.findMany stay at exactly one call each with the global fold in place', async () => {
      prisma.processJob.findUnique.mockResolvedValue(movieProcessJob());
      prisma.language.findUnique.mockResolvedValue(languageRow('ja', 'jpn'));
      prisma.userMovie.findMany.mockResolvedValue([owner([], [], 'AUDIO', ['kor'], ['ko'], 'AUDIO')]);

      await service.getEncodeJobDetails(1);

      expect(prisma.userMovie.findMany).toHaveBeenCalledTimes(1);

      prisma.processJob.findUnique.mockResolvedValue(episodeProcessJob());
      prisma.userShow.findMany.mockResolvedValue([owner([], [], 'AUDIO', ['kor'], ['ko'], 'AUDIO')]);

      await service.getEncodeJobDetails(2);

      expect(prisma.userShow.findMany).toHaveBeenCalledTimes(1);
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

    // The `findUnique` read `encodeCompleted` does before writing anything
    // (REQ-5/REQ-8): a fresh job, still ENCODING, whose source has not been
    // demoted. Every cleanup-verdict case below is about the verdict
    // computed *after* that read, not about the read itself, so they all
    // share this default.
    const freshExisting = {
      status: 'ENCODING',
      outputFilePath: null,
      sourceFile: { mediaSourceId: 10, mediaSource: { status: 'READY' } },
    };

    beforeEach(() => {
      prisma.movie.update.mockResolvedValue({});
      prisma.episode.update.mockResolvedValue({});
      prisma.processJob.findUnique.mockResolvedValue(freshExisting);
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

  // 038-encode-report-durability, REQ-5/REQ-8/T006: the worker retries a
  // report it could not deliver, so both mutations must tolerate a second
  // delivery for the same job, and a demoted source's report must not move
  // the title a newer upload has already taken over. Neither failure throws
  // — a second delivery would just notify the media server twice, and a
  // demoted source's report would silently drag the winner's title back to
  // ENCODING/COMPLETED/ERROR with no error anywhere.
  describe('encodeCompleted / encodeFailed — repeat delivery and demoted-source guard (REQ-5/REQ-8)', () => {
    beforeEach(() => {
      prisma.movie.update.mockResolvedValue({});
      prisma.episode.update.mockResolvedValue({});
      prisma.processJob.findMany.mockResolvedValue([{ id: 1, status: 'COMPLETED' }]);
      prisma.mediaSource.findUnique.mockResolvedValue({ hasUnmatchedFiles: false });
    });

    // AC-8: a retry whose predecessor already landed must not notify the
    // media server a second time, and must leave the stored row exactly as
    // it already was. Remove the `!alreadyDeliveredSame` guard on the
    // `notifyCreated` call (or on the movie/episode update) and this case
    // goes red — verified by hand below, guard left in place.
    it('a second encodeCompleted for the same job does not notify the media server again and leaves the row unchanged', async () => {
      const existing = {
        status: 'COMPLETED',
        outputFilePath: '/library/movie.mkv',
        sourceFile: { mediaSourceId: 10, mediaSource: { status: 'READY' } },
      };
      prisma.processJob.findUnique.mockResolvedValue(existing);
      prisma.processJob.update.mockResolvedValue({
        id: 1,
        movieId: 42,
        episodeId: null,
        sourceFile: { mediaSourceId: 10 },
      });

      const result = await service.encodeCompleted(1, '/library/movie.mkv', 'ffmpeg …');

      expect(mediaServer.notifyCreated).not.toHaveBeenCalled();
      expect(prisma.movie.update).not.toHaveBeenCalled();
      expect(prisma.episode.update).not.toHaveBeenCalled();
      // The cleanup verdict is still recomputed and returned on the retry —
      // the first verdict may never have reached the worker.
      expect(result.removeTorrent).toBe(true);
    });

    // AC-7: the source lost its race to a newer upload after this job was
    // enqueued. Remove the `sourceDemoted` check in front of the movie/
    // episode update and this case goes red, because the encode that
    // finished *after* losing the race would drag the title's status/
    // filePath back to what the loser produced.
    it('encodeCompleted for a job whose MediaSource is ERROR leaves episode.status and filePath untouched', async () => {
      const existing = {
        status: 'ENCODING',
        outputFilePath: null,
        sourceFile: { mediaSourceId: 10, mediaSource: { status: 'ERROR' } },
      };
      prisma.processJob.findUnique.mockResolvedValue(existing);
      prisma.processJob.update.mockResolvedValue({
        id: 1,
        movieId: null,
        episodeId: 5,
        sourceFile: { mediaSourceId: 10 },
      });

      const result = await service.encodeCompleted(1, '/library/episode.mkv', 'ffmpeg …');

      expect(prisma.episode.update).not.toHaveBeenCalled();
      expect(prisma.movie.update).not.toHaveBeenCalled();
      // The job row itself still reports COMPLETED — only the title is left
      // alone. The worker must not be able to tell a demoted source's report
      // apart from an ordinary one by this return shape.
      expect(prisma.processJob.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ status: 'COMPLETED' }) }),
      );
      expect(result.message).toContain('completado');
    });

    // Same guard, the failure path: a demoted source's genuinely failed
    // encode must not fail the title the winner is still encoding.
    it('encodeFailed for a job whose MediaSource is ERROR leaves episode.status untouched', async () => {
      const existing = {
        sourceFile: { mediaSource: { status: 'ERROR' } },
      };
      prisma.processJob.findUnique.mockResolvedValue(existing);
      prisma.processJob.update.mockResolvedValue({ id: 1, movieId: null, episodeId: 5 });

      await service.encodeFailed(1, 'error.encode.corrupt_input', undefined, 'ffmpeg exited 1');

      expect(prisma.episode.update).not.toHaveBeenCalled();
      expect(prisma.movie.update).not.toHaveBeenCalled();
      expect(prisma.processJob.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ status: 'ERROR' }) }),
      );
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
