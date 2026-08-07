import { Injectable, OnModuleDestroy } from '@nestjs/common';
import { Queue } from 'bullmq';
import { PROCESS_QUEUE, SOURCE_READY_JOB, SourceReadyJob } from '@/queue/types';

@Injectable()
export class ProcessQueueService implements OnModuleDestroy {
  private readonly queue = new Queue<SourceReadyJob>(PROCESS_QUEUE, {
    // Opciones planas a propósito: BullMQ arma su propia conexión con los
    // settings que necesita, en vez de reusar RedisService (maxRetriesPerRequest: 3
    // e ioredis v6, incompatibles con los comandos bloqueantes de BullMQ).
    connection: {
      host: process.env.REDIS_HOST ?? 'redis',
      port: Number(process.env.REDIS_PORT ?? 6379),
    },
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
