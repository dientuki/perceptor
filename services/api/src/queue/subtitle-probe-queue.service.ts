import { Injectable, OnModuleDestroy } from '@nestjs/common';
import { Queue } from 'bullmq';
import {
  SUBTITLE_PROBE_JOB,
  SUBTITLE_PROBE_QUEUE,
  SubtitleProbeJob,
} from '@/queue/types';
import { redisConnection } from '@/queue/connection';

const jobId = (subtitleSearchId: number) =>
  `subtitle-probe-${subtitleSearchId}`;

// Spec 107, T005
@Injectable()
export class SubtitleProbeQueueService implements OnModuleDestroy {
  private readonly queue = new Queue<SubtitleProbeJob>(SUBTITLE_PROBE_QUEUE, {
    connection: redisConnection(),
  });

  async addProbe(payload: SubtitleProbeJob) {
    return this.queue.add(SUBTITLE_PROBE_JOB, payload, {
      jobId: jobId(payload.subtitleSearchId),
      attempts: 1,
    });
  }

  // BullMQ ignores an add whose jobId still exists, so a re-queue removes first.
  async removeProbe(subtitleSearchId: number): Promise<void> {
    const job = await this.queue.getJob(jobId(subtitleSearchId));
    if (!job) return;
    try {
      await job.remove();
    } catch {
      // A job locked by a live worker cannot be removed; it is not stale.
    }
  }

  async onModuleDestroy() {
    await this.queue.close();
  }
}
