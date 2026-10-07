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
import { TitleStatusModule } from '@/title-status/title-status.module';
import { SessionService } from './session.service';

@Module({
  imports: [
    SettingsModule,
    MediaRootsModule,
    QueueModule,
    AuthModule,
    RedisModule,
    MoviesModule,
    EpisodesModule,
    // Spec 022, REQ-19
    DownloadsModule,
    // Spec 089, REQ-13
    TitleStatusModule,
  ],
  controllers: [UploadsController],
  providers: [UploadsService, UploadsResolver, UploadTicketsService, SessionService],
  exports: [SessionService, UploadsService],
})
export class UploadsModule {}
