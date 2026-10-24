import { registerEnumType } from '@nestjs/graphql';

// Spec 101, REQ-17
export enum SubtitleEmbedStatus {
  QUEUED = 'QUEUED',
  RUNNING = 'RUNNING',
  COMPLETED = 'COMPLETED',
  FAILED = 'FAILED',
}

registerEnumType(SubtitleEmbedStatus, { name: 'SubtitleEmbedStatus' });
