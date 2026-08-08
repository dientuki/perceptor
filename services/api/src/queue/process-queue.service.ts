import { Injectable, OnModuleDestroy } from '@nestjs/common';
import { Queue } from 'bullmq';
import { PROCESS_QUEUE, SOURCE_READY_JOB, SourceReadyJob } from '@/queue/types';
import { redisConnection } from '@/queue/connection';

@Injectable()
export class ProcessQueueService implements OnModuleDestroy {
  private readonly queue = new Queue<SourceReadyJob>(PROCESS_QUEUE, {
    connection: redisConnection(),
  });

  async addSourceReady(payload: SourceReadyJob) {
    // jobId derivado de mediaSourceId: si el AutoRun dispara dos veces por el
    // mismo torrent, BullMQ descarta el duplicado en vez de encolarlo de nuevo.
    // Nota: no puede ser un string puramente numérico ("11"), BullMQ 6.x lo
    // rechaza porque esos ids quedan reservados para el contador interno
    // autogenerado (ver `Job.validateOptions`). Se prefija para evitarlo.
    return this.queue.add(SOURCE_READY_JOB, payload, {
      jobId: `media-source-${payload.mediaSourceId}`,
    });
  }

  async onModuleDestroy() {
    await this.queue.close();
  }
}
