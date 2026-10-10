import { ObjectType, Field, Int } from '@nestjs/graphql';
import { ScheduledTaskOutcome } from './scheduled-task-outcome.enum';

// Spec 035, REQ-6
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
