import { Module } from '@nestjs/common';
import { IndexerResolver } from './indexer.resolver';
import { IndexerService } from './indexer.service';
import { SettingsModule } from '@/settings/settings.module';
import { RedisModule } from '@/redis/redis.module';

@Module({
  imports: [SettingsModule, RedisModule],
  providers: [IndexerResolver, IndexerService],
  exports: [IndexerService],
})
export class IndexerModule {}
