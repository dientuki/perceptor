import { Injectable, OnModuleDestroy } from '@nestjs/common';
import { Queue } from 'bullmq';
import { ENCODE_QUEUE, ENCODE_JOB, EncodeJob } from '@/queue/types';
import { redisConnection } from '@/queue/connection';

@Injectable()
export class EncodeQueueService implements OnModuleDestroy {
  private readonly queue = new Queue<EncodeJob>(ENCODE_QUEUE, {
    connection: redisConnection(),
  });

  // jobId derivado del ProcessJob: un re-scan que vuelva a pasar por acá no
  // encola el mismo encode dos veces. Prefijado porque BullMQ rechaza jobIds
  // puramente numéricos ("1"), reservados para su contador interno
  // autogenerado (ver `Job.validateOptions`).
  async addEncode(payload: EncodeJob) {
    return this.queue.add(ENCODE_JOB, payload, {
      jobId: `job-${payload.processJobId}`,
    });
  }

  async onModuleDestroy() {
    await this.queue.close();
  }
}
