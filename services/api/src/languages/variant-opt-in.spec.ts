import { LanguageTrackKind } from '@prisma/client';
import { VARIANT_TRACK_TITLES, VariantOptInOwner, wantedVariants, wantsVariantDetection } from './variant-opt-in';

// Defends against the variant opt-in or the wanted variant being derived
// wrongly, which fails silently: detection runs for nobody, or a subtitle in
// the variant the user asked for is rejected. The titles table is pinned
// because the worker (spec 031) writes the same strings on audio tracks.
const A = LanguageTrackKind.AUDIO;
const S = LanguageTrackKind.SUBTITLE;
const variants = new Set(['spa']);

const row = (kind: LanguageTrackKind, tag: string, iso3 = tag.split('-')[0] === 'es' ? 'spa' : 'eng') => ({
  kind,
  language: { tag, iso3 },
});

const owner = (
  on: boolean,
  own: ReturnType<typeof row>[],
  global: ReturnType<typeof row>[] = [],
): VariantOptInOwner => ({ languages: own, user: { audioVariantDetection: on, languages: global } });

describe('wantsVariantDetection', () => {
  it('follows the audio rows for AUDIO and the subtitle rows for SUBTITLE', () => {
    const audioOnly = owner(true, [], [row(A, 'es')]);
    const subtitleOnly = owner(true, [], [row(S, 'es')]);
    expect(wantsVariantDetection(audioOnly, A, variants)).toBe(true);
    expect(wantsVariantDetection(audioOnly, S, variants)).toBe(false);
    expect(wantsVariantDetection(subtitleOnly, S, variants)).toBe(true);
    expect(wantsVariantDetection(subtitleOnly, A, variants)).toBe(false);
  });

  it('is false when the preference is off or the language has no variants', () => {
    expect(wantsVariantDetection(owner(false, [], [row(S, 'es')]), S, variants)).toBe(false);
    expect(wantsVariantDetection(owner(true, [], [row(S, 'en')]), S, variants)).toBe(false);
  });

  it('merges per-title rows with global ones', () => {
    expect(wantsVariantDetection(owner(true, [row(S, 'es')], [row(S, 'en')]), S, variants)).toBe(true);
  });
});

describe('wantedVariants', () => {
  it('is null when nobody qualifies', () => {
    expect(wantedVariants([owner(false, [row(S, 'es-419')])], variants)).toBeNull();
    expect(wantedVariants([owner(true, [row(A, 'es-419')])], variants)).toBeNull();
    expect(wantedVariants([], variants)).toBeNull();
  });

  it('ignores the plain tag when a regional one is present', () => {
    expect(wantedVariants([owner(true, [row(S, 'es-419')], [row(S, 'es')])], variants)).toEqual({
      spa: 'es-419',
    });
  });

  it('omits a language whose owners name two distinct regional tags', () => {
    const owners = [owner(true, [row(S, 'es-419')]), owner(true, [row(S, 'es-ES')])];
    expect(wantedVariants(owners, variants)).toEqual({});
  });

  it('yields an empty object for an opted-in owner with only a plain tag', () => {
    expect(wantedVariants([owner(true, [row(S, 'es')])], variants)).toEqual({});
  });

  it('does not count rows of a non-qualifying owner', () => {
    const owners = [owner(true, [row(S, 'es-419')]), owner(false, [row(S, 'es-ES')])];
    expect(wantedVariants(owners, variants)).toEqual({ spa: 'es-419' });
  });
});

describe('VARIANT_TRACK_TITLES', () => {
  it('matches the worker 031 track titles', () => {
    expect(VARIANT_TRACK_TITLES).toEqual({ 'es-419': 'Latino', 'es-ES': 'Español (España)' });
  });
});
