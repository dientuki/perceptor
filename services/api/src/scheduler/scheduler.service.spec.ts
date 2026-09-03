import { Test, TestingModule } from '@nestjs/testing';
import { ModuleRef } from '@nestjs/core';
import { SchedulerRegistry } from '@nestjs/schedule';
import { ScheduledTaskOutcome as PrismaScheduledTaskOutcome } from '@prisma/client';

import { SchedulerService } from './scheduler.service';
import { PrismaService } from '@/prisma/prisma.service';
import { SettingsService } from '@/settings/settings.service';

// This suite defends against a scheduler that silently stops running with no
// error visible anywhere: a task locked out forever by a stale "still
// running" marker, a handler whose exception escapes into a cron timer's
// callback (an unhandled rejection that takes the whole `api` process down),
// a concurrent invocation that quietly doubles a run, or a re-arm that stacks
// a second cron job so every tick fires the task twice. None of these throw
// where a caller would notice — the only way to catch them is to assert the
// exact DB rows and registry calls each path produces.
describe('SchedulerService', () => {
  let service: SchedulerService;
  let prisma: {
    scheduledTaskRun: {
      findMany: jest.Mock;
      updateMany: jest.Mock;
      create: jest.Mock;
      update: jest.Mock;
      findFirst: jest.Mock;
      deleteMany: jest.Mock;
    };
  };
  let settingsService: { getMap: jest.Mock };
  let schedulerRegistry: {
    doesExist: jest.Mock;
    deleteCronJob: jest.Mock;
    addCronJob: jest.Mock;
    getCronJob: jest.Mock;
  };
  let moduleRef: { get: jest.Mock };

  beforeEach(async () => {
    prisma = {
      scheduledTaskRun: {
        findMany: jest.fn().mockResolvedValue([]),
        updateMany: jest.fn().mockResolvedValue({ count: 0 }),
        create: jest.fn().mockResolvedValue({ id: 1 }),
        update: jest.fn().mockResolvedValue({}),
        findFirst: jest.fn().mockResolvedValue(null),
        deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
      },
    };
    // Every task ships disabled (spec.md § Data Model Changes) — an empty map
    // is the honest default for a test that doesn't care about arming.
    settingsService = { getMap: jest.fn().mockResolvedValue({}) };
    schedulerRegistry = {
      doesExist: jest.fn().mockReturnValue(false),
      deleteCronJob: jest.fn(),
      addCronJob: jest.fn(),
      getCronJob: jest.fn(),
    };
    moduleRef = { get: jest.fn() };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SchedulerService,
        { provide: PrismaService, useValue: prisma },
        { provide: SettingsService, useValue: settingsService },
        { provide: SchedulerRegistry, useValue: schedulerRegistry },
        { provide: ModuleRef, useValue: moduleRef },
      ],
    }).compile();

    service = module.get(SchedulerService);
  });

  describe('onModuleInit (boot reconcile)', () => {
    it('closes a run row left RUNNING (finishedAt: null) by a prior process as FAILED', async () => {
      prisma.scheduledTaskRun.findMany.mockResolvedValue([{ id: 7 }, { id: 9 }]);

      await service.onModuleInit();

      expect(prisma.scheduledTaskRun.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { finishedAt: null } }),
      );
      expect(prisma.scheduledTaskRun.updateMany).toHaveBeenCalledWith({
        where: { id: { in: [7, 9] } },
        data: expect.objectContaining({
          outcome: PrismaScheduledTaskOutcome.FAILED,
          finishedAt: expect.any(Date),
        }),
      });
    });

    it('does not attempt a write when there is nothing orphaned', async () => {
      prisma.scheduledTaskRun.findMany.mockResolvedValue([]);

      await service.onModuleInit();

      expect(prisma.scheduledTaskRun.updateMany).not.toHaveBeenCalled();
    });

    it('reconciling the orphaned row unblocks the task — a manual trigger right after boot is not refused', async () => {
      prisma.scheduledTaskRun.findMany.mockResolvedValue([{ id: 1 }]);
      const handler = { run: jest.fn().mockResolvedValue({ itemsProcessed: 0 }) };
      moduleRef.get.mockReturnValue(handler);

      await service.onModuleInit();
      await service.runTask('refresh_movies', 'manual');

      // If the in-memory guard had been left set by boot reconcile (rather
      // than only tracking runs started this process), this call would
      // throw "already running" and the handler would never fire.
      expect(handler.run).toHaveBeenCalled();
    });
  });

  describe('runTask — failure path', () => {
    it('records a FAILED run and does not rethrow when the handler throws', async () => {
      const handler = { run: jest.fn().mockRejectedValue(new Error('boom')) };
      moduleRef.get.mockReturnValue(handler);
      prisma.scheduledTaskRun.create.mockResolvedValue({ id: 42 });

      await expect(service.runTask('refresh_movies', 'manual')).resolves.toBeUndefined();

      expect(prisma.scheduledTaskRun.update).toHaveBeenCalledWith({
        where: { id: 42 },
        data: expect.objectContaining({
          outcome: PrismaScheduledTaskOutcome.FAILED,
          finishedAt: expect.any(Date),
          error: expect.stringContaining('boom'),
        }),
      });
    });

    it('leaves the in-memory guard clear after a failure, so the next occurrence still runs', async () => {
      const handler = { run: jest.fn().mockRejectedValue(new Error('boom')) };
      moduleRef.get.mockReturnValue(handler);

      await service.runTask('refresh_movies', 'manual');
      await service.runTask('refresh_movies', 'manual');

      expect(handler.run).toHaveBeenCalledTimes(2);
    });
  });

  describe('runTask — concurrency guard (REQ-5)', () => {
    it('refuses a second manual call for the same id while the first is in-flight, and writes no second run row', async () => {
      let resolveHandler!: (value: { itemsProcessed: number }) => void;
      const inFlight = new Promise<{ itemsProcessed: number }>((resolve) => {
        resolveHandler = resolve;
      });
      const handler = { run: jest.fn().mockReturnValue(inFlight) };
      moduleRef.get.mockReturnValue(handler);
      prisma.scheduledTaskRun.create.mockResolvedValue({ id: 1 });

      const firstCall = service.runTask('refresh_movies', 'manual');
      // Let the first call's synchronous prefix (including the `create` that
      // marks the run open) run before the second call is issued.
      await Promise.resolve();
      await Promise.resolve();

      await expect(service.runTask('refresh_movies', 'manual')).rejects.toThrow();

      expect(prisma.scheduledTaskRun.create).toHaveBeenCalledTimes(1);

      resolveHandler({ itemsProcessed: 0 });
      await firstCall;
    });

    it('skips (rather than refuses) a concurrent cron tick, recording a SKIPPED run instead of a second in-flight one', async () => {
      let resolveHandler!: (value: { itemsProcessed: number }) => void;
      const inFlight = new Promise<{ itemsProcessed: number }>((resolve) => {
        resolveHandler = resolve;
      });
      const handler = { run: jest.fn().mockReturnValue(inFlight) };
      moduleRef.get.mockReturnValue(handler);
      prisma.scheduledTaskRun.create.mockResolvedValueOnce({ id: 1 });

      const firstCall = service.runTask('refresh_movies', 'cron');
      await Promise.resolve();
      await Promise.resolve();

      await service.runTask('refresh_movies', 'cron');

      expect(prisma.scheduledTaskRun.create).toHaveBeenCalledTimes(2);
      expect(prisma.scheduledTaskRun.create).toHaveBeenLastCalledWith({
        data: expect.objectContaining({
          taskId: 'refresh_movies',
          outcome: PrismaScheduledTaskOutcome.SKIPPED,
          finishedAt: expect.any(Date),
        }),
      });

      resolveHandler({ itemsProcessed: 0 });
      await firstCall;
    });
  });

  describe('arm — idempotent re-arming', () => {
    it('replaces rather than duplicates an already-armed cron job for the same task', async () => {
      settingsService.getMap.mockResolvedValue({
        schedule_refresh_movies_enabled: 'true',
        schedule_refresh_movies_cron: '0 4 * * *',
        schedule_refresh_shows_enabled: 'false',
        schedule_refresh_episodes_enabled: 'false',
        schedule_acquire_pending_enabled: 'false',
      });
      // Simulate the job already being armed from a prior call.
      schedulerRegistry.doesExist.mockImplementation((_type: string, id: string) => id === 'refresh_movies');

      await service.arm();

      expect(schedulerRegistry.deleteCronJob).toHaveBeenCalledWith('refresh_movies');
      expect(schedulerRegistry.addCronJob).toHaveBeenCalledTimes(1);
      expect(schedulerRegistry.addCronJob).toHaveBeenCalledWith('refresh_movies', expect.anything());

      const armedJob = schedulerRegistry.addCronJob.mock.calls[0][1];
      armedJob.stop();
    });

    it('calling arm() twice in a row still leaves exactly one armed job for the enabled task', async () => {
      settingsService.getMap.mockResolvedValue({
        schedule_refresh_movies_enabled: 'true',
        schedule_refresh_movies_cron: '0 4 * * *',
      });

      const armedIds = new Set<string>();
      schedulerRegistry.doesExist.mockImplementation((_type: string, id: string) => armedIds.has(id));
      schedulerRegistry.addCronJob.mockImplementation((id: string) => {
        armedIds.add(id);
      });

      await service.arm();
      await service.arm();

      // The second arm() must have deleted the job the first one added
      // before adding a new one — two live jobs for one id is exactly the
      // "runs twice, nothing errors" bug this test exists to catch.
      expect(schedulerRegistry.deleteCronJob).toHaveBeenCalledTimes(1);
      expect(schedulerRegistry.addCronJob).toHaveBeenCalledTimes(2);

      for (const call of schedulerRegistry.addCronJob.mock.calls) {
        (call[1] as { stop: () => void }).stop();
      }
    });
  });
});
