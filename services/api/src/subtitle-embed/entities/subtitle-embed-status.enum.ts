import { registerEnumType } from '@nestjs/graphql';

// Spec 101, REQ-17
export enum SubtitleEmbedStatus {
  SYNCING = 'SYNCING',
  QUEUED = 'QUEUED',
  RUNNING = 'RUNNING',
  COMPLETED = 'COMPLETED',
  FAILED = 'FAILED',
}

registerEnumType(SubtitleEmbedStatus, { name: 'SubtitleEmbedStatus' });
