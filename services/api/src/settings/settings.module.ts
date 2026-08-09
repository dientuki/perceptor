import { Module } from '@nestjs/common';
import { SettingsResolver } from './settings.resolver';
import { SettingsService } from './settings.service';
import { TmdbClient } from '@/clients/tmdb/client';
import { ProwlarrClient } from '@/clients/indexer/client';
import { QbittorrentClient } from '@/clients/torrent/client';
import { MediaRootsModule } from '@/media-roots/media-roots.module';

@Module({
  imports: [MediaRootsModule],
  providers: [SettingsResolver, SettingsService, TmdbClient, ProwlarrClient, QbittorrentClient],
  exports: [SettingsService, TmdbClient, ProwlarrClient, QbittorrentClient],
})
export class SettingsModule {}
