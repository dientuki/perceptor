import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { Queue } from 'bullmq';
import {
  LIBRARY_TAGS_JOB,
  LIBRARY_TAGS_QUEUE,
  LibraryTagsJob,
} from '@/queue/types';
import { redisConnection } from '@/queue/connection';

const jobId = (itemId: number) => `library-tags-${itemId}`;

// Spec 123, REQ-17
@Injectable()
export class LibraryTagsQueueService implements OnModuleDestroy {
  private readonly logger = new Logger(LibraryTagsQueueService.name);
  private readonly queue = new Queue<LibraryTagsJob>(LIBRARY_TAGS_QUEUE, {
    connection: redisConnection(),
  });

  // Never throws: the item stays unsettled and the next worker boot re-enqueues it.
  async enqueue(itemId: number): Promise<void> {
    try {
      const existing = await this.queue.getJob(jobId(itemId));
      if (existing) await existing.remove().catch(() => undefined);
      await this.queue.add(
        LIBRARY_TAGS_JOB,
        { itemId },
        {
          jobId: jobId(itemId),
          attempts: 2,
          backoff: { type: 'fixed', delay: 60_000 },
          removeOnComplete: true,
          removeOnFail: true,
        },
      );
    } catch (err) {
      this.logger.warn(
        `library-tags enqueue failed for ${jobId(itemId)}: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    }
  }

  async onModuleDestroy() {
    await this.queue.close();
  }
}
