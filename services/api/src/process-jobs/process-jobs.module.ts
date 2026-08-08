import { Module } from '@nestjs/common';
import { ProcessJobsResolver } from './process-jobs.resolver';
import { ProcessJobsService } from './process-jobs.service';
import { SettingsModule } from '@/settings/settings.module';

// SettingsModule exporta QbittorrentClient (lo necesita downloadRemove), igual
// que ya lo consume MoviesModule.
@Module({
  imports: [SettingsModule],
  providers: [ProcessJobsResolver, ProcessJobsService],
})
export class ProcessJobsModule {}
