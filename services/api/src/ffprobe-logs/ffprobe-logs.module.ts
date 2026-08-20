import { Module } from '@nestjs/common';
import { FfprobeLogsResolver } from './ffprobe-logs.resolver';
import { FfprobeLogsService } from './ffprobe-logs.service';

@Module({
  providers: [FfprobeLogsResolver, FfprobeLogsService],
})
export class FfprobeLogsModule {}
