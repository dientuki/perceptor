// A wrong promotion here marks a film or episode COMPLETED that the user
// does not actually have — and they find out only when they try to play it,
// with nothing in any log saying anything went wrong. The never-downgrade
// guard (the `status: 'MISSING'` clause in every `updateMany`'s `where`) is
// the one thing standing between a Jellyfin hit and silently clobbering a
// download already in flight. Each case is written to fail if the rule it
// defends against is removed.

import { Test, TestingModule } from '@nestjs/testing';
import { MediaServerReconcileService } from './media-server-reconcile.service';
import { PrismaService } from '@/prisma/prisma.service';
import { SettingsService } from '@/settings/settings.service';
import { MediaServerIndexService } from '@/media-server-index/media-server-index.service';
import * as registry from '@/clients/media-server/registry';

describe('MediaServerReconcileService', () => {
  let service: MediaServerReconcileService;
  let getMap: jest.Mock;
  let movieUpdateMany: jest.Mock;
  let episodeUpdateMany: jest.Mock;
  let seasonFindMany: jest.Mock;
  let indexLookup: jest.Mock;

  beforeEach(async () => {
    getMap = jest.fn().mockResolvedValue({
      media_server_client: 'jellyfin',
      media_server_host: 'jellyfin.local',
      media_server_port: '8096',
      media_server_api_key: 'key',
    });
    movieUpdateMany = jest.fn().mockResolvedValue({ count: 1 });
    episodeUpdateMany = jest.fn().mockResolvedValue({ count: 1 });
    seasonFindMany = jest.fn().mockResolvedValue([]);
    indexLookup = jest.fn().mockResolvedValue(null);

    const prisma = {
      movie: { updateMany: movieUpdateMany },
      episode: { updateMany: episodeUpdateMany },
      season: { findMany: seasonFindMany },
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        MediaServerReconcileService,
        { provide: PrismaService, useValue: prisma },
        { provide: SettingsService, useValue: { getMap } },
        { provide: MediaServerIndexService, useValue: { lookup: indexLookup } },
      ],
    }).compile();

    service = module.get<MediaServerReconcileService>(
      MediaServerReconcileService,
    );
  });

  afterEach(() => jest.restoreAllMocks());

  function mockClient(
    overrides: Partial<{
      findByTmdbId: jest.Mock;
      listPresentEpisodes: jest.Mock;
    }> = {},
  ) {
    jest.spyOn(registry, 'createMediaServerClient').mockReturnValue({
      refreshLibrary: jest.fn(),
      createdMedia: jest.fn(),
      findByTmdbId: jest.fn().mockResolvedValue(null),
      listPresentEpisodes: jest.fn().mockResolvedValue([]),
      ...overrides,
    });
  }

  describe('reconcileMovie', () => {
    it('promotes a MISSING film to COMPLETED without writing filePath', async () => {
      mockClient({ findByTmdbId: jest.fn().mockResolvedValue('ext-1') });

      await service.reconcileMovie(42, 539);

      expect(movieUpdateMany).toHaveBeenCalledWith({
        where: { id: 42, status: 'MISSING' },
        data: { status: 'COMPLETED' },
      });
      expect(movieUpdateMany.mock.calls[0][0].data).not.toHaveProperty(
        'filePath',
      );
    });

    it('relies on the where-clause guard rather than a read-then-write for a DOWNLOADING film', async () => {
      mockClient({ findByTmdbId: jest.fn().mockResolvedValue('ext-1') });

      await service.reconcileMovie(42, 539);

      // The guard is expressed entirely in the updateMany call below — this
      // test fails if that call ever stops including status: 'MISSING' in
      // its where clause, which is what actually protects DOWNLOADING,
      // ENCODING and ERROR films from being clobbered.
      expect(movieUpdateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ status: 'MISSING' }),
        }),
      );
    });

    it('never writes MISSING', async () => {
      mockClient({ findByTmdbId: jest.fn().mockResolvedValue('ext-1') });
      await service.reconcileMovie(42, 539);

      for (const call of movieUpdateMany.mock.calls) {
        expect(call[0].data.status).not.toBe('MISSING');
      }
    });

    it('does nothing when the server does not have this film', async () => {
      mockClient({ findByTmdbId: jest.fn().mockResolvedValue(null) });
      await service.reconcileMovie(42, 539);
      expect(movieUpdateMany).not.toHaveBeenCalled();
    });

    it('does not propagate when the client throws', async () => {
      mockClient({
        findByTmdbId: jest.fn().mockRejectedValue(new Error('jellyfin down')),
      });
      await expect(service.reconcileMovie(42, 539)).resolves.toBeUndefined();
    });

    it('does nothing when no media server is configured', async () => {
      const createSpy = jest.spyOn(registry, 'createMediaServerClient');
      getMap.mockResolvedValue({
        media_server_client: 'none',
        media_server_host: '',
        media_server_port: '',
        media_server_api_key: '',
      });
      await service.reconcileMovie(42, 539);
      expect(createSpy).not.toHaveBeenCalled();
      expect(movieUpdateMany).not.toHaveBeenCalled();
    });
  });

  describe('reconcileShow', () => {
    const season1 = {
      seasonNumber: 1,
      episodes: [
        { id: 100, episodeNumber: 1 },
        { id: 101, episodeNumber: 2 },
      ],
    };
    const season0 = {
      seasonNumber: 0,
      episodes: [{ id: 200, episodeNumber: 1 }],
    };

    it('promotes only the episode the server reports present', async () => {
      mockClient({
        findByTmdbId: jest.fn().mockResolvedValue('ext-show'),
        listPresentEpisodes: jest
          .fn()
          .mockResolvedValue([{ seasonNumber: 1, episodeNumber: 1 }]),
      });
      seasonFindMany.mockResolvedValue([season1]);

      await service.reconcileShow(7, 1405);

      expect(episodeUpdateMany).toHaveBeenCalledTimes(1);
      expect(episodeUpdateMany).toHaveBeenCalledWith({
        where: { id: 100, status: 'MISSING' },
        data: { status: 'COMPLETED' },
      });
    });

    it('reconciles season 0 like any other season', async () => {
      mockClient({
        findByTmdbId: jest.fn().mockResolvedValue('ext-show'),
        listPresentEpisodes: jest
          .fn()
          .mockResolvedValue([{ seasonNumber: 0, episodeNumber: 1 }]),
      });
      seasonFindMany.mockResolvedValue([season0]);

      await service.reconcileShow(7, 1405);

      expect(episodeUpdateMany).toHaveBeenCalledWith({
        where: { id: 200, status: 'MISSING' },
        data: { status: 'COMPLETED' },
      });
    });

    it('skips an episode the server reports but the show does not have, without throwing', async () => {
      mockClient({
        findByTmdbId: jest.fn().mockResolvedValue('ext-show'),
        listPresentEpisodes: jest
          .fn()
          .mockResolvedValue([{ seasonNumber: 1, episodeNumber: 99 }]),
      });
      seasonFindMany.mockResolvedValue([season1]);

      await expect(service.reconcileShow(7, 1405)).resolves.toBeUndefined();
      expect(episodeUpdateMany).not.toHaveBeenCalled();
    });

    it('never writes MISSING', async () => {
      mockClient({
        findByTmdbId: jest.fn().mockResolvedValue('ext-show'),
        listPresentEpisodes: jest
          .fn()
          .mockResolvedValue([{ seasonNumber: 1, episodeNumber: 1 }]),
      });
      seasonFindMany.mockResolvedValue([season1]);

      await service.reconcileShow(7, 1405);

      for (const call of episodeUpdateMany.mock.calls) {
        expect(call[0].data.status).not.toBe('MISSING');
      }
    });

    it('does not propagate when the client throws', async () => {
      mockClient({
        findByTmdbId: jest.fn().mockRejectedValue(new Error('jellyfin down')),
      });
      await expect(service.reconcileShow(7, 1405)).resolves.toBeUndefined();
    });
  });
});
