import { registerEnumType } from '@nestjs/graphql';

export enum ScheduledTaskOutcome {
  SUCCESS = 'SUCCESS',
  FAILED = 'FAILED',
  SKIPPED = 'SKIPPED',
}

registerEnumType(ScheduledTaskOutcome, { name: 'ScheduledTaskOutcome' });
