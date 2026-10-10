// A wrong promotion here marks a film or episode COMPLETED that the user
// does not actually have — and they find out only when they try to play it,
// with nothing in any log saying anything went wrong. The never-downgrade
// guard (the `status: 'MISSING'` clause in every `updateMany`'s `where`) is
// the one thing standing between a Jellyfin hit and silently clobbering a
// download already in flight. Each case is written to fail if the rule it
// defends against is removed.
//
// syncMovie/syncShow (069) add the opposite direction: demotion. Its silent
// failure is a mass demotion — a stale or half-read media server (index
// rebuild failed, listing threw) read as "the server holds nothing" would
// flip every COMPLETED title to MISSING with no error anywhere. So a failed
// read must produce FAILED with zero writes, and every write must carry the
// in-flight relation filter in its own `where`.
//
// Since deriveTitleStatus now treats mediaServerPresentAt as possession,
// every promotion here must set it and every demotion must clear it in the
// same updateMany that clears filePath — a demotion that cleared filePath
// alone would leave mediaServerPresentAt set, and the very next recompute
// would read that as possession and promote the title right back with no
// error anywhere.

// Spec 089, REQ-4 AC-10

import { Test, TestingModule } from '@nestjs/testing';
import { MediaServerReconcileService } from './media-server-reconcile.service';
import { PrismaService } from '@/prisma/prisma.service';
import { SettingsService } from '@/settings/settings.service';
import { MediaServerIndexService } from '@/media-server-index/media-server-index.service';
import * as registry from '@/clients/media-server/registry';
import { deriveTitleStatus } from '@/pipeline-status/pipeline-status';

