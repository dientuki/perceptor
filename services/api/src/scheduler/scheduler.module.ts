import { Module, forwardRef } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';

import { PrismaModule } from '@/prisma/prisma.module';
import { SettingsModule } from '@/settings/settings.module';
import { SchedulerResolver } from './scheduler.resolver';
import { SchedulerService } from './scheduler.service';
import { RefreshMoviesTask } from './tasks/refresh-movies.task';
import { RefreshShowsTask } from './tasks/refresh-shows.task';
import { RefreshEpisodesTask } from './tasks/refresh-episodes.task';
import { AcquirePendingTask } from './tasks/acquire-pending.task';

@Module({
  // forwardRef both ways: SettingsResolver injects SchedulerService (T010) to
  // re-arm on a `schedule_*` settings change, and SchedulerService already
  // depends on SettingsService — a plain two-way import would be circular.
  imports: [
    ScheduleModule.forRoot(),
    PrismaModule,
    forwardRef(() => SettingsModule),
  ],
  providers: [
    SchedulerResolver,
    SchedulerService,
    RefreshMoviesTask,
    RefreshShowsTask,
    RefreshEpisodesTask,
    AcquirePendingTask,
  ],
  exports: [SchedulerService],
})
export class SchedulerModule {}
