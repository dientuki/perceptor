"use server";

import {
  redirectIfUnauthenticated,
  redirectToClearSession,
} from "@/lib/auth-session";
import { fetchGraphQL } from "@/lib/graphql-client";
import { toActionError, translateGraphQLError } from "@/lib/graphql-error";
import type { ScheduledTask } from "@/types/scheduler";

const SCHEDULED_TASKS_QUERY = `
  query ScheduledTasks {
    scheduledTasks {
      id
      enabled
      cron
      running
      nextRunAt
      lastRun {
        id
        startedAt
        finishedAt
        outcome
        itemsProcessed
        error
      }
    }
  }
`;

export async function getScheduledTasks(): Promise<ScheduledTask[]> {
  const { data, errors } = await fetchGraphQL<{
    scheduledTasks: ScheduledTask[];
  }>(SCHEDULED_TASKS_QUERY);

  if (errors && errors.length > 0) {
    // Called directly from SettingsPage's Server Component render — cookie
    // mutation is illegal there, so hand off to the Route Handler instead of
    // redirectIfUnauthenticated (used below, in the click-triggered action,
    // where it's legal).
    redirectToClearSession(errors);
    throw new Error(await translateGraphQLError(errors[0]));
  }

  return data?.scheduledTasks ?? [];
}

const RUN_SCHEDULED_TASK_MUTATION = `
  mutation RunScheduledTask($id: String!) {
    runScheduledTask(id: $id) {
      id
      enabled
      cron
      running
      nextRunAt
      lastRun {
        id
        startedAt
        finishedAt
        outcome
        itemsProcessed
        error
      }
    }
  }
`;

export type RunScheduledTaskActionResult =
  | { task: ScheduledTask }
  | { error: string; errorKey?: string };

// Called from the per-task "Ejecutar ahora" button via useTransition — not a
// useActionState form action (it takes a plain id, not FormData, and isn't
// wired to a <form>), same shape as resyncMediaServerIndexAction.
export async function runScheduledTaskAction(
  id: string,
): Promise<RunScheduledTaskActionResult> {
  const { data, errors } = await fetchGraphQL<{
    runScheduledTask: ScheduledTask;
  }>(RUN_SCHEDULED_TASK_MUTATION, { id });

  if (errors && errors.length > 0) {
    await redirectIfUnauthenticated(errors);
    return await toActionError(errors[0]);
  }

  return { task: data!.runScheduledTask };
}
