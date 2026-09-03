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
} from './scheduler.registry';
import { ScheduledTask } from './entities/scheduled-task.entity';
import { ScheduledTaskOutcome } from './entities/scheduled-task-outcome.enum';

/** How a run was fired — the only distinction that changes REQ-5's behaviour: a
 * manual call refuses outright, a cron tick just records the occurrence as
 * skipped rather than surfacing an error nobody is there to see. */
export type ScheduledTaskTrigger = 'cron' | 'manual';

/** Bounded window per task (NFR-3) — a per-minute cadence over a year must not
 * turn `scheduled_task_runs` into an unbounded table on a self-hosted MariaDB. */
const RUN_HISTORY_LIMIT = 50;

@Injectable()
export class SchedulerService implements OnModuleInit {
  // In-process concurrency guard for REQ-5. This is *not* a database lock —
  // it only holds within this one Node process. That is correct today
  // because `api` runs as exactly one container with no replicas
  // (docs/spec/features/035-scheduled-tasks/plan.md § Risks), but scaling
  // `api` to more than one instance would let every task run once per
  // replica with no error anywhere. A Redis lock is the fix for that day,
  // not before (Article X) — the run rows at least make the doubling
  // visible after the fact.
  private readonly runningTaskIds = new Set<string>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly settingsService: SettingsService,
    private readonly schedulerRegistry: SchedulerRegistry,
    private readonly moduleRef: ModuleRef,
  ) {}

  async onModuleInit(): Promise<void> {
    await this.reconcileOrphanedRuns();
    await this.arm();
  }

  // NFR-5: a run left with `finishedAt: null` by a process that crashed or
  // was killed mid-occurrence must be closed on boot. Without this, that
  // task's history permanently shows an occurrence that never finished —
  // and if anything downstream ever came to trust a DB-level "still
  // running" marker instead of the in-process guard, it would lock that
  // task out forever with no error surfaced anywhere.
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

  // Reads the current Settings map and (re-)arms one CronJob per enabled
  // task, replacing whatever was previously armed for that id rather than
  // stacking a second job on top of it — called on boot and again whenever
  // `updateSettings` touches a `schedule_*` key (T010), which is what keeps
  // a cadence change from taking effect only after a restart (REQ-3).
  async arm(): Promise<void> {
    const map = await this.settingsService.getMap();

    for (const definition of SCHEDULED_TASKS) {
      const { id } = definition;

      if (this.schedulerRegistry.doesExist('cron', id)) {
        this.schedulerRegistry.deleteCronJob(id);
      }

      const enabled = map[scheduleEnabledSettingKey(id)] === 'true';
      if (!enabled) continue;

      const cronExpression = map[scheduleCronSettingKey(id)] ?? definition.defaultCron;

      // NFR-2: a missing, malformed or unseeded scheduling setting must
      // never be the reason `api` fails to start — it just leaves this one
      // task disarmed.
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

  // The single execution path for both a cron tick and a manual
  // `runScheduledTask` call. Never rethrows past its own try/catch (AC-5):
  // an exception escaping into the `CronJob` callback would be an unhandled
  // rejection inside a timer, which takes the whole `api` process down over
  // one background task's failure.
  async runTask(id: string, trigger: ScheduledTaskTrigger): Promise<void> {
    const definition = findScheduledTask(id);
    if (!definition) {
      throw i18nError.notFound(ERROR_KEYS.SCHEDULE_TASK_NOT_FOUND, { id });
    }

    if (this.runningTaskIds.has(id)) {
      if (trigger === 'manual') {
        throw i18nError.conflict(ERROR_KEYS.SCHEDULE_TASK_ALREADY_RUNNING, { id });
      }

      // REQ-5: a tick that lands on an already-running occurrence is
      // skipped, not queued — but the skip must still be visible on the
      // task's status, so it gets its own (already-finished) run row.
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

  // REQ-7's status projection: every registered task joined with its
  // Settings-backed enable/cron, whether it is currently running, its next
  // scheduled occurrence (null when disabled) and its last *finished* run.
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

  // NFR-3: keeps the most recent RUN_HISTORY_LIMIT rows per task, deletes
  // the rest. Runs after the record is written, never before, so the
  // status query (`lastRun`) can never observe a window that has already
  // dropped the row it needs (../plan.md § Risks).
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
