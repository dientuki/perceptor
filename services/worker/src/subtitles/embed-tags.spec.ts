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
  it('writes empty Targets and the two exact Simple names', () => {
    const xml = buildTrackTagsXml('OpenSubtitles file 42 & more', 1500);
    expect(xml).toContain('<Targets/>');
    expect(xml).toContain('<Name>PERCEPTOR_SOURCE</Name>');
    expect(xml).toContain('<String>OpenSubtitles file 42 &amp; more</String>');
    expect(xml).toContain('<Name>PERCEPTOR_OFFSET</Name>');
    expect(xml).toContain('<String>1500</String>');
  });

  it('writes a negative offset with its sign', () => {
    expect(buildTrackTagsXml('src', -2000)).toContain('<String>-2000</String>');
  });
});
