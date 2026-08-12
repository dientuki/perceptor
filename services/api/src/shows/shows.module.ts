import { Module } from '@nestjs/common';
import { ShowsResolver } from './shows.resolver';
import { ShowsService } from './shows.service';
import { RedisModule } from '@/redis/redis.module';
import { SettingsModule } from '@/settings/settings.module';

@Module({
  imports: [RedisModule, SettingsModule],
  providers: [ShowsResolver, ShowsService],
  exports: [ShowsService],
})
export class ShowsModule {}
