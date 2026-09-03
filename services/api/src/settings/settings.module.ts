import { Module, forwardRef } from '@nestjs/common';
import { SettingsResolver } from './settings.resolver';
import { SettingsService } from './settings.service';
import { TmdbClient } from '@/clients/tmdb/client';
import { ProwlarrClient } from '@/clients/indexer/client';
import { QbittorrentClient } from '@/clients/torrent/client';
import { MediaRootsModule } from '@/media-roots/media-roots.module';
import { LanguagesModule } from '@/languages/languages.module';
import { MediaServerIndexModule } from '@/media-server-index/media-server-index.module';
import { SchedulerModule } from '@/scheduler/scheduler.module';

@Module({
  // MediaServerIndexModule — the leaf, never MediaServerModule, which
  // already imports SettingsModule and would make the pair circular.
  // SchedulerModule *is* circular with this one (SchedulerService depends on
  // SettingsService; SettingsResolver depends on SchedulerService to re-arm
  // on a `schedule_*` change, T010) — forwardRef on both sides resolves it.
  imports: [
    MediaRootsModule,
    LanguagesModule,
    MediaServerIndexModule,
    forwardRef(() => SchedulerModule),
  ],
  providers: [
    SettingsResolver,
    SettingsService,
    TmdbClient,
    ProwlarrClient,
    QbittorrentClient,
  ],
  exports: [SettingsService, TmdbClient, ProwlarrClient, QbittorrentClient],
})
export class SettingsModule {}
