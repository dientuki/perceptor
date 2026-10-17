// normalizeGrainMode's degradation is a textbook silent failure: an absent or
// unrecognised value on EncodeJobDetails.grainMode must never throw and must
// never fail an encode — a forgotten query field, or an api that has not
// shipped this feature yet, must produce a grain-free encode and a log line,
// not a crashed job. The literal `INHERIT` gets its own case because it is
// the one unrecognised value a reader would expect this service to resolve
// itself (worker/plan.md's Contract obligations say it must not).
//
// resolveFilmGrain's failures are silent in the same way: a probe that throws
// must become "no grain" with one warning and must not be cached as a verdict,
// a cancellation must propagate rather than become a verdict, and ON/OFF must
// never pay for a gate or probe. Gate and probe are mocked here; their own
// specs prove their arithmetic.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { EncodeCancelledError } from './cancellation';
import { scoreGrainGate } from './grain-gate';
import {
  GRAIN_MODE_VALUES,
  normalizeGrainMode,
  normalizeIsShort,
  resetGrainVerdictCache,
  resolveFilmGrain,
} from './grain-mode';
import { probeGrainSaving } from './grain-probe';
import type { EncodeInput } from './types';

vi.mock('./grain-gate', () => ({ scoreGrainGate: vi.fn() }));
vi.mock('./grain-probe', () => ({
  GRAIN_PROBE_SAVED_MBPS_THRESHOLD: 0.886,
  probeGrainSaving: vi.fn(),
}));

describe('normalizeGrainMode', () => {
  let warnSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  });

  afterEach(() => {
    warnSpy.mockRestore();
  });

  it.each(GRAIN_MODE_VALUES)('returns %s unchanged with no warning', (value) => {
    expect(normalizeGrainMode(value)).toBe(value);
    expect(warnSpy).not.toHaveBeenCalled();
  });

  it('falls back to OFF and warns for undefined', () => {
    expect(normalizeGrainMode(undefined)).toBe('OFF');
    expect(warnSpy).toHaveBeenCalledTimes(1);
  });

  it('falls back to OFF and warns for null', () => {
    expect(normalizeGrainMode(null)).toBe('OFF');
    expect(warnSpy).toHaveBeenCalledTimes(1);
  });

  it('falls back to OFF and warns for the literal INHERIT instead of resolving it', () => {
    expect(normalizeGrainMode('INHERIT')).toBe('OFF');
    expect(warnSpy).toHaveBeenCalledTimes(1);
    expect(warnSpy.mock.calls[0]?.[0]).toContain('INHERIT');
  });

  it('falls back to OFF and warns for an unrecognised string', () => {
    expect(normalizeGrainMode('BOGUS')).toBe('OFF');
    expect(warnSpy).toHaveBeenCalledTimes(1);
  });

  it('never throws for any of the fallback cases', () => {
    expect(() => normalizeGrainMode('INHERIT')).not.toThrow();
    expect(() => normalizeGrainMode(undefined)).not.toThrow();
    expect(() => normalizeGrainMode(null)).not.toThrow();
  });
});

