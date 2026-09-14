import { Resolver, Query } from '@nestjs/graphql';
import { UseGuards } from '@nestjs/common';
import { EnvironmentService } from './environment.service';
import { EnvironmentInfo } from './entities/environment-info.entity';
import { AdminGuard } from '@/auth/guards/admin.guard';

// @UseGuards(AdminGuard) per method, not at class level — the
// ffprobe-logs.resolver.ts split (055-environment-panel api/plan.md § Files).
// There is only one method here, so the distinction looks academic; it stays
// consistent with the house convention rather than reintroducing the
// class-level habit `settings.resolver.ts` already warns against.
@Resolver()
export class EnvironmentResolver {
  constructor(private readonly environmentService: EnvironmentService) {}

  @UseGuards(AdminGuard)
  @Query(() => EnvironmentInfo, {
    name: 'environmentInfo',
    description:
      'How this installation is reachable as this container has it loaded: routing mode, domain, the four published-service ports/URLs, and the upload endpoint this container expects — never process.env wholesale, never a fabricated host.',
  })
  environmentInfo(): EnvironmentInfo {
    return this.environmentService.getInfo();
  }
}
