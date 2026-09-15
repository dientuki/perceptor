// normalizeContentKind is the whole degradation path for an untrusted payload
// field (worker/plan.md's Contract obligations): a fallback that threw would
// fail every encode against an older api that still sends isLiveAction or
// nothing at all; a fallback that silently picked ANIME would mistune every
// live-action film with nothing failing anywhere. Every unrecognised input
// must degrade to LIVE_ACTION and log, never throw.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { CONTENT_KIND_VALUES, normalizeContentKind } from './content-kind';

describe('normalizeContentKind', () => {
  let warnSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  });

  afterEach(() => {
    warnSpy.mockRestore();
  });

  it.each(CONTENT_KIND_VALUES)('returns %s unchanged with no warning', (value) => {
    expect(normalizeContentKind(value)).toBe(value);
    expect(warnSpy).not.toHaveBeenCalled();
  });

  it('falls back to LIVE_ACTION and warns for an unrecognised string', () => {
    expect(normalizeContentKind('BOGUS')).toBe('LIVE_ACTION');
    expect(warnSpy).toHaveBeenCalledTimes(1);
    expect(warnSpy.mock.calls[0]?.[0]).toContain('BOGUS');
  });

  it('falls back to LIVE_ACTION and warns for undefined', () => {
    expect(normalizeContentKind(undefined)).toBe('LIVE_ACTION');
    expect(warnSpy).toHaveBeenCalledTimes(1);
  });

  it('falls back to LIVE_ACTION and warns for null', () => {
    expect(normalizeContentKind(null)).toBe('LIVE_ACTION');
    expect(warnSpy).toHaveBeenCalledTimes(1);
  });

  it('never throws for any of the fallback cases', () => {
    expect(() => normalizeContentKind('BOGUS')).not.toThrow();
    expect(() => normalizeContentKind(undefined)).not.toThrow();
    expect(() => normalizeContentKind(null)).not.toThrow();
  });
});
