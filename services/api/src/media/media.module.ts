import { Module } from '@nestjs/common';
import { MediaResolver } from './media.resolver';
import { MediaDispatchService } from './media-dispatch.service';
import { MediaSearchService } from './media-search.service';
import { MoviesModule } from '@/movies/movies.module';
import { ShowsModule } from '@/shows/shows.module';
import { SettingsModule } from '@/settings/settings.module';

@Module({
  imports: [MoviesModule, ShowsModule, SettingsModule],
  providers: [MediaResolver, MediaDispatchService, MediaSearchService],
})
export class MediaModule {}
