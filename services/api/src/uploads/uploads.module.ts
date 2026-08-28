import { Module } from '@nestjs/common';
import { UploadsController } from './uploads.controller';
import { UploadsService } from './uploads.service';
import { UploadsResolver } from './uploads.resolver';
import { UploadTicketsService } from './upload-tickets.service';
import { SettingsModule } from '@/settings/settings.module';
import { MediaRootsModule } from '@/media-roots/media-roots.module';
import { QueueModule } from '@/queue/queue.module';
import { AuthModule } from '../auth/auth.module';
import { RedisModule } from '../redis/redis.module';
import { MoviesModule } from '@/movies/movies.module';
import { EpisodesModule } from '@/episodes/episodes.module';
import { DownloadsModule } from '@/downloads/downloads.module';

@Module({
  imports: [
    SettingsModule,
    MediaRootsModule,
    QueueModule,
    AuthModule,
    RedisModule,
    MoviesModule,
    EpisodesModule,
    // DownloadsService.resolveRace — the shared race arbiter REQ-19 wires
    // the tus upload path into, so an upload competes in the same race as
    // torrents rather than reimplementing the guard/pause locally.
    DownloadsModule,
  ],
  controllers: [UploadsController],
  providers: [UploadsService, UploadsResolver, UploadTicketsService],
})
export class UploadsModule {}
