import { Module } from '@nestjs/common';
import { DownloadsResolver } from './downloads.resolver';

@Module({
  providers: [DownloadsResolver],
})
export class DownloadsModule {}
