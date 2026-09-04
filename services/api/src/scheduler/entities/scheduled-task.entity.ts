import { ObjectType, Field } from '@nestjs/graphql';
import { ScheduledTaskRun } from './scheduled-task-run.entity';

// One registered task's status projection (035-scheduled-tasks REQ-7):
// whether it is enabled, its cadence, whether it is currently RUNNING, when
// it next fires and, if it has run at least once, its last occurrence.
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
