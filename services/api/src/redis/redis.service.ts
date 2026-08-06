import { Injectable, OnModuleDestroy } from '@nestjs/common';
import Redis from 'ioredis';

@Injectable()
export class RedisService extends Redis implements OnModuleDestroy {
  constructor() {
    super({
      host: process.env.REDIS_HOST ?? 'redis',
      port: Number(process.env.REDIS_PORT ?? 6379),
      maxRetriesPerRequest: 3,
      lazyConnect: false,
    });
  }

  async onModuleDestroy() {
    await this.quit();
  }
}
