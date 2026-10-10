import { ObjectType, Field } from '@nestjs/graphql';
import { ScheduledTaskRun } from './scheduled-task-run.entity';

// Spec 035, REQ-7
@ObjectType()
export class ScheduledTask {
  @Field()
  id: string;

  @Field()
  enabled: boolean;

  @Field()
  cron: string;

  @Field()
  running: boolean;

  @Field({ nullable: true })
  nextRunAt?: Date;

  @Field(() => ScheduledTaskRun, { nullable: true })
  lastRun?: ScheduledTaskRun;

  // 045-media-type-availability: false when this task belongs to a media
  // type (`mediaType` on its registry definition) that is currently
  // disabled. Placed last so the generated SDL matches the frozen contract.
  @Field()
  available: boolean;
}
