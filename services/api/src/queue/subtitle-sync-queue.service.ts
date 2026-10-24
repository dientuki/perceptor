import { Injectable, OnModuleDestroy } from '@nestjs/common';
import { Queue } from 'bullmq';
import {
  SUBTITLE_SYNC_JOB,
  SUBTITLE_SYNC_QUEUE,
  SubtitleSyncJob,
} from '@/queue/types';
import { redisConnection } from '@/queue/connection';

@Injectable()
export class SubtitleSyncQueueService implements OnModuleDestroy {
  private readonly queue = new Queue<SubtitleSyncJob>(SUBTITLE_SYNC_QUEUE, {
    connection: redisConnection(),
  });

  // Spec 103, NFR-4
  async addSync(payload: SubtitleSyncJob) {
    return this.queue.add(SUBTITLE_SYNC_JOB, payload, {
      jobId: `subtitle-sync-${payload.subtitleSyncId}`,
      attempts: 1,
    });
  }

  async onModuleDestroy() {
    await this.queue.close();
  }
}
