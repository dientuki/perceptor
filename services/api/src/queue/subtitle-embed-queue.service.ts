import { Injectable, OnModuleDestroy } from '@nestjs/common';
import { Queue } from 'bullmq';
import {
  SUBTITLE_EMBED_JOB,
  SUBTITLE_EMBED_QUEUE,
  SubtitleEmbedJob,
} from '@/queue/types';
import { redisConnection } from '@/queue/connection';

@Injectable()
export class SubtitleEmbedQueueService implements OnModuleDestroy {
  private readonly queue = new Queue<SubtitleEmbedJob>(SUBTITLE_EMBED_QUEUE, {
    connection: redisConnection(),
  });

  // Spec 101, NFR-3
  async addEmbed(payload: SubtitleEmbedJob) {
    return this.queue.add(SUBTITLE_EMBED_JOB, payload, {
      jobId: `embed-${payload.subtitleEmbedId}`,
      attempts: 1,
    });
  }

  async onModuleDestroy() {
    await this.queue.close();
  }
}
