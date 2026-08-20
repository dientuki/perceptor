import { Resolver, Query, Mutation, Args, Int } from '@nestjs/graphql';
import { UseGuards } from '@nestjs/common';
import { FfprobeLogsService } from './ffprobe-logs.service';
import { FfprobeLog } from './entities/ffprobe-log.entity';
import { AllowService } from '@/auth/decorators/allow-service.decorator';
import { AdminGuard } from '@/auth/guards/admin.guard';

// Guards are applied per method, never at class level: `recordFfprobe` is
// the worker's write path (SERVICE_TOKEN, @AllowService()), the other three
// are admin-only reads/deletes (@UseGuards(AdminGuard)). AdminGuard rejects
// any principal whose type isn't 'user', so putting it at class level would
// also reject the worker's recordFfprobe call — and the worker swallows that
// error by design (NFR-1), leaving the table silently empty forever.
@Resolver()
export class FfprobeLogsResolver {
  constructor(private readonly ffprobeLogsService: FfprobeLogsService) {}

  @AllowService()
  @Mutation(() => FfprobeLog, {
    name: 'recordFfprobe',
    description: 'The worker reports one raw ffprobe payload before an encode starts',
  })
  async recordFfprobe(
    @Args('file') file: string,
    @Args('ffprobe') ffprobe: string,
  ): Promise<FfprobeLog> {
    return this.ffprobeLogsService.record(file, ffprobe);
  }

  @UseGuards(AdminGuard)
  @Query(() => [FfprobeLog], {
    name: 'ffprobeLogs',
    description: 'List recorded ffprobe payloads, newest first',
  })
  async ffprobeLogs(
    @Args('file', { type: () => String, nullable: true }) file: string | undefined,
    @Args('take', { type: () => Int, defaultValue: 50 }) take: number,
    @Args('skip', { type: () => Int, defaultValue: 0 }) skip: number,
  ): Promise<FfprobeLog[]> {
    return this.ffprobeLogsService.findAll(file, take, skip);
  }

  @UseGuards(AdminGuard)
  @Query(() => FfprobeLog, {
    name: 'ffprobeLog',
    description: 'Fetch one recorded ffprobe payload by id',
  })
  async ffprobeLog(@Args('id', { type: () => Int }) id: number): Promise<FfprobeLog> {
    return this.ffprobeLogsService.findOne(id);
  }

  @UseGuards(AdminGuard)
  @Mutation(() => Boolean, {
    name: 'deleteFfprobeLog',
    description: 'Delete one recorded ffprobe payload by id',
  })
  async deleteFfprobeLog(@Args('id', { type: () => Int }) id: number): Promise<boolean> {
    return this.ffprobeLogsService.remove(id);
  }
}
