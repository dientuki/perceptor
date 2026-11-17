import { Module } from '@nestjs/common';
import { PrismaModule } from '@/prisma/prisma.module';
import { ShowTrackLanguagesService } from './show-track-languages.service';

// Spec 117, REQ-7
@Module({
  imports: [PrismaModule],
  providers: [ShowTrackLanguagesService],
  exports: [ShowTrackLanguagesService],
})
export class ShowTrackLanguagesModule {}
