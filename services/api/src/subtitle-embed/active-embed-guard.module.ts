import { Module } from '@nestjs/common';
import { ActiveEmbedGuard } from './active-embed.guard';

// Spec 101, REQ-16
@Module({
  providers: [ActiveEmbedGuard],
  exports: [ActiveEmbedGuard],
})
export class ActiveEmbedGuardModule {}