describe('resolveFilmGrain', () => {
  const gateMock = vi.mocked(scoreGrainGate);
  const probeMock = vi.mocked(probeGrainSaving);
  const signal = new AbortController().signal;
  let warnSpy: ReturnType<typeof vi.spyOn>;
  let logSpy: ReturnType<typeof vi.spyOn>;

  function details(overrides: Partial<EncodeInput> = {}): EncodeInput {
    return { grainMode: 'AUTO', isShort: false, mediaSourceId: 1, year: 1998, contentKind: 'LIVE_ACTION', ...overrides } as EncodeInput;
  }

  const passingGate = { score: 3, passed: true, reasons: ['x'] };
  const probeResult = { mbpsGrain0: 11, savingPct: 24, savedMbps: 2.7, passed: true };

  beforeEach(() => {
    resetGrainVerdictCache();
    gateMock.mockReset();
    probeMock.mockReset();
    gateMock.mockReturnValue(passingGate);
    probeMock.mockResolvedValue(probeResult);
    warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    logSpy = vi.spyOn(console, 'log').mockImplementation(() => undefined);
  });

  afterEach(() => {
    warnSpy.mockRestore();
    logSpy.mockRestore();
  });

  it('returns true for ON without calling gate or probe', async () => {
    await expect(resolveFilmGrain(details({ grainMode: 'ON' }), 'a.mkv', {}, signal)).resolves.toBe(true);
    expect(gateMock).not.toHaveBeenCalled();
    expect(probeMock).not.toHaveBeenCalled();
  });

  it('returns false for OFF without calling gate or probe', async () => {
    await expect(resolveFilmGrain(details({ grainMode: 'OFF' }), 'a.mkv', {}, signal)).resolves.toBe(false);
    expect(gateMock).not.toHaveBeenCalled();
    expect(probeMock).not.toHaveBeenCalled();
  });

  it('never calls the probe when the gate refuses', async () => {
    gateMock.mockReturnValue({ score: 0, passed: false, reasons: [] });
    await expect(resolveFilmGrain(details(), 'a.mkv', {}, signal)).resolves.toBe(false);
    expect(probeMock).not.toHaveBeenCalled();
  });

  it('never calls the probe for a short even when the gate passes', async () => {
    await expect(resolveFilmGrain(details({ isShort: true }), 'a.mkv', {}, signal)).resolves.toBe(false);
    expect(gateMock).toHaveBeenCalledTimes(1);
    expect(probeMock).not.toHaveBeenCalled();
  });

  it('returns the probe verdict and logs a probe-start line and one result line', async () => {
    await expect(resolveFilmGrain(details(), 'a.mkv', {}, signal)).resolves.toBe(true);
    expect(probeMock).toHaveBeenCalledTimes(1);
    const lines = logSpy.mock.calls.map((c) => String(c[0]));
    expect(lines.filter((l) => l.includes('probe starting'))).toHaveLength(1);
    expect(lines.filter((l) => l.includes('stage=probe'))).toHaveLength(1);
  });

  it('probes once for two calls with the same mediaSourceId', async () => {
    await resolveFilmGrain(details({ mediaSourceId: 7 }), 'a.mkv', {}, signal);
    await expect(resolveFilmGrain(details({ mediaSourceId: 7 }), 'a.mkv', {}, signal)).resolves.toBe(true);
    expect(probeMock).toHaveBeenCalledTimes(1);
  });

  it('probes again for a different mediaSourceId', async () => {
    await resolveFilmGrain(details({ mediaSourceId: 7 }), 'a.mkv', {}, signal);
    await resolveFilmGrain(details({ mediaSourceId: 8 }), 'a.mkv', {}, signal);
    expect(probeMock).toHaveBeenCalledTimes(2);
  });

  it('returns false with one warning when the probe throws, and does not cache it', async () => {
    probeMock.mockRejectedValueOnce(new Error('boom'));
    await expect(resolveFilmGrain(details(), 'a.mkv', {}, signal)).resolves.toBe(false);
    expect(warnSpy).toHaveBeenCalledTimes(1);
    expect(warnSpy.mock.calls[0]?.[0]).toContain('boom');

    await expect(resolveFilmGrain(details(), 'a.mkv', {}, signal)).resolves.toBe(true);
    expect(probeMock).toHaveBeenCalledTimes(2);
  });

  it('propagates EncodeCancelledError without a warning and does not cache it', async () => {
    probeMock.mockRejectedValueOnce(new EncodeCancelledError());
    await expect(resolveFilmGrain(details(), 'a.mkv', {}, signal)).rejects.toBeInstanceOf(EncodeCancelledError);
    expect(warnSpy).not.toHaveBeenCalled();

    await resolveFilmGrain(details(), 'a.mkv', {}, signal);
    expect(probeMock).toHaveBeenCalledTimes(2);
  });
});

describe('normalizeIsShort', () => {
  let warnSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  });

  afterEach(() => {
    warnSpy.mockRestore();
  });

  it.each([true, false])('returns %s unchanged with no warning', (value) => {
    expect(normalizeIsShort(value)).toBe(value);
    expect(warnSpy).not.toHaveBeenCalled();
  });

  it.each([undefined, null, 'true'])('falls back to false and warns once for %s', (value) => {
    expect(normalizeIsShort(value)).toBe(false);
    expect(warnSpy).toHaveBeenCalledTimes(1);
  });
});
