import { Module } from '@nestjs/common';
import { MediaResolver } from './media.resolver';
import { MediaDispatchService } from './media-dispatch.service';
import { MediaSearchService } from './media-search.service';
import { PopularMediaService } from './popular-media.service';
import { MoviesModule } from '@/movies/movies.module';
import { ShowsModule } from '@/shows/shows.module';
import { SettingsModule } from '@/settings/settings.module';
import { RedisModule } from '@/redis/redis.module';

@Module({
  imports: [MoviesModule, ShowsModule, SettingsModule, RedisModule],
  providers: [MediaResolver, MediaDispatchService, MediaSearchService, PopularMediaService],
})
export class MediaModule {}
