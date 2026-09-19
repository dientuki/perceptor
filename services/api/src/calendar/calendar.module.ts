import { Module } from '@nestjs/common';
import { CalendarResolver } from './calendar.resolver';
import { CalendarService } from './calendar.service';
import { MoviesModule } from '@/movies/movies.module';
import { ShowsModule } from '@/shows/shows.module';
import { MediaCapabilitiesModule } from '@/media/media-capabilities.module';

@Module({
  imports: [MoviesModule, ShowsModule, MediaCapabilitiesModule],
  providers: [CalendarResolver, CalendarService],
})
export class CalendarModule {}
