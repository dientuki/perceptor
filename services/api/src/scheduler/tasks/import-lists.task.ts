import { Injectable } from '@nestjs/common';

import { ScheduledTaskHandler } from '../scheduler.registry';
import { TmdbListsService } from '@/tmdb-lists/tmdb-lists.service';

// Spec 109, REQ-5
@Injectable()
export class ImportListsTask implements ScheduledTaskHandler {
  constructor(private readonly lists: TmdbListsService) {}

  async run(): Promise<{ itemsProcessed: number }> {
    const { registered, listsFailed } = await this.lists.importAll();

    if (listsFailed > 0) {
      throw new Error(
        `import_lists: ${listsFailed} list(s) failed; ${registered} title(s) registered`,
      );
    }

    return { itemsProcessed: registered };
  }
}
