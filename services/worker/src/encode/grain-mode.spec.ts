// normalizeGrainMode's degradation is a textbook silent failure: an absent or
// unrecognised value on EncodeJobDetails.grainMode must never throw and must
// never fail an encode — a forgotten query field, or an api that has not
// shipped this feature yet, must produce a grain-free encode and a log line,
// not a crashed job. The literal `INHERIT` gets its own case because it is
// the one unrecognised value a reader would expect this service to resolve
// itself (worker/plan.md's Contract obligations say it must not).

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { GRAIN_MODE_VALUES, normalizeGrainMode, resolveFilmGrain } from './grain-mode';

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
  it('returns true for ON', () => {
    expect(resolveFilmGrain('ON', undefined)).toBe(true);
  });

  it('returns false for OFF', () => {
    expect(resolveFilmGrain('OFF', undefined)).toBe(false);
  });

  it('returns false for AUTO, the stub this feature ships', () => {
    expect(resolveFilmGrain('AUTO', undefined)).toBe(false);
  });
});
