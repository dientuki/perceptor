import { Module } from '@nestjs/common';
import { SettingsResolver } from './settings.resolver';
import { SettingsService } from './settings.service';
import { TmdbClient } from '@/clients/tmdb/client';
import { ProwlarrClient } from '@/clients/indexer/client';
import { QbittorrentClient } from '@/clients/torrent/client';
import { MediaRootsModule } from '@/media-roots/media-roots.module';
import { LanguagesModule } from '@/languages/languages.module';
import { MediaServerIndexModule } from '@/media-server-index/media-server-index.module';

@Module({
  // MediaServerIndexModule — the leaf, never MediaServerModule, which
  // already imports SettingsModule and would make the pair circular.
  imports: [MediaRootsModule, LanguagesModule, MediaServerIndexModule],
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
