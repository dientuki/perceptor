import { Injectable, OnModuleDestroy } from '@nestjs/common';
import { Queue } from 'bullmq';
import {
  SUBTITLE_EMBED_SYNC_JOB,
  SUBTITLE_SYNC_JOB,
  SUBTITLE_SYNC_QUEUE,
  SubtitleEmbedSyncJob,
  SubtitleSyncJob,
} from '@/queue/types';
import { redisConnection } from '@/queue/connection';

@Injectable()
export class SubtitleSyncQueueService implements OnModuleDestroy {
  private readonly queue = new Queue<SubtitleSyncJob | SubtitleEmbedSyncJob>(SUBTITLE_SYNC_QUEUE, {
    connection: redisConnection(),
  });

  // Spec 103, NFR-4
  async addSync(payload: SubtitleSyncJob) {
    return this.queue.add(SUBTITLE_SYNC_JOB, payload, {
      jobId: `subtitle-sync-${payload.subtitleSyncId}`,
      attempts: 1,
    });
  }

  // Spec 113, REQ-3
  async addEmbedSync(payload: SubtitleEmbedSyncJob, trackIndex: number) {
    return this.queue.add(SUBTITLE_EMBED_SYNC_JOB, payload, {
      jobId: `subtitle-embed-sync-${payload.subtitleEmbedId}-${trackIndex}`,
      attempts: 1,
    });
  }

  async onModuleDestroy() {
    await this.queue.close();
  }
}
