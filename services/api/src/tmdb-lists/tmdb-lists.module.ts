import { Module } from '@nestjs/common';

import { PrismaModule } from '@/prisma/prisma.module';
import { SettingsModule } from '@/settings/settings.module';
import { MediaModule } from '@/media/media.module';
import { MediaCapabilitiesModule } from '@/media/media-capabilities.module';

import { TmdbListsResolver } from './tmdb-lists.resolver';
import { TmdbListsService } from './tmdb-lists.service';

@Module({
  imports: [PrismaModule, SettingsModule, MediaModule, MediaCapabilitiesModule],
  providers: [TmdbListsService, TmdbListsResolver],
  exports: [TmdbListsService],
})
export class TmdbListsModule {}
