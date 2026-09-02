// 038-encode-report-durability (REQ-2..REQ-4, NFR-1, NFR-2): a finished
// job's outcome (encodeCompleted/encodeFailed) must be delivered eventually,
// however long api is unreachable, without spinning at full speed for the
// whole outage. Only ApiUnreachableError (graphql-client.ts) is retried —
// that is the one failure mode meaning "no response arrived", as opposed to
// a rejection api actually answered (REQ-3), which must propagate on the
// first attempt.
//
// The encode Worker runs at concurrency: 1 (src/index.ts), so an awaited
// retry here blocks the next job from starting — that blocking is REQ-4,
// not a bug to route around.

import { ApiUnreachableError } from './graphql-client';

// Module constants so a test can drive the schedule fast (fake timers)
// instead of waiting out a real minute-long outage.
export const INITIAL_DELAY_MS = 5_000;
export const MAX_DELAY_MS = 60_000;

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function deliverReport<T>(
  label: string,
  send: () => Promise<T>,
): Promise<T> {
  let delay = INITIAL_DELAY_MS;

  for (;;) {
    try {
      return await send();
    } catch (err) {
      if (!(err instanceof ApiUnreachableError)) {
        throw err;
      }

      console.error(
        `[deliver-report] ${label}: api unreachable, retrying in ${delay}ms — ${err.message}`,
      );
      await wait(delay);
      delay = Math.min(delay * 2, MAX_DELAY_MS);
    }
  }
}
