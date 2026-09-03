import { Injectable } from '@nestjs/common';

import { ScheduledTaskHandler } from '../scheduler.registry';

/**
 * Stub for the `refresh_episodes` scheduled task. Updating an episode's
 * title/overview from TMDB once it becomes available is out of scope for
 * 035-scheduled-tasks — see spec.md § Out of Scope. This handler performs no
 * work and reports zero items processed.
 */
@Injectable()
export class RefreshEpisodesTask implements ScheduledTaskHandler {
  async run(): Promise<{ itemsProcessed: number }> {
    return { itemsProcessed: 0 };
  }
}
