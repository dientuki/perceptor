import { Resolver, Query, Mutation, Args } from '@nestjs/graphql';
import { UseGuards } from '@nestjs/common';

import { AdminGuard } from '@/auth/guards/admin.guard';
import { SchedulerService } from './scheduler.service';
import { ScheduledTask } from './entities/scheduled-task.entity';

// Both operations are admin-only (NFR-1). Guards are applied per method,
// following ffprobe-logs.resolver.ts, not a class-level guard — there is no
// other principal calling into this resolver today, but the per-method form
// keeps that decision local to each operation rather than implicit.
@Resolver()
export class SchedulerResolver {
  constructor(private readonly schedulerService: SchedulerService) {}

  @UseGuards(AdminGuard)
  @Query(() => [ScheduledTask], {
    name: 'scheduledTasks',
    description: 'List every registered scheduled task and its current status',
  })
  async scheduledTasks(): Promise<ScheduledTask[]> {
    return this.schedulerService.list();
  }

  @UseGuards(AdminGuard)
  @Mutation(() => ScheduledTask, {
    name: 'runScheduledTask',
    description: 'Trigger a registered scheduled task immediately, regardless of its cadence',
  })
  async runScheduledTask(@Args('id') id: string): Promise<ScheduledTask> {
    // `runTask` already throws SCHEDULE_TASK_NOT_FOUND for an unregistered
    // id and SCHEDULE_TASK_ALREADY_RUNNING for a manual call onto a running
    // task (scheduler.service.ts) — no need to duplicate either check here.
    await this.schedulerService.runTask(id, 'manual');

    const tasks = await this.schedulerService.list();
    // Unreachable in practice: `runTask` above would already have thrown
    // for any id not in the registry, so `id` is guaranteed to be present.
    return tasks.find((task) => task.id === id) as ScheduledTask;
  }
}
