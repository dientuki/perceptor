import { Module } from '@nestjs/common';
import { MoviesResolver } from './movies.resolver';
import { MoviesService } from './movies.service';
import { RedisModule } from '@/redis/redis.module';
import { SettingsModule } from '@/settings/settings.module';
import { LanguagesModule } from '@/languages/languages.module';
import { MediaServerModule } from '@/media-server/media-server.module';

@Module({
  imports: [RedisModule, SettingsModule, LanguagesModule, MediaServerModule],
  providers: [MoviesResolver, MoviesService],
  exports: [MoviesService],
})
export class MoviesModule {}
