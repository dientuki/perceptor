import { Injectable } from '@nestjs/common';

import { ScheduledTaskHandler } from '../scheduler.registry';

/**
 * Stub for the `refresh_shows` scheduled task. Pulling a series' new seasons
 * from TMDB is out of scope for 035-scheduled-tasks — see spec.md § Out of
 * Scope. This handler performs no work and reports zero items processed.
 */
@Injectable()
export class RefreshShowsTask implements ScheduledTaskHandler {
  async run(): Promise<{ itemsProcessed: number }> {
    return { itemsProcessed: 0 };
  }
}
