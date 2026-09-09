// Registry mapping a running ProcessJob to the AbortController that can stop
// it, plus the error a cancelled encode rejects with. Deliberately NOT a
// KeyedError (src/i18n/keyed-error.ts): it must never become a user-facing
// translated error, never acquire an i18n key — its only job is to be
// recognised by jobs/encode.job.ts's catch and rethrown before any outcome is
// reported.

export class EncodeCancelledError extends Error {
  constructor(message = 'encode cancelled') {
    super(message);
    this.name = 'EncodeCancelledError';
  }
}

const registry = new Map<number, AbortController>();

// A driver reads this AbortSignal, never the AbortController — encode.job.ts
// is the only caller allowed to abort.
export function registerEncode(processJobId: number): AbortSignal {
  const existing = registry.get(processJobId);
  if (existing) {
    console.log(
      `[cancellation] ${processJobId} ya estaba registrado, se mantiene el controller existente`,
    );
    return existing.signal;
  }

  const controller = new AbortController();
  registry.set(processJobId, controller);
  return controller.signal;
}

// No-op returning false for an id nobody registered — a message for a job
// not running on this worker is expected and correct, not an error (NFR-1).
export function cancelEncode(processJobId: number): boolean {
  const controller = registry.get(processJobId);
  if (!controller) {
    return false;
  }

  controller.abort();
  return true;
}

export function releaseEncode(processJobId: number): void {
  registry.delete(processJobId);
}