describe('MediaServerReconcileService', () => {
  let service: MediaServerReconcileService;
  let getMap: jest.Mock;
  let movieUpdateMany: jest.Mock;
  let episodeUpdateMany: jest.Mock;
  let seasonFindMany: jest.Mock;
  let indexLookup: jest.Mock;
  let refreshAndWait: jest.Mock;

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
    refreshAndWait = jest.fn().mockResolvedValue('ready');

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
        {
          provide: MediaServerIndexService,
          useValue: { lookup: indexLookup, refreshAndWait },
        },
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
    it('promotes a MISSING film to COMPLETED, setting mediaServerPresentAt, without writing filePath', async () => {
      mockClient({ findByTmdbId: jest.fn().mockResolvedValue('ext-1') });

      await service.reconcileMovie(42, 539);

      const arg = movieUpdateMany.mock.calls[0][0];
      expect(arg.where).toEqual({ id: 42, status: 'MISSING' });
      expect(arg.data.status).toBe('COMPLETED');
      expect(arg.data.mediaServerPresentAt).toBeInstanceOf(Date);
      expect(arg.data).not.toHaveProperty('filePath');
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
      const arg = episodeUpdateMany.mock.calls[0][0];
      expect(arg.where).toEqual({ id: 100, status: 'MISSING' });
      expect(arg.data.status).toBe('COMPLETED');
      expect(arg.data.mediaServerPresentAt).toBeInstanceOf(Date);
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

      const arg = episodeUpdateMany.mock.calls[0][0];
      expect(arg.where).toEqual({ id: 200, status: 'MISSING' });
      expect(arg.data.status).toBe('COMPLETED');
      expect(arg.data.mediaServerPresentAt).toBeInstanceOf(Date);
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

  describe('sync', () => {
    const past = new Date('2020-01-01');
    const future = new Date('2999-01-01');
    const seasons = [
      {
        seasonNumber: 1,
        episodes: [
          { id: 1, episodeNumber: 1, releaseDate: past },
          { id: 2, episodeNumber: 2, releaseDate: past },
          { id: 3, episodeNumber: 3, releaseDate: future },
        ],
      },
    ];
    const sourceGuard = {
      none: { status: { notIn: ['ERROR', 'SCANNED'] } },
    };
    const jobGuard = {
      none: { status: { in: ['WAITING', 'QUEUED', 'ENCODING'] } },
    };

    function expectGuarded(where: any) {
      expect(where.mediaSources).toEqual(sourceGuard);
      expect(where.processJobs).toEqual(jobGuard);
    }

    it('promotes a present film with the in-flight guard inside the where, setting mediaServerPresentAt', async () => {
      mockClient({ findByTmdbId: jest.fn().mockResolvedValue('ext') });
      const r = await service.syncMovie(1, 5);
      expect(r).toEqual({ outcome: 'DONE', promoted: 1, demoted: 0 });
      const arg = movieUpdateMany.mock.calls[0][0];
      expect(arg.where.status).toBe('MISSING');
      expect(arg.data.status).toBe('COMPLETED');
      expect(arg.data.mediaServerPresentAt).toBeInstanceOf(Date);
      expectGuarded(arg.where);
    });

    it('demotes an absent film, clearing both filePath and mediaServerPresentAt, with the guard inside the where', async () => {
      mockClient({ findByTmdbId: jest.fn().mockResolvedValue(null) });
      const r = await service.syncMovie(1, 5);
      expect(r).toEqual({ outcome: 'DONE', promoted: 0, demoted: 1 });
      const arg = movieUpdateMany.mock.calls[0][0];
      expect(arg.where.status).toBe('COMPLETED');
      expect(arg.data).toEqual({
        status: 'MISSING',
        filePath: null,
        mediaServerPresentAt: null,
      });
      expectGuarded(arg.where);
    });

    // Spec 089, AC-10
    it('a demoted film does not get promoted back by an immediate recompute', async () => {
      mockClient({ findByTmdbId: jest.fn().mockResolvedValue(null) });
      await service.syncMovie(1, 5);
      const written = movieUpdateMany.mock.calls[0][0].data;

      const status = deriveTitleStatus({
        filePath: written.filePath,
        mediaServerPresentAt: written.mediaServerPresentAt,
        sources: [],
        jobs: [],
      });

      expect(status).toBe('MISSING');
    });

    it('is SKIPPED with no writes when no client is configured', async () => {
      getMap.mockResolvedValue({ media_server_client: 'none' });
      const r = await service.syncMovie(1, 5);
      expect(r.outcome).toBe('SKIPPED');
      expect(movieUpdateMany).not.toHaveBeenCalled();
    });

    it('is FAILED with zero writes when index freshness failed', async () => {
      mockClient({ findByTmdbId: jest.fn().mockResolvedValue(null) });
      refreshAndWait.mockResolvedValue('failed');
      const r = await service.syncMovie(1, 5);
      expect(r).toEqual({ outcome: 'FAILED', promoted: 0, demoted: 0 });
      expect(movieUpdateMany).not.toHaveBeenCalled();
    });

    it('proceeds when the client resolves natively', async () => {
      mockClient({ findByTmdbId: jest.fn().mockResolvedValue('ext') });
      refreshAndWait.mockResolvedValue('native');
      expect((await service.syncMovie(1, 5)).outcome).toBe('DONE');
    });

    it('listing throws -> FAILED, no updateMany issued', async () => {
      mockClient({
        findByTmdbId: jest.fn().mockResolvedValue('ext'),
        listPresentEpisodes: jest.fn().mockRejectedValue(new Error('boom')),
      });
      seasonFindMany.mockResolvedValue(seasons);
      const r = await service.syncShow(7, 9);
      expect(r).toEqual({ outcome: 'FAILED', promoted: 0, demoted: 0 });
      expect(episodeUpdateMany).not.toHaveBeenCalled();
    });

    it('is FAILED with zero writes when the show sync index failed', async () => {
      mockClient({ findByTmdbId: jest.fn().mockResolvedValue('ext') });
      refreshAndWait.mockResolvedValue('failed');
      seasonFindMany.mockResolvedValue(seasons);
      const r = await service.syncShow(7, 9);
      expect(r.outcome).toBe('FAILED');
      expect(episodeUpdateMany).not.toHaveBeenCalled();
    });

    it('an empty present list demotes only COMPLETED episodes, every write guarded, filePath cleared', async () => {
      mockClient({
        findByTmdbId: jest.fn().mockResolvedValue('ext'),
        listPresentEpisodes: jest.fn().mockResolvedValue([]),
      });
      seasonFindMany.mockResolvedValue(seasons);
      episodeUpdateMany.mockResolvedValue({ count: 2 });

      const r = await service.syncShow(7, 9);

      expect(r).toEqual({ outcome: 'DONE', promoted: 0, demoted: 4 });
      expect(episodeUpdateMany).toHaveBeenCalledTimes(2); // aired + unaired
      for (const [arg] of episodeUpdateMany.mock.calls) {
        expect(arg.where.status).toBe('COMPLETED');
        expect(arg.data).toEqual({
          status: 'MISSING',
          filePath: null,
          mediaServerPresentAt: null,
        });
        expectGuarded(arg.where);
      }
      const aired = episodeUpdateMany.mock.calls.find(
        ([a]) => a.where.id.in.length === 2,
      )![0];
      expect(aired.where.season).toEqual({ mediaSources: sourceGuard });
      const unaired = episodeUpdateMany.mock.calls.find(
        ([a]) => a.where.id.in.length === 1,
      )![0];
      expect(unaired.where).not.toHaveProperty('season');
    });

    // Spec 089, AC-10
    it('a demoted episode does not get promoted back by an immediate recompute, episode side', async () => {
      mockClient({
        findByTmdbId: jest.fn().mockResolvedValue('ext'),
        listPresentEpisodes: jest.fn().mockResolvedValue([]),
      });
      seasonFindMany.mockResolvedValue(seasons);
      episodeUpdateMany.mockResolvedValue({ count: 2 });

      await service.syncShow(7, 9);
      const written = episodeUpdateMany.mock.calls[0][0].data;

      const status = deriveTitleStatus({
        filePath: written.filePath,
        mediaServerPresentAt: written.mediaServerPresentAt,
        sources: [],
        jobs: [],
      });

      expect(status).toBe('MISSING');
    });

    it('promotes present episodes only from MISSING, matched by season and episode number', async () => {
      mockClient({
        findByTmdbId: jest.fn().mockResolvedValue('ext'),
        listPresentEpisodes: jest
          .fn()
          .mockResolvedValue([{ seasonNumber: 1, episodeNumber: 1 }]),
      });
      seasonFindMany.mockResolvedValue(seasons);
      const r = await service.syncShow(7, 9);
      expect(r.promoted).toBe(1);
      const promote = episodeUpdateMany.mock.calls.find(
        ([a]) => a.where.status === 'MISSING',
      )![0];
      expect(promote.where.id).toEqual({ in: [1] });
      expect(promote.data.status).toBe('COMPLETED');
      expect(promote.data.mediaServerPresentAt).toBeInstanceOf(Date);
      expectGuarded(promote.where);
    });
  });
});
