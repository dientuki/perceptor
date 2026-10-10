import { Module } from '@nestjs/common';
import { PrismaModule } from '@/prisma/prisma.module';
import { TitleStatusService } from './title-status.service';
import { ShowStatusSweepService } from './show-status-sweep.service';

// Spec 089, REQ-1 REQ-12
@Module({
  imports: [PrismaModule],
  providers: [TitleStatusService, ShowStatusSweepService],
  exports: [TitleStatusService],
})
export class TitleStatusModule {}
