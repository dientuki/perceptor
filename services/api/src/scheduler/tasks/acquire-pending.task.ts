import { Injectable } from '@nestjs/common';

import { ScheduledTaskHandler } from '../scheduler.registry';

/**
 * Stub for the `acquire_pending` scheduled task. Sweeping the indexer for a
 * release of a title that still has none is out of scope for
 * 035-scheduled-tasks — see spec.md § Out of Scope. This handler performs no
 * work and reports zero items processed.
 */
@Injectable()
export class AcquirePendingTask implements ScheduledTaskHandler {
  async run(): Promise<{ itemsProcessed: number }> {
    return { itemsProcessed: 0 };
  }
}
