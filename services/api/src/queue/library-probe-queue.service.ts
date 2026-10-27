import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { Queue } from 'bullmq';
import {
  LIBRARY_PROBE_JOB,
  LIBRARY_PROBE_QUEUE,
  LibraryProbeJob,
} from '@/queue/types';
import { redisConnection } from '@/queue/connection';

const jobId = (target: LibraryProbeJob) =>
  target.movieId !== undefined
    ? `library-probe-movie-${target.movieId}`
    : `library-probe-episode-${target.episodeId}`;

// Spec 108, T003
@Injectable()
export class LibraryProbeQueueService implements OnModuleDestroy {
  private readonly logger = new Logger(LibraryProbeQueueService.name);
  private readonly queue = new Queue<LibraryProbeJob>(LIBRARY_PROBE_QUEUE, {
    connection: redisConnection(),
  });

  // Never throws: a failed enqueue must not fail the caller's read.
  async request(target: LibraryProbeJob): Promise<void> {
    try {
      await this.queue.add(LIBRARY_PROBE_JOB, target, {
        jobId: jobId(target),
        attempts: 1,
        removeOnComplete: true,
        removeOnFail: true,
      });
    } catch (err) {
      this.logger.warn(
        `library-probe enqueue failed for ${jobId(target)}: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    }
  }

  async onModuleDestroy() {
    await this.queue.close();
  }
}
