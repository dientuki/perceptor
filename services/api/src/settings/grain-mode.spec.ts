import { resolveEffectiveGrainMode } from './grain-mode';

// This suite exists because otherwise the two-level precedence silently
// produces the wrong -svtav1-params with no error anywhere: a title on OFF
// that still reads the setting, an INHERIT that defaults to AUTO instead of
// OFF, or the `!== 'false'` operator slipping in for the feature's
// off-by-default rule's `=== 'true'`, all produce a perfectly successful
// encode with the wrong grain parameters.
// Each case is verified to fail when the rule it covers is removed.
describe('resolveEffectiveGrainMode', () => {
  it('resolves ON outright, regardless of the installation setting', () => {
    expect(resolveEffectiveGrainMode('ON', {})).toBe('ON');
    expect(resolveEffectiveGrainMode('ON', { grain_auto_enabled: 'true' })).toBe('ON');
    expect(resolveEffectiveGrainMode('ON', { grain_auto_enabled: 'false' })).toBe('ON');
  });

  it('resolves OFF outright, regardless of the installation setting', () => {
    expect(resolveEffectiveGrainMode('OFF', {})).toBe('OFF');
    expect(resolveEffectiveGrainMode('OFF', { grain_auto_enabled: 'true' })).toBe('OFF');
    expect(resolveEffectiveGrainMode('OFF', { grain_auto_enabled: 'false' })).toBe('OFF');
  });

  it('resolves INHERIT to AUTO only when the installation setting reads true', () => {
    expect(resolveEffectiveGrainMode('INHERIT', { grain_auto_enabled: 'true' })).toBe('AUTO');
  });

  it('resolves INHERIT to OFF when the row is absent', () => {
    // An upgraded installation with no row must not switch grain on.
    // Flipping `=== 'true'` to `!== 'false'` makes this case read 'AUTO'.
    expect(resolveEffectiveGrainMode('INHERIT', {})).toBe('OFF');
  });

  it('resolves INHERIT to OFF when the row explicitly reads false', () => {
    expect(resolveEffectiveGrainMode('INHERIT', { grain_auto_enabled: 'false' })).toBe('OFF');
  });

  it('resolves INHERIT to OFF for a hand-edited, unrecognised row value', () => {
    // Flipping `=== 'true'` to `!== 'false'` makes this case read 'AUTO' too.
    expect(resolveEffectiveGrainMode('INHERIT', { grain_auto_enabled: 'maybe' })).toBe('OFF');
  });
});
