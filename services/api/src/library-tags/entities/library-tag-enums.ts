import { registerEnumType } from '@nestjs/graphql';

// Spec 123, REQ-18
export enum LibraryTagMigrationStatus {
  RUNNING = 'RUNNING',
  COMPLETED = 'COMPLETED',
}

// Spec 123, REQ-18
export enum LibraryTagOutcome {
  MIGRATED = 'MIGRATED',
  UNCHANGED = 'UNCHANGED',
  BUSY = 'BUSY',
  MISSING = 'MISSING',
  FAILED = 'FAILED',
}

registerEnumType(LibraryTagMigrationStatus, {
  name: 'LibraryTagMigrationStatus',
});
registerEnumType(LibraryTagOutcome, { name: 'LibraryTagOutcome' });
