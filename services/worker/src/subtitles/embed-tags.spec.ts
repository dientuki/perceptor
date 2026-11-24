// Defends against provenance tags that corrupt the mkvmerge tags file: a raw
// control character or unescaped markup makes mkvmerge reject (or worse,
// misparse) the XML, and an unbounded value bloats the container. A tag that
// lands on the wrong track is covered by the mkvmerge check, not here.

import { describe, expect, it } from 'vitest';
import { buildTrackTagsXml, sanitizeTagValue } from './embed-tags';

describe('sanitizeTagValue', () => {
  it('drops newline, carriage return, tab and other control characters', () => {
    expect(sanitizeTagValue('a\nb\rc\td\u0000e\u001ff')).toBe('abcdef');
  });

  it('cuts a 600-character value to 500', () => {
    expect(sanitizeTagValue('x'.repeat(600))).toHaveLength(500);
  });

  it('escapes markup characters', () => {
    expect(sanitizeTagValue(`<a href="x">Tom & 'Jerry'</a>`)).toBe(
      '&lt;a href=&quot;x&quot;&gt;Tom &amp; &apos;Jerry&apos;&lt;/a&gt;',
    );
  });
});

describe('buildTrackTagsXml', () => {
  it('writes empty Targets and one nested PERCEPTOR group', () => {
    const xml = buildTrackTagsXml({
      source: 'OpenSubtitles file 42 & more',
      offsetMs: 1500,
      provider: 'opensubtitles',
      syncScore: 31.25,
      framerateRatio: 1,
      embeddedAt: new Date('2026-11-20T10:20:30.456Z'),
    });
    expect(xml).toContain('<Targets/>');
    expect(xml).toContain('<Name>PERCEPTOR</Name>');
    for (const name of ['SOURCE', 'OFFSET', 'PROVIDER', 'SYNC_SCORE', 'FRAMERATE_RATIO', 'EMBEDDED_AT']) {
      expect(xml).toContain(`<Name>${name}</Name>`);
    }
    expect(xml).toContain('<String>OpenSubtitles file 42 &amp; more</String>');
    expect(xml).toContain('<String>1500</String>');
    expect(xml).toContain('<String>2026-11-20T10:20:30Z</String>');
  });

  it('leaves no flat PERCEPTOR_SOURCE or PERCEPTOR_OFFSET behind', () => {
    const xml = buildTrackTagsXml({ source: 'src', offsetMs: 10, provider: 'user' });
    expect(xml).not.toContain('PERCEPTOR_SOURCE');
    expect(xml).not.toContain('PERCEPTOR_OFFSET');
  });

  it('writes an unknown provider string verbatim', () => {
    expect(buildTrackTagsXml({ provider: 'some-new-provider' })).toContain('<String>some-new-provider</String>');
  });

  it('writes a negative offset with its sign and omits an absent provider', () => {
    const xml = buildTrackTagsXml({ source: 'src', offsetMs: -2000 })!;
    expect(xml).toContain('<String>-2000</String>');
    expect(xml).not.toContain('<Name>PROVIDER</Name>');
  });

  it('returns null when there is nothing to write', () => {
    expect(buildTrackTagsXml({})).toBeNull();
  });
});
