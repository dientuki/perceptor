import { Module } from '@nestjs/common';
import { MoviesResolver } from './movies.resolver';
import { MoviesService } from './movies.service';
import { RedisModule } from '@/redis/redis.module';
import { SettingsModule } from '@/settings/settings.module';

@Module({
  imports: [RedisModule, SettingsModule],
  providers: [MoviesResolver, MoviesService],
})
export class MoviesModule {}
