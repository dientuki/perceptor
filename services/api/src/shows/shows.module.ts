import { Module } from '@nestjs/common';
import { ShowsResolver } from './shows.resolver';
import { ShowsService } from './shows.service';
import { RedisModule } from '@/redis/redis.module';
import { SettingsModule } from '@/settings/settings.module';
import { LanguagesModule } from '@/languages/languages.module';
import { MediaServerModule } from '@/media-server/media-server.module';

@Module({
  imports: [RedisModule, SettingsModule, LanguagesModule, MediaServerModule],
  providers: [ShowsResolver, ShowsService],
  exports: [ShowsService],
})
export class ShowsModule {}
