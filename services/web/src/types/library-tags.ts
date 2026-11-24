export type LibraryTagMigrationStatus = "RUNNING" | "COMPLETED";

export interface LibraryTagMigrationFailure {
  path: string;
  reasonKey: string;
}

export interface LibraryTagMigration {
  id: number;
  status: LibraryTagMigrationStatus;
  total: number;
  processed: number;
  migrated: number;
  unchanged: number;
  busy: number;
  missing: number;
  failed: number;
  failures: LibraryTagMigrationFailure[];
  startedAt: string;
  finishedAt: string | null;
}
