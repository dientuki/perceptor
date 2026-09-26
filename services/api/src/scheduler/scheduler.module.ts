import { Module } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';

import { PrismaModule } from '@/prisma/prisma.module';
import { SettingsModule } from '@/settings/settings.module';
import { IndexerModule } from '@/indexer/indexer.module';
import { EpisodesModule } from '@/episodes/episodes.module';
import { ShowsModule } from '@/shows/shows.module';
import { MoviesModule } from '@/movies/movies.module';
import { SchedulerResolver } from './scheduler.resolver';
import { SchedulerService } from './scheduler.service';
import { RefreshMoviesTask } from './tasks/refresh-movies.task';
import { RefreshShowsTask } from './tasks/refresh-shows.task';
import { RefreshEpisodesTask } from './tasks/refresh-episodes.task';
import { AcquireEpisodesTask } from './tasks/acquire-episodes.task';
import { AcquirePendingTask } from './tasks/acquire-pending.task';

@Module({
  imports: [
    ScheduleModule.forRoot(),
    PrismaModule,
    SettingsModule,
    IndexerModule,
    EpisodesModule,
    ShowsModule,
    MoviesModule,
  ],
  providers: [
    SchedulerResolver,
    SchedulerService,
    RefreshMoviesTask,
    RefreshShowsTask,
    RefreshEpisodesTask,
    AcquirePendingTask,
    AcquireEpisodesTask,
  ],
  exports: [SchedulerService],
})
export class SchedulerModule {}
