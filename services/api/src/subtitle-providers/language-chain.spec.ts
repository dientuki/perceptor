import { SubtitleProviderKind } from '@prisma/client';
import { chain, effectiveDefault, parseLanguages, ProviderLanguage } from './language-chain';

const OS = SubtitleProviderKind.OPENSUBTITLES;
const SX = SubtitleProviderKind.SUBDIVX;

// This suite exists because otherwise a wrong provider chain fails with no
// error anywhere: a Latin American Spanish search silently goes to the wrong
// provider, a fallback is skipped (the language reads NOT_FOUND although the
// other provider was never asked), or a provider that cannot serve the
// language is called and burns its quota. The chain is pure, so every one of
// those is pinned here rather than discovered in a live search.
describe('chain', () => {
  const languages: ProviderLanguage[] = [{ languageTag: 'es-419', provider: SX }];
  const base = {
    iso3: 'spa',
    variantTag: 'es-419' as string | null,
    baseTag: 'es' as string | null,
    configured: [OS, SX],
    defaultKind: OS as SubtitleProviderKind | null,
    languages,
  };

  it('tries the variant entry first and the default after it', () => {
    expect(chain(base)).toEqual([SX, OS]);
  });

  it('prefers the variant entry over the base entry', () => {
    expect(
      chain({
        ...base,
        defaultKind: SX,
        languages: [
          { languageTag: 'es', provider: SX },
          { languageTag: 'es-419', provider: OS },
        ],
      }),
    ).toEqual([OS, SX]);
  });

  it('uses the base entry for a variant without its own entry', () => {
    expect(
      chain({ ...base, variantTag: 'es-ES', languages: [{ languageTag: 'es', provider: SX }] }),
    ).toEqual([SX, OS]);
  });

  it('uses the base entry when no variant is wanted', () => {
    expect(
      chain({ ...base, variantTag: null, languages: [{ languageTag: 'es', provider: SX }] }),
    ).toEqual([SX, OS]);
  });

  it('appends the default exactly once when a entry already names it', () => {
    expect(
      chain({ ...base, languages: [{ languageTag: 'es-419', provider: OS }] }),
    ).toEqual([OS]);
  });

  it('sends a language with no entry straight to the default', () => {
    expect(chain({ ...base, iso3: 'eng', variantTag: null, baseTag: 'en' })).toEqual([OS]);
  });

  it('skips a configured provider that is not configured', () => {
    expect(chain({ ...base, configured: [OS] })).toEqual([OS]);
  });

  it('skips a provider that does not serve the language', () => {
    expect(
      chain({
        ...base,
        iso3: 'eng',
        variantTag: null,
        baseTag: 'en',
        languages: [{ languageTag: 'en', provider: SX }],
      }),
    ).toEqual([OS]);
  });

  it('returns an empty chain when the only provider cannot serve the language', () => {
    expect(
      chain({
        ...base,
        iso3: 'eng',
        variantTag: null,
        baseTag: 'en',
        configured: [SX],
        defaultKind: SX,
        languages: [],
      }),
    ).toEqual([]);
  });

  it('returns an empty chain with nothing configured', () => {
    expect(chain({ ...base, configured: [], defaultKind: null })).toEqual([]);
  });
});

describe('effectiveDefault', () => {
  it('keeps a stored default that names a configured kind', () => {
    expect(effectiveDefault('SUBDIVX', [OS, SX])).toBe(SX);
  });

  it('derives the first configured kind in enum order from an empty value', () => {
    expect(effectiveDefault('', [SX, OS])).toBe(OS);
    expect(effectiveDefault(undefined, [SX])).toBe(SX);
  });

  it('ignores a stored default whose provider is no longer configured', () => {
    expect(effectiveDefault('SUBDIVX', [OS])).toBe(OS);
  });

  it('ignores a stored value that is not a provider kind', () => {
    expect(effectiveDefault('NOPE', [SX])).toBe(SX);
  });

  it('is null when nothing is configured', () => {
    expect(effectiveDefault('OPENSUBTITLES', [])).toBeNull();
  });
});

describe('parseLanguages', () => {
  it('reads a well-formed list', () => {
    expect(
      parseLanguages('[{"languageTag":"es-419","provider":"SUBDIVX"}]'),
    ).toEqual([{ languageTag: 'es-419', provider: SX }]);
  });

  it('reads empty, missing and "[]" as no languages without reporting garbage', () => {
    const onGarbage = jest.fn();
    expect(parseLanguages('', onGarbage)).toEqual([]);
    expect(parseLanguages(undefined, onGarbage)).toEqual([]);
    expect(parseLanguages('[]', onGarbage)).toEqual([]);
    expect(onGarbage).not.toHaveBeenCalled();
  });

  it('reads unparseable JSON as no languages and reports it', () => {
    const onGarbage = jest.fn();
    expect(parseLanguages('{not json', onGarbage)).toEqual([]);
    expect(onGarbage).toHaveBeenCalledTimes(1);
  });

  it('reads a non-array as no languages and reports it', () => {
    const onGarbage = jest.fn();
    expect(parseLanguages('{"a":1}', onGarbage)).toEqual([]);
    expect(onGarbage).toHaveBeenCalledTimes(1);
  });

  it('drops malformed and duplicate entries but keeps the valid ones', () => {
    const onGarbage = jest.fn();
    const raw = JSON.stringify([
      { languageTag: 'es', provider: 'SUBDIVX' },
      { languageTag: 'es', provider: 'OPENSUBTITLES' },
      { languageTag: 'en', provider: 'NOPE' },
      null,
      'x',
    ]);
    expect(parseLanguages(raw, onGarbage)).toEqual([{ languageTag: 'es', provider: SX }]);
    expect(onGarbage).toHaveBeenCalledTimes(1);
  });
});
