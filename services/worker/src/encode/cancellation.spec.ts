// Defends the registry a cancelled encode depends on end to end (NFR-1):
// a message for a job not running here must be a silent no-op, never a
// thrown error that could kill the Redis subscriber (src/index.ts); a
// registered job must actually have its signal aborted, exactly once, even
// if the cancel message somehow arrives twice; and releaseEncode must really
// forget the id, so a later message that reuses a processJobId (BullMQ ids
// are not unique forever) can never abort a different job's signal.

import { describe, expect, it } from 'vitest';
import { cancelEncode, registerEncode, releaseEncode } from './cancellation';

describe('cancellation registry', () => {
  it('cancelling an id nobody registered returns false and throws nothing', () => {
    expect(() => {
      expect(cancelEncode(999_999)).toBe(false);
    }).not.toThrow();
  });

  it('cancelling a registered id aborts its signal and returns true', () => {
    const signal = registerEncode(1);

    expect(signal.aborted).toBe(false);
    expect(cancelEncode(1)).toBe(true);
    expect(signal.aborted).toBe(true);

    releaseEncode(1);
  });

  it('a second cancel for the same id is a no-op', () => {
    const signal = registerEncode(2);

    expect(cancelEncode(2)).toBe(true);
    expect(cancelEncode(2)).toBe(true);
    expect(signal.aborted).toBe(true);

    releaseEncode(2);
  });

  it('releaseEncode removes the entry so a reused id cannot abort a different job', () => {
    const firstSignal = registerEncode(3);
    releaseEncode(3);

    const secondSignal = registerEncode(3);

    expect(cancelEncode(3)).toBe(true);
    expect(secondSignal.aborted).toBe(true);
    expect(firstSignal.aborted).toBe(false);

    releaseEncode(3);
  });

  it('registering an id twice keeps the first controller rather than losing it', () => {
    const firstSignal = registerEncode(4);
    const secondSignal = registerEncode(4);

    expect(secondSignal).toBe(firstSignal);

    expect(cancelEncode(4)).toBe(true);
    expect(firstSignal.aborted).toBe(true);

    releaseEncode(4);
  });
});
