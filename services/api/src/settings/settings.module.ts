import { Module } from '@nestjs/common';
import { SettingsResolver } from './settings.resolver';
import { SettingsService } from './settings.service';
import { TmdbClient } from '@/clients/tmdb/client';
import { ProwlarrClient } from '@/clients/indexer/client';
import { QbittorrentClient } from '@/clients/torrent/client';

@Module({
  providers: [SettingsResolver, SettingsService, TmdbClient, ProwlarrClient, QbittorrentClient],
  exports: [SettingsService, TmdbClient, ProwlarrClient, QbittorrentClient],
})
export class SettingsModule {}
