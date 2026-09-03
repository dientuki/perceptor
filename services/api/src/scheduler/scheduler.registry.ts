import { Type } from '@nestjs/common';

import { AcquirePendingTask } from './tasks/acquire-pending.task';
import { RefreshEpisodesTask } from './tasks/refresh-episodes.task';
import { RefreshMoviesTask } from './tasks/refresh-movies.task';
import { RefreshShowsTask } from './tasks/refresh-shows.task';

/**
 * Every scheduled task's shape: a stable id, the cron cadence it ships with
 * before an administrator ever touches Settings, and the injectable that
 * runs when the task fires. A row configured for an id outside this array
 * cannot be queried, triggered or run (REQ-1).
 */
export interface ScheduledTaskDefinition {
  id: string;
  defaultCron: string;
  handler: Type<ScheduledTaskHandler>;
}

/**
 * A task handler's contract. Every handler in `src/scheduler/tasks/` is a
 * no-op stub for this feature (spec.md § Out of Scope) — the body lands in
 * a follow-up spec, this interface is what it will still satisfy.
 */
export interface ScheduledTaskHandler {
  run(): Promise<{ itemsProcessed: number }>;
}

/** Derives the Settings key that holds a task's enabled flag from its id. */
export function scheduleEnabledSettingKey(taskId: string): string {
  return `schedule_${taskId}_enabled`;
}

/** Derives the Settings key that holds a task's cron cadence from its id. */
export function scheduleCronSettingKey(taskId: string): string {
  return `schedule_${taskId}_cron`;
}

export const SCHEDULED_TASKS: readonly ScheduledTaskDefinition[] = [
  {
    id: 'refresh_movies',
    defaultCron: '0 4 * * *',
    handler: RefreshMoviesTask,
  },
  {
    id: 'refresh_shows',
    defaultCron: '0 5 * * *',
    handler: RefreshShowsTask,
  },
  {
    id: 'refresh_episodes',
    defaultCron: '0 6 * * *',
    handler: RefreshEpisodesTask,
  },
  {
    id: 'acquire_pending',
    defaultCron: '0 * * * *',
    handler: AcquirePendingTask,
  },
] as const;

export function findScheduledTask(id: string): ScheduledTaskDefinition | undefined {
  return SCHEDULED_TASKS.find((task) => task.id === id);
}
