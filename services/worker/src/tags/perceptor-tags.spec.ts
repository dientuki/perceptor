// Defends against an empty, duplicated or placeholder-filled PERCEPTOR group: a tag tree
// that is written, parsed by no tool and flagged by none, yet misreports a file's provenance.
import { describe, expect, it } from 'vitest';
import { buildGlobalTagsXml, buildTrackGroupXml, buildVideoTagsXml, buildVideoTrackTagsXml } from './perceptor-tags';

const count = (xml: string, needle: string) => xml.split(needle).length - 1;

describe('buildGlobalTagsXml', () => {
  it('writes exactly one PERCEPTOR group on a global target with only SOURCE, VERSION and ENCODED_AT', () => {
    const xml = buildGlobalTagsXml({ source: 'a/b.mkv', version: 'dev', encodedAt: new Date('2026-11-20T18:04:11.987Z') })!;
    expect(count(xml, '<Name>PERCEPTOR</Name>')).toBe(1);
    expect(xml).toContain('<Targets/>');
    expect(count(xml, '<Tag>')).toBe(1);
    expect(count(xml, '<Simple>')).toBe(4);
    expect(xml).toMatch(/<Name>ENCODED_AT<\/Name>\s*<String>2026-11-20T18:04:11Z<\/String>/);
  });

  it('omits null and blank children instead of writing empty values', () => {
    const xml = buildGlobalTagsXml({ source: 'a.mkv', version: null, encodedAt: null })!;
    expect(xml).not.toContain('VERSION');
    expect(xml).not.toContain('ENCODED_AT');
    expect(xml).not.toContain('<String></String>');
  });

  it('returns null when no fact is known', () => {
    expect(buildGlobalTagsXml({})).toBeNull();
  });

  it('strips control characters from values', () => {
    const xml = buildGlobalTagsXml({ source: 'a\u0000b\u0007c\n.mkv' })!;
    expect(xml).toContain('<String>abc.mkv</String>');
  });
});

describe('buildVideoTagsXml', () => {
  it('writes flat children under one PERCEPTOR group with an empty Targets, never deeper', () => {
    const xml = buildVideoTagsXml({
      videoCodec: 'av1',
      crf: 22,
      preset: 4,
      contentKind: 'LIVE_ACTION',
      resolutionCeiling: '1080p',
      sourceResolution: '3840x2160',
      outputResolution: '1920x1080',
      deinterlaced: true,
      grainApplied: true,
      grainDecidedBy: 'gate',
      dubTrimSeconds: 5843.12,
      streamEndTrimSeconds: 6011.5,
    })!;
    expect(xml).toContain('<Targets/>');
    expect(count(xml, '<Name>PERCEPTOR</Name>')).toBe(1);
    expect(count(xml, '<Simple>')).toBe(11);
    for (const name of ['CRF', 'PRESET', 'CONTENT_KIND', 'RESOLUTION_CEILING', 'SOURCE_RESOLUTION',
      'DEINTERLACED', 'GRAIN_APPLIED', 'GRAIN_DECIDED_BY', 'DUB_TRIM', 'STREAM_END_TRIM']) {
      expect(xml).toContain(`<Name>${name}</Name>`);
    }
    expect(xml).not.toContain('<Name>ENCODE</Name>');
    expect(xml).not.toContain('<Name>GRAIN</Name>');
    expect(xml).toMatch(/<Name>GRAIN_APPLIED<\/Name>\s*<String>yes<\/String>/);
    expect(xml).toContain('<String>5843.120</String>');
  });

  it('omits unknown children, DEINTERLACED unless yes, and zero trims', () => {
    const xml = buildVideoTagsXml({
      videoCodec: 'av1',
      contentKind: 'LIVE_ACTION',
      crf: null,
      preset: undefined,
      outputResolution: '  ',
      deinterlaced: false,
      grainApplied: null,
      dubTrimSeconds: 0,
      streamEndTrimSeconds: null,
    })!;
    for (const name of ['CRF', 'PRESET', 'DEINTERLACED', 'GRAIN_APPLIED', 'DUB_TRIM', 'STREAM_END_TRIM']) {
      expect(xml).not.toContain(`<Name>${name}</Name>`);
    }
    expect(xml).not.toContain('<String>0</String>');
  });

  it('keeps GRAIN_APPLIED without GRAIN_DECIDED_BY when the stage is unknown', () => {
    const xml = buildVideoTagsXml({ videoCodec: 'av1', grainApplied: false })!;
    expect(xml).toMatch(/<Name>GRAIN_APPLIED<\/Name>\s*<String>no<\/String>/);
    expect(xml).not.toContain('GRAIN_DECIDED_BY');
  });

  it('omits CRF, PRESET and GRAIN_* for a stream copy', () => {
    const xml = buildVideoTagsXml({
      videoCodec: 'copy', crf: 30, preset: 4, grainApplied: true, grainDecidedBy: 'title', contentKind: 'ANIME',
    })!;
    for (const name of ['CRF', 'PRESET', 'GRAIN_APPLIED', 'GRAIN_DECIDED_BY']) {
      expect(xml).not.toContain(`<Name>${name}</Name>`);
    }
    expect(xml).toContain('<Name>CONTENT_KIND</Name>');
  });

  it('returns null when nothing is known', () => {
    expect(buildVideoTagsXml({})).toBeNull();
  });

  it('targets a track UID for the migration variant', () => {
    const xml = buildVideoTrackTagsXml({ crf: 22 }, 77)!;
    expect(xml).toContain('<Targets><TrackUID>77</TrackUID></Targets>');
    expect(buildVideoTrackTagsXml({}, 77)).toBeNull();
  });
});

describe('buildTrackGroupXml', () => {
  it('writes one PERCEPTOR group targeted at the track UID', () => {
    const xml = buildTrackGroupXml({ trackUid: 42, source: 'x.srt', offsetMs: 0, provider: 'user' })!;
    expect(count(xml, '<Name>PERCEPTOR</Name>')).toBe(1);
    expect(xml).toContain('<Targets><TrackUID>42</TrackUID></Targets>');
    expect(xml).toMatch(/<Name>OFFSET<\/Name>\s*<String>0<\/String>/);
  });

  it('omits sync children when no measurement ran and writes them in plain decimal otherwise', () => {
    const none = buildTrackGroupXml({ trackUid: 1, source: 'x.srt', syncScore: null, framerateRatio: null })!;
    expect(none).not.toContain('SYNC_SCORE');
    expect(none).not.toContain('FRAMERATE_RATIO');
    const some = buildTrackGroupXml({ trackUid: 1, syncScore: 1234.5, framerateRatio: 1.001 })!;
    expect(some).toContain('<String>1234.5</String>');
    expect(some).toContain('<String>1.001</String>');
  });

  it('writes an unknown provider verbatim, escaped and without control characters', () => {
    const xml = buildTrackGroupXml({ trackUid: 1, provider: 'new\u0000prov&' })!;
    expect(xml).toContain('<String>newprov&amp;</String>');
  });
});
