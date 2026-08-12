import { Module } from '@nestjs/common';
import { MediaResolver } from './media.resolver';
import { MediaDispatchService } from './media-dispatch.service';
import { MoviesModule } from '@/movies/movies.module';
import { ShowsModule } from '@/shows/shows.module';

@Module({
  imports: [MoviesModule, ShowsModule],
  providers: [MediaResolver, MediaDispatchService],
})
export class MediaModule {}
