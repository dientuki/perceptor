// Hand-copied shape of api's ScheduledTask/ScheduledTaskRun types
// (docs/spec/features/035-scheduled-tasks/spec.md — GraphQL Contract Delta).
// No codegen across this boundary — a field renamed on api renders
// `undefined` here with no compile error.

export type ScheduledTaskOutcome = "SUCCESS" | "FAILED" | "SKIPPED";

// Timestamps arrive as ISO strings over the wire (GraphQL DateTime), never
// as Date instances — do not "helpfully" type these as Date.
export type ScheduledTaskRun = {
  id: number;
  startedAt: string;
  finishedAt: string | null;
  outcome: ScheduledTaskOutcome;
  itemsProcessed: number;
  error: string | null;
};

export type ScheduledTask = {
  id: string;
  enabled: boolean;
  cron: string;
  running: boolean;
  nextRunAt: string | null;
  lastRun: ScheduledTaskRun | null;
  available: boolean;
};
