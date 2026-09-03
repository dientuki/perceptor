import { ObjectType, Field, Int } from '@nestjs/graphql';
import { ScheduledTaskOutcome } from './scheduled-task-outcome.enum';

// One occurrence of a scheduled task — scheduled or manually triggered
// (035-scheduled-tasks REQ-6). `finishedAt`/`error` stay null while the run
// is still in flight; `error` is only ever set alongside `outcome: FAILED`.
@ObjectType()
export class ScheduledTaskRun {
  @Field(() => Int)
  id: number;

  @Field()
  startedAt: Date;

  @Field({ nullable: true })
  finishedAt?: Date;

  @Field(() => ScheduledTaskOutcome)
  outcome: ScheduledTaskOutcome;

  @Field(() => Int)
  itemsProcessed: number;

  @Field({ nullable: true })
  error?: string;
}
