import { Module } from '@nestjs/common';
import { MediaServerIndexService } from './media-server-index.service';
import { RedisModule } from '@/redis/redis.module';

// Deliberately a leaf module: PrismaService comes from the global
// PrismaModule, and this imports RedisModule and nothing else. In
// particular, never SettingsModule/SettingsService — SettingsResolver needs
// to trigger a rebuild (034 REQ-2) and MediaServerModule already imports
// SettingsModule, so an index living inside media-server/ or depending on
// SettingsModule would make that pair circular. rebuild() receives the
// resolved config as a plain object instead of reading it itself, and
// readState() reads the three Setting rows through PrismaService directly.
@Module({
  imports: [RedisModule],
  providers: [MediaServerIndexService],
  exports: [MediaServerIndexService],
})
export class MediaServerIndexModule {}
