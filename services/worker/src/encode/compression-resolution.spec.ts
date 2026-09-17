// normalizeCompressionResolution is the whole degradation path for an
// untrusted payload field (worker/plan.md's Contract obligations): a fallback
// that threw would fail every encode against an older api that still sends
// nothing at all; a fallback that silently picked no box would let
// src/ffmpeg/ apply no ceiling with nothing failing anywhere. Every
// unrecognised input must degrade to 1080p and log, never throw.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { COMPRESSION_RESOLUTION_VALUES, normalizeCompressionResolution } from './compression-resolution';

describe('normalizeCompressionResolution', () => {
  let warnSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  });

  afterEach(() => {
    warnSpy.mockRestore();
  });

  it.each(COMPRESSION_RESOLUTION_VALUES)('returns %s unchanged with no warning', (value) => {
    expect(normalizeCompressionResolution(value)).toBe(value);
    expect(warnSpy).not.toHaveBeenCalled();
  });

  it('falls back to 1080p and warns for undefined', () => {
    expect(normalizeCompressionResolution(undefined)).toBe('1080p');
    expect(warnSpy).toHaveBeenCalledTimes(1);
  });

  it('falls back to 1080p and warns for null', () => {
    expect(normalizeCompressionResolution(null)).toBe('1080p');
    expect(warnSpy).toHaveBeenCalledTimes(1);
  });

  it('falls back to 1080p and warns for an empty string', () => {
    expect(normalizeCompressionResolution('')).toBe('1080p');
    expect(warnSpy).toHaveBeenCalledTimes(1);
  });

  it('falls back to 1080p and warns for a wrong-case value', () => {
    expect(normalizeCompressionResolution('4K')).toBe('1080p');
    expect(warnSpy).toHaveBeenCalledTimes(1);
    expect(warnSpy.mock.calls[0]?.[0]).toContain('4K');
  });

  it('falls back to 1080p and warns for an unrecognised string', () => {
    expect(normalizeCompressionResolution('garbage')).toBe('1080p');
    expect(warnSpy).toHaveBeenCalledTimes(1);
    expect(warnSpy.mock.calls[0]?.[0]).toContain('garbage');
  });

  it('never throws for any of the fallback cases', () => {
    expect(() => normalizeCompressionResolution(undefined)).not.toThrow();
    expect(() => normalizeCompressionResolution(null)).not.toThrow();
    expect(() => normalizeCompressionResolution('')).not.toThrow();
    expect(() => normalizeCompressionResolution('4K')).not.toThrow();
    expect(() => normalizeCompressionResolution('garbage')).not.toThrow();
  });
});
