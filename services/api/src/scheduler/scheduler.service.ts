import { Injectable, OnModuleInit } from '@nestjs/common';
import { ModuleRef } from '@nestjs/core';
import { SchedulerRegistry } from '@nestjs/schedule';
import { CronJob, CronTime } from 'cron';
import { ScheduledTaskOutcome as PrismaScheduledTaskOutcome } from '@prisma/client';

import { PrismaService } from '@/prisma/prisma.service';
import { SettingsService } from '@/settings/settings.service';
import { i18nError } from '@/i18n/i18n-error';
import { ERROR_KEYS } from '@/i18n/error-keys';
import {
  SCHEDULED_TASKS,
  ScheduledTaskDefinition,
  findScheduledTask,
  scheduleCronSettingKey,
  scheduleEnabledSettingKey,
  AUTO_ACQUIRE_EPISODES_SINCE_KEY,
} from './scheduler.registry';
import { ScheduledTask } from './entities/scheduled-task.entity';
import { ScheduledTaskOutcome } from './entities/scheduled-task-outcome.enum';

// Spec 035, REQ-5
export type ScheduledTaskTrigger = 'cron' | 'manual';

// Spec 035, NFR-3
const RUN_HISTORY_LIMIT = 50;

/** The Settings key that gates a media type, keyed the same way `MediaType`
 * values already read (045-media-type-availability). */
const MEDIA_TYPE_ENABLED_SETTING_KEY: Record<string, string> = {
  movie: 'movies_enabled',
  show: 'shows_enabled',
};

@Injectable()
export class SchedulerService implements OnModuleInit {
  // Spec 035, REQ-5
  private readonly runningTaskIds = new Set<string>();

  // 045-media-type-availability: derives availability from the settings map
  // the caller already holds, rather than injecting `MediaCapabilitiesService`
  // — doing so would pull `MediaModule` (and with it `MoviesModule`/
  // `ShowsModule`) into `SchedulerModule`, adding a third edge to the
  // `SettingsModule ⇄ SchedulerModule` cycle that already needs `forwardRef`
  // on both sides. A task with no `mediaType` is
  // always available. `!== 'false'` matches the idiom used elsewhere for a
  // boolean Setting: an absent row reads as enabled.
  private isAvailable(
    definition: ScheduledTaskDefinition,
    settingsMap: Record<string, string>,
  ): boolean {
    if (!definition.mediaType) return true;
    const key = MEDIA_TYPE_ENABLED_SETTING_KEY[definition.mediaType];
    return settingsMap[key] !== 'false';
  }

  constructor(
    private readonly prisma: PrismaService,
    private readonly settingsService: SettingsService,
    private readonly schedulerRegistry: SchedulerRegistry,
    private readonly moduleRef: ModuleRef,
  ) {}

  async stampAcquireEpisodesCutoff(): Promise<void> {
    const value = new Date().toISOString();
    await this.prisma.setting.upsert({
      where: { key: AUTO_ACQUIRE_EPISODES_SINCE_KEY },
      update: { value },
      create: { key: AUTO_ACQUIRE_EPISODES_SINCE_KEY, value },
    });
  }

  async onModuleInit(): Promise<void> {
    await this.reconcileOrphanedRuns();
    await this.arm();
  }

  // Spec 035, NFR-5
  private async reconcileOrphanedRuns(): Promise<void> {
    const orphaned = await this.prisma.scheduledTaskRun.findMany({
      where: { finishedAt: null },
      select: { id: true },
    });
    if (orphaned.length === 0) return;

    await this.prisma.scheduledTaskRun.updateMany({
      where: { id: { in: orphaned.map((row) => row.id) } },
      data: {
        outcome: PrismaScheduledTaskOutcome.FAILED,
        finishedAt: new Date(),
        error: 'api restarted while this task was still running',
      },
    });
  }

  // Spec 035, T010; Spec 035, REQ-3
  async arm(): Promise<void> {
    const map = await this.settingsService.getMap();

    for (const definition of SCHEDULED_TASKS) {
      const { id } = definition;

      if (this.schedulerRegistry.doesExist('cron', id)) {
        this.schedulerRegistry.deleteCronJob(id);
      }

      const enabled = map[scheduleEnabledSettingKey(id)] === 'true';
      if (!enabled) continue;

      // Spec 045, REQ-9
      if (!this.isAvailable(definition, map)) continue;

      const cronExpression = map[scheduleCronSettingKey(id)] ?? definition.defaultCron;

      // Spec 035, NFR-2
      try {
        new CronTime(cronExpression);
      } catch {
        console.error(
          `[scheduler] task "${id}" has an invalid cron expression ("${cronExpression}") — leaving it disarmed`,
        );
        continue;
      }

      const job = new CronJob(cronExpression, () => {
        void this.runTask(id, 'cron');
      });
      job.start();
      this.schedulerRegistry.addCronJob(id, job);
    }
  }

