import { Type } from '@nestjs/common';

import { MediaType } from '@/types/media';
import { AcquireEpisodesTask } from './tasks/acquire-episodes.task';
import { AcquireMoviesTask } from './tasks/acquire-movies.task';
import { RefreshEpisodesTask } from './tasks/refresh-episodes.task';
import { RefreshMoviesTask } from './tasks/refresh-movies.task';
import { RefreshShowsTask } from './tasks/refresh-shows.task';

// Spec 035, REQ-1; Spec 045, REQ-9
export interface ScheduledTaskDefinition {
  id: string;
  defaultCron: string;
  handler: Type<ScheduledTaskHandler>;
  mediaType?: MediaType;
}

/**
 * A task handler's contract. Every handler in `src/scheduler/tasks/` is a
 * no-op stub for this feature (spec.md § Out of Scope) — the body lands in
 * a follow-up spec, this interface is what it will still satisfy.
 */
export interface ScheduledTaskHandler {
  run(): Promise<{ itemsProcessed: number }>;
}

export const AUTO_ACQUIRE_EPISODES_SINCE_KEY = 'auto_acquire_episodes_since';

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
    mediaType: 'movie',
  },
  {
    id: 'refresh_shows',
    defaultCron: '0 5 * * *',
    handler: RefreshShowsTask,
    mediaType: 'show',
  },
  {
    id: 'refresh_episodes',
    defaultCron: '0 6 * * *',
    handler: RefreshEpisodesTask,
    mediaType: 'show',
  },
  {
    id: 'acquire_episodes',
    defaultCron: '0 3 * * *',
    handler: AcquireEpisodesTask,
    mediaType: 'show',
  },
  {
    id: 'acquire_movies',
    defaultCron: '0 2 * * *',
    handler: AcquireMoviesTask,
    mediaType: 'movie',
  },
] as const;

export function findScheduledTask(id: string): ScheduledTaskDefinition | undefined {
  return SCHEDULED_TASKS.find((task) => task.id === id);
}
