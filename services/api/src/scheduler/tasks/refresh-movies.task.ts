import { Injectable } from '@nestjs/common';

import { ScheduledTaskHandler } from '../scheduler.registry';

/**
 * Stub for the `refresh_movies` scheduled task. Refreshing a registered
 * film's TMDB data (release date, poster, etc.) is out of scope for
 * 035-scheduled-tasks — see spec.md § Out of Scope. This handler performs no
 * work and reports zero items processed.
 */
@Injectable()
export class RefreshMoviesTask implements ScheduledTaskHandler {
  async run(): Promise<{ itemsProcessed: number }> {
    return { itemsProcessed: 0 };
  }
}