  // Spec 035, AC-5
  async runTask(id: string, trigger: ScheduledTaskTrigger): Promise<void> {
    const definition = findScheduledTask(id);
    if (!definition) {
      throw i18nError.notFound(ERROR_KEYS.SCHEDULE_TASK_NOT_FOUND, { id });
    }

    // Spec 045, REQ-9
    const map = await this.settingsService.getMap();
    if (!this.isAvailable(definition, map)) {
      if (trigger === 'manual') {
        throw i18nError.forbidden(ERROR_KEYS.SCHEDULE_TASK_UNAVAILABLE, { id });
      }
      return;
    }

    if (this.runningTaskIds.has(id)) {
      if (trigger === 'manual') {
        throw i18nError.conflict(ERROR_KEYS.SCHEDULE_TASK_ALREADY_RUNNING, { id });
      }

      // Spec 035, REQ-5
      await this.prisma.scheduledTaskRun.create({
        data: {
          taskId: id,
          outcome: PrismaScheduledTaskOutcome.SKIPPED,
          finishedAt: new Date(),
        },
      });
      return;
    }

    this.runningTaskIds.add(id);

    // `outcome` has no NULL/"RUNNING" value in the schema or the frozen
    // GraphQL enum (only SUCCESS/FAILED/SKIPPED) — `finishedAt: null` is
    // what marks this row as still in flight. The placeholder outcome
    // below is never read while the row is open (`list()` only surfaces a
    // run once `finishedAt` is set) and matches what `reconcileOrphanedRuns`
    // would write anyway if the process died right here.
    const run = await this.prisma.scheduledTaskRun.create({
      data: {
        taskId: id,
        outcome: PrismaScheduledTaskOutcome.FAILED,
      },
    });

    try {
      const handler = this.moduleRef.get(definition.handler, { strict: false });
      const result = await handler.run();
      await this.prisma.scheduledTaskRun.update({
        where: { id: run.id },
        data: {
          outcome: PrismaScheduledTaskOutcome.SUCCESS,
          finishedAt: new Date(),
          itemsProcessed: result.itemsProcessed,
        },
      });
    } catch (err) {
      await this.prisma.scheduledTaskRun.update({
        where: { id: run.id },
        data: {
          outcome: PrismaScheduledTaskOutcome.FAILED,
          finishedAt: new Date(),
          error: String(err),
        },
      });
    } finally {
      this.runningTaskIds.delete(id);
      await this.prune(id);
    }
  }

  // Spec 035, REQ-7
  async list(): Promise<ScheduledTask[]> {
    const map = await this.settingsService.getMap();
    const tasks: ScheduledTask[] = [];
    for (const definition of SCHEDULED_TASKS) {
      tasks.push(await this.buildStatus(definition, map));
    }
    return tasks;
  }

  private async buildStatus(
    definition: ScheduledTaskDefinition,
    settingsMap: Record<string, string>,
  ): Promise<ScheduledTask> {
    const { id } = definition;

    const task = new ScheduledTask();
    task.id = id;
    task.enabled = settingsMap[scheduleEnabledSettingKey(id)] === 'true';
    task.cron = settingsMap[scheduleCronSettingKey(id)] ?? definition.defaultCron;
    task.running = this.runningTaskIds.has(id);
    task.nextRunAt = this.schedulerRegistry.doesExist('cron', id)
      ? this.schedulerRegistry.getCronJob(id).nextDate().toJSDate()
      : undefined;
    task.available = this.isAvailable(definition, settingsMap);

    // Only a *finished* run is a candidate for `lastRun` — a row still open
    // (`finishedAt: null`) has no meaningful `outcome` yet (see runTask's
    // placeholder above) and would violate the frozen `outcome:
    // ScheduledTaskOutcome!` contract if it ever surfaced.
    const lastRunRow = await this.prisma.scheduledTaskRun.findFirst({
      where: { taskId: id, finishedAt: { not: null } },
      orderBy: { startedAt: 'desc' },
    });
    task.lastRun = lastRunRow
      ? {
          id: lastRunRow.id,
          startedAt: lastRunRow.startedAt,
          finishedAt: lastRunRow.finishedAt ?? undefined,
          outcome: lastRunRow.outcome as unknown as ScheduledTaskOutcome,
          itemsProcessed: lastRunRow.itemsProcessed,
          error: lastRunRow.error ?? undefined,
        }
      : undefined;

    return task;
  }

  // Spec 035, NFR-3
  private async prune(taskId: string): Promise<void> {
    const stale = await this.prisma.scheduledTaskRun.findMany({
      where: { taskId },
      orderBy: { startedAt: 'desc' },
      skip: RUN_HISTORY_LIMIT,
      select: { id: true },
    });
    if (stale.length === 0) return;

    await this.prisma.scheduledTaskRun.deleteMany({
      where: { id: { in: stale.map((row) => row.id) } },
    });
  }
}
