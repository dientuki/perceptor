// Spec 038, REQ-2 REQ-3 REQ-4 NFR-1 NFR-2

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
