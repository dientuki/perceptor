// Defends src/ffmpeg/variants.ts — the vocabulary and the three named
// functions REQ-4/REQ-5/REQ-6/REQ-9 of
// docs/spec/features/031-worker-language-variants/spec.md build selection
// on. Nothing here is consumed by params.ts yet (that lands with the rule
// change); these cases pin the module in isolation, the way
// params.spec.ts pins the existing predicates.

import { describe, expect, it, vi } from 'vitest';
import { detectVariant, narrowToVariants, requestedVariants } from './variants';

function stream(overrides: Record<string, any>) {
  return {
    index: 0,
    codec_type: 'audio',
    tags: {},
    ...overrides,
  };
}

describe('detectVariant', () => {
  it('detects a Latin American marker', () => {
    expect(detectVariant(stream({ tags: { title: 'Latino' } }))).toBe('es-419');
  });

  it('detects a Castilian marker', () => {
    expect(detectVariant(stream({ tags: { title: 'Castellano' } }))).toBe('es-ES');
  });

  it('is undetected when the title carries no marker', () => {
    expect(detectVariant(stream({ tags: { title: 'BTM' } }))).toBeUndefined();
  });

  it('does not read "eu" out of the middle of a word when detecting Castilian Spanish', () => {
    expect(detectVariant(stream({ tags: { title: 'Europa 5.1' } }))).toBeUndefined();
  });

  it('detects the bare "EU" spelling as a whole word', () => {
    expect(detectVariant(stream({ tags: { title: 'BTM DD 5.1 EU' } }))).toBe('es-ES');
  });

  it('does not read "la" out of the middle of a word when detecting Latin American Spanish', () => {
    expect(detectVariant(stream({ tags: { title: 'Balaclava' } }))).toBeUndefined();
  });
});

describe('requestedVariants', () => {
  it('returns the requested tags belonging to the given iso3', () => {
    const variants = requestedVariants('spa', ['en', 'es-419']);

    expect(variants.map((v) => v.tag)).toEqual(['es-419']);
  });

  it('returns both requested variants when both are present', () => {
    const variants = requestedVariants('spa', ['es-419', 'es-ES']);

    expect(variants.map((v) => v.tag).sort()).toEqual(['es-419', 'es-ES']);
  });

  it('is empty for a language with no requested variant tags', () => {
    expect(requestedVariants('eng', ['en', 'es-419'])).toEqual([]);
  });

  it('is empty for a bare tag with no region subtag — not a variant request (REQ-6)', () => {
    expect(requestedVariants('spa', ['es'])).toEqual([]);
  });

  it('degrades an unresolvable regional tag to no preference, warning once, never throwing', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const tags = ['pt-BR'];

    expect(() => requestedVariants('spa', tags)).not.toThrow();
    expect(requestedVariants('spa', tags)).toEqual([]);
    requestedVariants('spa', tags);

    expect(warn).toHaveBeenCalledTimes(1);
    warn.mockRestore();
  });
});

describe('narrowToVariants', () => {
  it('keeps only the streams matching a requested variant when at least one matches (REQ-4)', () => {
    const streams = [
      stream({ index: 1, tags: { title: 'Latino' } }),
      stream({ index: 2, tags: { title: 'BTM' } }),
    ];
    const requested = requestedVariants('spa', ['es-419']);

    const result = narrowToVariants(streams, requested);

    expect(result).toEqual({
      matched: true,
      groups: [{ tag: 'es-419', streams: [streams[0]] }],
    });
  });

  it('drops a stream detected as a variant nobody requested', () => {
    const streams = [
      stream({ index: 1, tags: { title: 'Latino' } }),
      stream({ index: 2, tags: { title: 'Castellano' } }),
    ];
    const requested = requestedVariants('spa', ['es-419']);

    const result = narrowToVariants(streams, requested);

    expect(result).toEqual({
      matched: true,
      groups: [{ tag: 'es-419', streams: [streams[0]] }],
    });
  });

  it('keeps every stream, ungrouped, when no requested variant matches anything (REQ-5)', () => {
    const streams = [
      stream({ index: 1, tags: { title: 'BTM' } }),
      stream({ index: 2, tags: { title: 'BTM' } }),
    ];
    const requested = requestedVariants('spa', ['es-ES']);

    const result = narrowToVariants(streams, requested);

    expect(result).toEqual({ matched: false, streams });
  });

  it('groups matches per requested tag when both variants are requested and both match (REQ-9)', () => {
    const streams = [
      stream({ index: 1, tags: { title: 'Latino' } }),
      stream({ index: 2, tags: { title: 'Castellano' } }),
    ];
    const requested = requestedVariants('spa', ['es-419', 'es-ES']);

    const result = narrowToVariants(streams, requested);

    expect(result).toEqual({
      matched: true,
      groups: [
        { tag: 'es-419', streams: [streams[0]] },
        { tag: 'es-ES', streams: [streams[1]] },
      ],
    });
  });
});
