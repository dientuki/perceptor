import { Test, TestingModule } from '@nestjs/testing';
import { PopularMediaService } from './popular-media.service';
import { MediaDispatchService } from './media-dispatch.service';
import { TmdbClient } from '@/clients/tmdb/client';
import { PrismaService } from '@/prisma/prisma.service';
import { SettingsService } from '@/settings/settings.service';
import { RedisService } from '@/redis/redis.service';
import { MEDIA_TYPE } from '@/types/media';
import { TmdbHttpError } from '@/clients/tmdb/errors';

// This suite exists because 033-billboard-and-navigation's list cache sits on
// top of three invariants that a perfectly successful response cannot reveal
// on its own — each one leaves the billboard rendering fine while lying to
// someone, or fetching TMDB when it should not:
//
//  - handing Redis the enriched (post-ownership) rows instead of the
//    catalog-only ones leaks this caller's mediaId/inLibrary into a key every
//    other user reads for the next 24h. The returned value looks identical
//    either way — only the string actually written to Redis can catch it.
//  - resolving the caller's locale without clamping it lets an unsupported
//    `uiLocale` (or `ui_locale` setting) become its own cache key. The page
//    still renders; the key space and the TMDB budget just grow silently.
//  - calling TMDB or Redis before the type is validated means an unsupported
//    `type` is not free — it costs a network round trip or a Redis round trip
//    it should never have started, with no observable difference to a caller
//    who only checks the thrown error.
describe('PopularMediaService', () => {
  let service: PopularMediaService;
  let tmdb: { popular: jest.Mock };
  let mediaType: { cacheAndEnrich: jest.Mock };
  let dispatch: { resolve: jest.Mock };
  let prisma: { user: { findUnique: jest.Mock } };
  let settings: { getMap: jest.Mock };
  let redis: { get: jest.Mock; set: jest.Mock };

  const filmRow = (overrides = {}) => ({
    id: 42,
    title: 'Dune',
    releaseDate: '2021-10-21',
    posterUrl: 'https://image.tmdb.org/t/p/w300/dune.jpg',
    originalLanguage: 'en',
    overview: 'Sand.',
    type: MEDIA_TYPE.MOVIE,
    ...overrides,
  });

  beforeEach(async () => {
    tmdb = { popular: jest.fn() };
    mediaType = { cacheAndEnrich: jest.fn() };
    dispatch = { resolve: jest.fn(() => mediaType) };
    prisma = { user: { findUnique: jest.fn() } };
    settings = { getMap: jest.fn().mockResolvedValue({}) };
    redis = { get: jest.fn().mockResolvedValue(null), set: jest.fn().mockResolvedValue('OK') };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PopularMediaService,
        { provide: TmdbClient, useValue: tmdb },
        { provide: MediaDispatchService, useValue: dispatch },
        { provide: PrismaService, useValue: prisma },
        { provide: SettingsService, useValue: settings },
        { provide: RedisService, useValue: redis },
      ],
    }).compile();

    service = module.get<PopularMediaService>(PopularMediaService);
  });

  it("never writes this caller's ownership into the shared list cache", async () => {
    const film = filmRow();
    tmdb.popular.mockResolvedValue([film]);
    mediaType.cacheAndEnrich.mockResolvedValue([{ ...film, mediaId: 5, inLibrary: true }]);
    prisma.user.findUnique.mockResolvedValue({ uiLocale: 'en' });

    const result = await service.list(MEDIA_TYPE.MOVIE, 'user-1');

    // The failure mode is invisible in the return value — cacheAndEnrich
    // decides what the caller ultimately sees. Only the literal string handed
    // to Redis can catch a write that happened after enrichment.
    expect(redis.set).toHaveBeenCalledTimes(1);
    const [, written] = redis.set.mock.calls[0];
    const parsed = JSON.parse(written);
    expect(parsed).toEqual([film]);
    for (const row of parsed) {
      expect(row).not.toHaveProperty('mediaId');
      expect(row).not.toHaveProperty('inLibrary');
    }

    expect(result).toEqual([{ ...film, mediaId: 5, inLibrary: true }]);
  });

  it("clamps an unsupported user uiLocale to the ':en' cache key", async () => {
    prisma.user.findUnique.mockResolvedValue({ uiLocale: 'de' });
    tmdb.popular.mockResolvedValue([filmRow()]);
    mediaType.cacheAndEnrich.mockResolvedValue([]);

    await service.list(MEDIA_TYPE.MOVIE, 'user-1');

    expect(redis.get).toHaveBeenCalledWith(`tmdb:popular:${MEDIA_TYPE.MOVIE}:en`);
    expect(tmdb.popular).toHaveBeenCalledWith(MEDIA_TYPE.MOVIE, 'en');
  });

  it("falls back to the installation's ui_locale setting when uiLocale is unset, clamped the same way", async () => {
    prisma.user.findUnique.mockResolvedValue({ uiLocale: null });
    settings.getMap.mockResolvedValue({ ui_locale: 'es' });
    tmdb.popular.mockResolvedValue([filmRow()]);
    mediaType.cacheAndEnrich.mockResolvedValue([]);

    await service.list(MEDIA_TYPE.MOVIE, 'user-1');

    expect(redis.get).toHaveBeenCalledWith(`tmdb:popular:${MEDIA_TYPE.MOVIE}:es`);
    expect(tmdb.popular).toHaveBeenCalledWith(MEDIA_TYPE.MOVIE, 'es');
  });

  it('rejects an unsupported type before touching Redis or TMDB', async () => {
    dispatch.resolve.mockImplementation(() => {
      throw new Error('error.media.unsupported_type');
    });

    await expect(service.list('person', 'user-1')).rejects.toThrow(
      'error.media.unsupported_type',
    );

    expect(redis.get).not.toHaveBeenCalled();
    expect(redis.set).not.toHaveBeenCalled();
    expect(tmdb.popular).not.toHaveBeenCalled();
  });

  // Defends against a rejected key (401) being reported as a generic outage, or
  // every failure being upgraded to "bad key": the billboard would then show the
  // wrong onboarding state with no error anywhere.
  describe('TMDB failures', () => {
    const keyOf = async (err: unknown) => {
      tmdb.popular.mockRejectedValue(err);
      prisma.user.findUnique.mockResolvedValue({ uiLocale: 'en' });
      try {
        await service.list(MEDIA_TYPE.MOVIE, 'user-1');
      } catch (e) {
        return (e as { getResponse: () => { i18n: { key: string } } }).getResponse().i18n.key;
      }
      return undefined;
    };

    it('maps a TMDB 401 to catalog_unauthorized and writes nothing to the cache', async () => {
      expect(await keyOf(new TmdbHttpError(401, 'TMDB 401'))).toBe('error.media.catalog_unauthorized');
      expect(redis.set).not.toHaveBeenCalled();
    });

    it('keeps catalog_unavailable for a TMDB 500', async () => {
      expect(await keyOf(new TmdbHttpError(500, 'TMDB 500'))).toBe('error.media.catalog_unavailable');
      expect(redis.set).not.toHaveBeenCalled();
    });

    it('keeps catalog_unavailable for a network error', async () => {
      expect(await keyOf(new TypeError('fetch failed'))).toBe('error.media.catalog_unavailable');
    });
  });
});
