import { EffectiveGrainMode } from '@/media/entities/grain-mode.enum';

// 092-film-grain-optimization: the two-level resolution — a title's own
// override wins outright; only INHERIT consults the installation switch,
// and the switch is never consulted for a title that decided for itself.
export function resolveEffectiveGrainMode(
  titleGrainMode: 'INHERIT' | 'ON' | 'OFF',
  settingsMap: Record<string, string>,
): EffectiveGrainMode {
  if (titleGrainMode === 'ON') {
    return EffectiveGrainMode.ON;
  }

  if (titleGrainMode === 'OFF') {
    return EffectiveGrainMode.OFF;
  }

  // 092-film-grain-optimization: `=== 'true'`, never `!== 'false'` — an
  // absent or hand-edited row must read as off, the `shorts_enabled` idiom.
  return settingsMap['grain_auto_enabled'] === 'true' ? EffectiveGrainMode.AUTO : EffectiveGrainMode.OFF;
}
