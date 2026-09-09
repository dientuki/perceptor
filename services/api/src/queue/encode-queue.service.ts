import { Injectable, OnModuleDestroy } from '@nestjs/common';
import { Queue } from 'bullmq';
import { ENCODE_QUEUE, ENCODE_JOB, EncodeJob, ENCODE_CANCEL_CHANNEL, EncodeCancelMessage } from '@/queue/types';
import { redisConnection } from '@/queue/connection';
import { RedisService } from '@/redis/redis.service';

@Injectable()
export class EncodeQueueService implements OnModuleDestroy {
  private readonly queue = new Queue<EncodeJob>(ENCODE_QUEUE, {
    connection: redisConnection(),
  });

  constructor(private readonly redis: RedisService) {}

  // jobId derivado del ProcessJob: un re-scan que vuelva a pasar por acá no
  // encola el mismo encode dos veces. Prefijado porque BullMQ rechaza jobIds
  // puramente numéricos ("1"), reservados para su contador interno
  // autogenerado (ver `Job.validateOptions`).
  async addEncode(payload: EncodeJob) {
    return this.queue.add(ENCODE_JOB, payload, {
      jobId: `job-${payload.processJobId}`,
    });
  }

  // Mirror of addEncode: same derived id. A 0 return means there was nothing to
  // remove (already processed) or the entry is currently active — an active
  // encode is handled by publishCancel below, not by withdrawal. Never thrown.
  async removeEncode(processJobId: number): Promise<void> {
    const removed = await this.queue.remove(`job-${processJobId}`);
    if (!removed) {
      console.log(`EncodeQueueService.removeEncode: nothing removed for job-${processJobId}`);
    }
  }

  // One-way, no ack expected and none read (NFR-1). A worker not currently
  // encoding this job ignores the message; there is nothing to wait for here.
  async publishCancel(processJobId: number): Promise<void> {
    const message: EncodeCancelMessage = { processJobId };
    await this.redis.publish(ENCODE_CANCEL_CHANNEL, JSON.stringify(message));
  }

  async onModuleDestroy() {
    await this.queue.close();
  }
}
