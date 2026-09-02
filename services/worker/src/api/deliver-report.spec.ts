// Defends REQ-2/REQ-3/NFR-2 of 038-encode-report-durability at the retry
// primitive itself: deliverReport must retry an ApiUnreachableError forever
// (never give up on a long outage), must rethrow anything else on the first
// attempt without retrying (a rejection api actually answered is terminal),
// and must actually wait between attempts rather than spinning at full
// speed. Fake timers drive the backoff so the suite doesn't sleep for real.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { deliverReport, INITIAL_DELAY_MS, MAX_DELAY_MS } from './deliver-report';
import { ApiUnreachableError } from './graphql-client';

describe('deliverReport', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('retries while ApiUnreachableError is thrown and returns the eventual value', async () => {
    const send = vi
      .fn()
      .mockRejectedValueOnce(new ApiUnreachableError(new Error('ECONNREFUSED')))
      .mockRejectedValueOnce(new ApiUnreachableError(new Error('ECONNREFUSED')))
      .mockResolvedValueOnce('ok');

    const promise = deliverReport('test', send);

    // First attempt fails immediately; let its rejection settle before
    // advancing timers, otherwise the retry's setTimeout hasn't been
    // scheduled yet.
    await vi.advanceTimersByTimeAsync(INITIAL_DELAY_MS);
    await vi.advanceTimersByTimeAsync(INITIAL_DELAY_MS * 2);

    await expect(promise).resolves.toBe('ok');
    expect(send).toHaveBeenCalledTimes(3);
  });

  it('rethrows any other error on the first attempt without retrying', async () => {
    const otherError = new Error('processJob 999 does not exist');
    const send = vi.fn().mockRejectedValue(otherError);

    await expect(deliverReport('test', send)).rejects.toBe(otherError);
    expect(send).toHaveBeenCalledTimes(1);
  });

  it('waits between attempts rather than spinning', async () => {
    const send = vi
      .fn()
      .mockRejectedValueOnce(new ApiUnreachableError(new Error('ECONNREFUSED')))
      .mockResolvedValueOnce('ok');

    const promise = deliverReport('test', send);

    // Immediately after the first rejection, no retry has happened yet —
    // proving the wrapper actually waits instead of looping synchronously.
    await Promise.resolve();
    await Promise.resolve();
    expect(send).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(INITIAL_DELAY_MS - 1);
    expect(send).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(1);
    await expect(promise).resolves.toBe('ok');
    expect(send).toHaveBeenCalledTimes(2);
  });

  it('caps the backoff rather than growing unbounded across a long outage', async () => {
    const attempts = 8;
    const send = vi.fn();
    for (let i = 0; i < attempts; i++) {
      send.mockRejectedValueOnce(new ApiUnreachableError(new Error('ECONNREFUSED')));
    }
    send.mockResolvedValueOnce('ok');

    const promise = deliverReport('test', send);

    // Doubling from INITIAL_DELAY_MS would exceed MAX_DELAY_MS well before
    // 8 attempts if uncapped; advancing by MAX_DELAY_MS each time is enough
    // once the cap kicks in, proving the schedule doesn't keep growing.
    for (let i = 0; i < attempts; i++) {
      await vi.advanceTimersByTimeAsync(MAX_DELAY_MS);
    }

    await expect(promise).resolves.toBe('ok');
    expect(send).toHaveBeenCalledTimes(attempts + 1);
  });
});
