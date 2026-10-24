import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { Queue, Worker } from 'bullmq';
import { redisConnection } from '@/queue/connection';

// Spec 103: api-internal. Neither produced nor consumed by the worker service.
export const SUBTITLE_SEARCH_QUEUE = 'subtitle-search';
export const SUBTITLE_SEARCH_ADVANCE_JOB = 'advance';

export type SubtitleSearchAdvanceJob = {
  searchId: number;
};

export type SubtitleSearchHandler = (searchId: number) => Promise<void>;

// Spec 103, REQ-6 NFR-5
@Injectable()
export class SubtitleSearchQueueService
  implements OnModuleInit, OnModuleDestroy
{
  private readonly logger = new Logger(SubtitleSearchQueueService.name);

  private readonly queue = new Queue<SubtitleSearchAdvanceJob>(
    SUBTITLE_SEARCH_QUEUE,
    { connection: redisConnection() },
  );

  private worker: Worker<SubtitleSearchAdvanceJob> | null = null;

  private handler: SubtitleSearchHandler | null = null;

  setHandler(handler: SubtitleSearchHandler) {
    this.handler = handler;
  }

  onModuleInit() {
    this.worker = new Worker<SubtitleSearchAdvanceJob>(
      SUBTITLE_SEARCH_QUEUE,
      (job) => this.dispatch(job.data.searchId),
      { connection: redisConnection(), concurrency: 1 },
    );
    this.worker.on('error', (error) => {
      this.logger.warn(`subtitle-search worker error: ${String(error)}`);
    });
  }

  // Spec 103, REQ-6
  async wake(searchId: number, delayMs = 0) {
    return this.queue.add(
      SUBTITLE_SEARCH_ADVANCE_JOB,
      { searchId },
      {
        delay: delayMs,
        attempts: 1,
        removeOnComplete: true,
        removeOnFail: true,
      },
    );
  }

  // A handler failure never reaches BullMQ: the driver fails the search itself.
  private async dispatch(searchId: number): Promise<void> {
    if (!this.handler) {
      this.logger.warn(
        `Wake-up for subtitle search ${searchId} dropped: no handler registered`,
      );
      return;
    }

    try {
      await this.handler(searchId);
    } catch (error) {
      this.logger.error(
        `Subtitle search ${searchId} handler threw: ${String(error)}`,
      );
    }
  }

  async onModuleDestroy() {
    await this.worker?.close();
    await this.queue.close();
  }
}
