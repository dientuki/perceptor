// Spec 031, REQ-4 REQ-5 REQ-6 REQ-9

import { describe, expect, it, vi } from 'vitest';
import { getAudioParams, selectAudioStreams } from './params';
import { NO_AUDIO_VARIANTS, detectVariant, detectWithTags, narrowToVariants, requestedVariants } from './variants';

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

  it('is empty for a bare tag with no region subtag — not a variant request (Spec 031, REQ-6)', () => {
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
  it('keeps only the streams matching a requested variant when at least one matches (Spec 031, REQ-4)', () => {
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

  it('keeps every stream, ungrouped, when no requested variant matches anything (Spec 031, REQ-5)', () => {
    const streams = [
      stream({ index: 1, tags: { title: 'BTM' } }),
      stream({ index: 2, tags: { title: 'BTM' } }),
    ];
    const requested = requestedVariants('spa', ['es-ES']);

    const result = narrowToVariants(streams, requested);

    expect(result).toEqual({ matched: false, streams });
  });

  it('groups matches per requested tag when both variants are requested and both match (Spec 031, REQ-9)', () => {
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

describe('detectWithTags (Spec 110)', () => {
  it('lets a map entry override the title markers for that index only', () => {
    const detect = detectWithTags(new Map([[2, 'es-419']]));

    expect(detect(stream({ index: 2, tags: { title: 'Castellano' } }))).toBe('es-419');
    expect(detect(stream({ index: 3, tags: { title: 'Castellano' } }))).toBe('es-ES');
  });

  it('reads the title markers for a stream absent from the map', () => {
    const detect = detectWithTags(new Map([[2, 'es-419']]));

    expect(detect(stream({ index: 5, tags: { title: 'Latino' } }))).toBe('es-419');
    expect(detect(stream({ index: 6, tags: { title: 'BTM' } }))).toBeUndefined();
  });
});

describe('audio variant resolution (Spec 110)', () => {
  const spanish = (index: number, channels: number) =>
    stream({ index, codec_name: 'ac3', channels, tags: { language: 'spa', title: 'BTM' } });

  it('selects the mapped requested variant and titles it from the map', () => {
    const streams = [spanish(2, 6), spanish(3, 2)];
    const audioVariants = { tags: new Map([[2, 'es-ES'], [3, 'es-419']]), duplicates: new Set<number>() };

    const selection = selectAudioStreams(streams, ['spa'], 'spa', ['es-419'], audioVariants);
    const params = getAudioParams(streams, ['spa'], 'spa', ['es-419'], {}, audioVariants);

    expect(selection.streams.map((s) => s.index)).toEqual([3]);
    expect(params).toContain('title=Latino Stereo (Opus)');
  });

  it('drops a duplicate stream before any selection rule', () => {
    const streams = [spanish(2, 6), spanish(3, 2)];
    const audioVariants = { tags: new Map<number, string>(), duplicates: new Set([2]) };

    const selection = selectAudioStreams(streams, ['spa'], 'spa', [], audioVariants);

    expect(selection.streams.map((s) => s.index)).toEqual([3]);
  });

  it('is a no-op with an empty resolution', () => {
    const streams = [spanish(2, 6), spanish(3, 2)];

    expect(selectAudioStreams(streams, ['spa'], 'spa', [], NO_AUDIO_VARIANTS).streams.map((s) => s.index)).toEqual([2]);
  });
});
