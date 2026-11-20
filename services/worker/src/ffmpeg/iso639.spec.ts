import { describe, expect, it } from 'vitest';
import { iso1ToIso3, normalizeIso3, WHISPER_ISO1_CODES } from './iso639';

describe('iso1ToIso3', () => {
  // Spec 122, REQ-3
  it('maps every whisper code to three lowercase letters already canonical', () => {
    expect(WHISPER_ISO1_CODES).toHaveLength(100);
    for (const code of WHISPER_ISO1_CODES) {
      const iso3 = iso1ToIso3(code);
      expect(iso3, code).toMatch(/^[a-z]{3}$/);
      expect(normalizeIso3(iso3 as string), code).toBe(iso3);
    }
  });

  it('uses the /B form', () => {
    expect(iso1ToIso3('en')).toBe('eng');
    expect(iso1ToIso3('fr')).toBe('fre');
    expect(iso1ToIso3('es')).toBe('spa');
    expect(iso1ToIso3('de')).toBe('ger');
    expect(iso1ToIso3('zh')).toBe('chi');
    expect(iso1ToIso3('nl')).toBe('dut');
    expect(iso1ToIso3('cs')).toBe('cze');
  });

  it('returns undefined for an unknown code', () => {
    expect(iso1ToIso3('xx')).toBeUndefined();
    expect(iso1ToIso3('')).toBeUndefined();
    expect(iso1ToIso3('constructor')).toBeUndefined();
  });
});
