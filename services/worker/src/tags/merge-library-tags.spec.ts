// Defends against a silent rewrite of a library file's tags: a flat Perceptor tag converted with a
// changed value, a foreign tag dropped or reordered, a track group written onto the wrong UID, or a
// second pass that keeps rewriting an already-migrated file.
import { describe, expect, it } from 'vitest';
import { mergeLibraryTags, type MigrationFacts } from './merge-library-tags';

const tracks = [
  { number: 1, uid: '111', type: 'video' },
  { number: 2, uid: '222', type: 'subtitles' },
  { number: 3, uid: '333', type: 'subtitles' },
];

const noFacts: MigrationFacts = { tracks: [] };

const SOURCE = 'Some.Release-GRP/Some.Release-GRP.mkv';

const globalFlat = (source = SOURCE) => `  <Tag>
    <Targets>
      <TargetTypeValue>50</TargetTypeValue>
    </Targets>
    <Simple>
      <Name>title</Name>
      <String>A &amp; B</String>
    </Simple>
    <Simple>
      <Name>PERCEPTOR_SOURCE</Name>
      <String>${source}</String>
    </Simple>
  </Tag>
`;

const trackFlat = (uid: number, source: string, offset: string | null) => `  <Tag>
    <Targets>
      <TrackUID>${uid}</TrackUID>
    </Targets>
    <Simple>
      <Name>PERCEPTOR_SOURCE</Name>
      <String>${source}</String>
    </Simple>
${
  offset === null
    ? ''
    : `    <Simple>
      <Name>PERCEPTOR_OFFSET</Name>
      <String>${offset}</String>
    </Simple>
`
}  </Tag>
`;

const foreign = (uid: number) => `  <Tag>
    <Targets>
      <TrackUID>${uid}</TrackUID>
    </Targets>
    <Simple>
      <Name>BPS</Name>
      <String>1500 &lt;x&gt;</String>
    </Simple>
  </Tag>
`;

const wrap = (...tags: string[]) => `<?xml version="1.0" encoding="UTF-8"?>\n<Tags>\n${tags.join('')}</Tags>\n`;

const merge = (xml: string, facts: MigrationFacts = noFacts, extra: object = {}) =>
  mergeLibraryTags({ tagsXml: xml, tracks, facts, ...extra });

const count = (xml: string, needle: string) => xml.split(needle).length - 1;

describe('mergeLibraryTags, global tag', () => {
  it('converts the flat PERCEPTOR_SOURCE into a SOURCE child keeping the value verbatim', () => {
    const out = merge(wrap(globalFlat('Rel &amp; Co/x.mkv'))) as string;
    expect(out).not.toContain('PERCEPTOR_SOURCE');
    expect(count(out, '<Name>PERCEPTOR</Name>')).toBe(1);
    expect(out).toMatch(/<Name>SOURCE<\/Name>\s*<String>Rel &amp; Co\/x\.mkv<\/String>/);
  });

  it('keeps every non-Perceptor tag and simple in order and byte for byte', () => {
    const xml = wrap(foreign(111), globalFlat(), foreign(222));
    const out = merge(xml) as string;
    expect(out.indexOf(foreign(111))).toBeGreaterThan(-1);
    expect(out.indexOf(foreign(111))).toBeLessThan(out.indexOf('<Name>title</Name>'));
    expect(out.indexOf('<Name>title</Name>')).toBeLessThan(out.indexOf(foreign(222)));
    expect(out).toContain('<String>A &amp; B</String>');
    expect(out).toContain(foreign(222));
  });

  it('lets the file win: an existing global group is never overwritten, api facts go to the video group', () => {
    const xml = wrap(`  <Tag>
    <Targets/>
    <Simple>
      <Name>PERCEPTOR</Name>
      <Simple>
        <Name>SOURCE</Name>
        <String>from-file</String>
      </Simple>
    </Simple>
  </Tag>
`);
    const out = merge(xml, { tracks: [], crf: 99, contentKind: 'ANIME' }) as string;
    expect(out).toContain('<String>from-file</String>');
    expect(out.slice(0, out.indexOf('<TrackUID>111'))).not.toContain('CRF');
    expect(merge(out, { tracks: [], crf: 99, contentKind: 'ANIME' })).toBe('unchanged');
  });

  it('fills only absent global children when a flat tag sits beside an existing group', () => {
    const xml = wrap(`  <Tag>
    <Targets/>
    <Simple>
      <Name>PERCEPTOR_SOURCE</Name>
      <String>flat</String>
    </Simple>
    <Simple>
      <Name>PERCEPTOR</Name>
      <Simple>
        <Name>SOURCE</Name>
        <String>from-file</String>
      </Simple>
    </Simple>
  </Tag>
`);
    const out = merge(xml, { tracks: [], encodedAt: new Date('2026-01-02T03:04:05Z'), crf: 28 }) as string;
    expect(out).not.toContain('PERCEPTOR_SOURCE');
    expect(out).toContain('<String>from-file</String>');
    expect(out).not.toContain('<String>flat</String>');
    expect(out).toMatch(/<Name>ENCODED_AT<\/Name>\s*<String>2026-01-02T03:04:05Z<\/String>/);
    expect(count(out, '<Name>PERCEPTOR</Name>')).toBe(2);
  });

  it('writes the encode facts on the first video track group, never in the global one', () => {
    const out = merge(wrap(foreign(111), globalFlat()), {
      tracks: [],
      videoCodec: 'av1',
      crf: 22,
      grainApplied: true,
      deinterlaced: true,
    }) as string;
    const video = out.slice(out.indexOf('<TrackUID>111'));
    expect(video).toMatch(/<Name>CRF<\/Name>\s*<String>22<\/String>/);
    expect(video).toMatch(/<Name>GRAIN_APPLIED<\/Name>\s*<String>yes<\/String>/);
    expect(video).toMatch(/<Name>DEINTERLACED<\/Name>\s*<String>yes<\/String>/);
    expect(video).toContain('<Name>BPS</Name>');
    const global = out.slice(0, out.indexOf('<TrackUID>111'));
    expect(global).not.toContain('CRF');
    expect(out).not.toContain('SOURCE_RESOLUTION');
    expect(out).not.toContain('GRAIN_DECIDED_BY');
    expect(out).not.toContain('DUB_TRIM');
  });

  it('targets the first video track by type, not by position', () => {
    const shuffled = [
      { number: 1, uid: '900', type: 'audio' },
      { number: 2, uid: '800', type: 'video' },
      { number: 3, uid: '700', type: 'video' },
    ];
    const out = mergeLibraryTags({
      tagsXml: wrap(globalFlat()),
      tracks: shuffled,
      facts: { tracks: [], crf: 30, videoCodec: 'av1' },
    }) as string;
    expect(out).toContain('<TrackUID>800</TrackUID>');
    expect(out).not.toContain('<TrackUID>700</TrackUID>');
    expect(out).not.toContain('<TrackUID>900</TrackUID>');
  });

  it('keeps a 64-bit track UID exact in the tag target', () => {
    const out = mergeLibraryTags({
      tagsXml: wrap(globalFlat()),
      tracks: [{ number: 1, uid: '18234047073334910123', type: 'video' }],
      facts: { tracks: [], crf: 30, videoCodec: 'av1' },
    }) as string;
    expect(out).toContain('<TrackUID>18234047073334910123</TrackUID>');
  });

  it('writes no video group when the file has no video track', () => {
    const out = mergeLibraryTags({
      tagsXml: wrap(globalFlat()),
      tracks: [{ number: 1, uid: '5', type: 'audio' }],
      facts: { tracks: [], crf: 30 },
    }) as string;
    expect(out).not.toContain('CRF');
  });

  it('never writes OUTPUT_RESOLUTION', () => {
    const written = merge(wrap(globalFlat()), { tracks: [], videoCodec: 'av1', contentKind: 'LIVE_ACTION' }, { probedOutputResolution: '1920x1080' }) as string;
    expect(written).not.toContain('OUTPUT_RESOLUTION');
    expect(merge(wrap(foreign(111)), noFacts, { probedOutputResolution: '1920x1080' })).toBe('unchanged');
  });

  it('writes a video group into the existing video track tag when only the database knows something', () => {
    const out = merge(wrap(foreign(111)), { tracks: [], contentKind: 'LIVE_ACTION' }) as string;
    expect(count(out, '<Tag>')).toBe(1);
    expect(out).toContain(foreign(111).split('  </Tag>')[0]);
    expect(out).toMatch(/<Name>CONTENT_KIND<\/Name>\s*<String>LIVE_ACTION<\/String>/);
  });

  it('adds a global tag with ENCODED_AT and a video tag to a file that has none', () => {
    const out = merge(wrap(foreign(222)), { tracks: [], contentKind: 'CGI', encodedAt: new Date('2026-01-02T03:04:05Z') }) as string;
    expect(out).toContain('<Targets/>');
    expect(out).toContain('<TrackUID>111</TrackUID>');
    expect(count(out, '<Tag>')).toBe(3);
    expect(out).toContain(foreign(222));
  });

  it('builds a whole document from an empty Tags element', () => {
    const out = merge('<?xml version="1.0"?>\n<Tags/>\n', { tracks: [], contentKind: 'CGI' }) as string;
    expect(out).toContain('<Name>CONTENT_KIND</Name>');
    expect(out).toContain('<TrackUID>111</TrackUID>');
  });
});

describe('mergeLibraryTags, track tags', () => {
  it('converts a track flat pair into a group keyed by the tag UID, values verbatim', () => {
    const xml = wrap(trackFlat(222, 'sub.srt', '-1500'), trackFlat(333, 'other.srt', '0'));
    const out = merge(xml) as string;
    expect(out).not.toContain('PERCEPTOR_OFFSET');
    expect(out).toMatch(/<TrackUID>222<\/TrackUID>[\s\S]*?<String>sub\.srt<\/String>[\s\S]*?<String>-1500<\/String>/);
    expect(count(out, '<Name>PERCEPTOR</Name>')).toBe(2);
    expect(out.indexOf('<TrackUID>222')).toBeLessThan(out.indexOf('<TrackUID>333'));
  });

  it('matches api track facts by SOURCE, not by position', () => {
    const xml = wrap(trackFlat(222, 'a.srt', '0'), trackFlat(333, 'b.srt', '0'));
    const out = merge(xml, {
      tracks: [
        { source: 'b.srt', provider: 'subdivx', syncScore: 12.5 },
        { source: 'a.srt', provider: 'opensubtitles', framerateRatio: 1 },
      ],
    }) as string;
    const first = out.slice(out.indexOf('<TrackUID>222'), out.indexOf('<TrackUID>333'));
    const second = out.slice(out.indexOf('<TrackUID>333'));
    expect(first).toContain('<String>opensubtitles</String>');
    expect(first).not.toContain('subdivx');
    expect(second).toContain('<String>subdivx</String>');
    expect(second).toMatch(/<Name>SYNC_SCORE<\/Name>\s*<String>12\.5<\/String>/);
  });

  it('leaves a tag whose UID is not a track of the file untouched', () => {
    const xml = wrap(trackFlat(999, 'ghost.srt', '0'));
    expect(merge(xml)).toBe('unchanged');
  });

  it('leaves a track tag without Perceptor children untouched', () => {
    expect(merge(wrap(foreign(111)))).toBe('unchanged');
  });
});

describe('mergeLibraryTags, idempotence', () => {
  const full: MigrationFacts = {
    tracks: [{ source: 'sub.srt', provider: 'opensubtitles' }],
    videoCodec: 'av1',
    crf: 28,
    preset: 4,
    contentKind: 'LIVE_ACTION',
    grainApplied: false,
    deinterlaced: false,
    encodedAt: new Date('2026-01-02T03:04:05Z'),
  };

  it('returns unchanged for a file with nothing flat and no facts to add', () => {
    expect(merge(wrap(foreign(111)))).toBe('unchanged');
    expect(merge(wrap(globalFlat().replace(/PERCEPTOR_SOURCE/, 'other')))).toBe('unchanged');
  });

  it('returns unchanged for its own output', () => {
    const xml = wrap(foreign(111), globalFlat(), trackFlat(222, 'sub.srt', '0'));
    const once = merge(xml, full, { probedOutputResolution: '1920x1080' });
    expect(once).not.toBe('unchanged');
    expect(merge(once as string, full, { probedOutputResolution: '1920x1080' })).toBe('unchanged');
  });

  it('returns unchanged for a file already in the current layout', () => {
    const current = wrap(
      `  <Tag>
    <Targets/>
    <Simple>
      <Name>PERCEPTOR</Name>
      <Simple>
        <Name>SOURCE</Name>
        <String>${SOURCE}</String>
      </Simple>
      <Simple>
        <Name>VERSION</Name>
        <String>v0.7.0</String>
      </Simple>
      <Simple>
        <Name>ENCODED_AT</Name>
        <String>2026-01-02T03:04:05Z</String>
      </Simple>
    </Simple>
  </Tag>
`,
      `  <Tag>
    <Targets>
      <TrackUID>111</TrackUID>
    </Targets>
    <Simple>
      <Name>PERCEPTOR</Name>
      <Simple>
        <Name>VIDEO_CODEC</Name>
        <String>av1</String>
      </Simple>
    </Simple>
  </Tag>
`,
    );
    expect(merge(current, full, { probedOutputResolution: '1920x1080' })).toBe('unchanged');
  });

  it('never writes VERSION on a migrated group even when a version is passed in', () => {
    const xml = wrap(foreign(111), globalFlat(), trackFlat(222, 'sub.srt', '0'));
    const out = merge(xml, full, { probedOutputResolution: '1920x1080', version: '1.2.3' }) as string;
    expect(out).toContain('PERCEPTOR');
    expect(out).not.toContain('VERSION');
    expect(out).not.toContain('1.2.3');
    const bare = merge(wrap(foreign(111)), full, { version: 'dev' }) as string;
    expect(bare).not.toContain('VERSION');
  });

  it('returns unchanged for its own output when the group was inserted without a flat tag', () => {
    const once = merge(wrap(foreign(111)), full) as string;
    expect(once).not.toBe('unchanged');
    expect(merge(once, full)).toBe('unchanged');
  });
});

describe('mergeLibraryTags, 0.3 layout conversion (REQ-20)', () => {
  const legacyGlobal = `  <Tag>
    <Targets/>
    <Simple>
      <Name>title</Name>
      <String>Fantastic Four</String>
    </Simple>
    <Simple>
      <Name>PERCEPTOR</Name>
      <Simple>
        <Name>SOURCE</Name>
        <String>Fantastic.Four.2005/ff.mkv</String>
      </Simple>
      <Simple>
        <Name>VERSION</Name>
        <String>dev</String>
      </Simple>
      <Simple>
        <Name>ENCODED_AT</Name>
        <String>2026-11-19T10:00:00Z</String>
      </Simple>
      <Simple>
        <Name>ENCODE</Name>
        <Simple>
          <Name>VIDEO_CODEC</Name>
          <String>av1</String>
        </Simple>
        <Simple>
          <Name>CRF</Name>
          <String>22</String>
        </Simple>
        <Simple>
          <Name>PRESET</Name>
          <String>4</String>
        </Simple>
        <Simple>
          <Name>CONTENT_KIND</Name>
          <String>LIVE_ACTION</String>
        </Simple>
        <Simple>
          <Name>OUTPUT_RESOLUTION</Name>
          <String>1280x536</String>
        </Simple>
      </Simple>
      <Simple>
        <Name>GRAIN</Name>
        <Simple>
          <Name>APPLIED</Name>
          <String>no</String>
        </Simple>
        <Simple>
          <Name>DECIDED_BY</Name>
          <String>gate</String>
        </Simple>
      </Simple>
      <Simple>
        <Name>STREAM_END_TRIM</Name>
        <String>6011.500</String>
      </Simple>
    </Simple>
  </Tag>
`;
  const legacySub = `  <Tag>
    <Targets>
      <TrackUID>222</TrackUID>
    </Targets>
    <Simple>
      <Name>PERCEPTOR</Name>
      <Simple>
        <Name>SOURCE</Name>
        <String>subdivx:Fantastic.Four.2005.m720p.BluRay.x264-FQX.srt</String>
      </Simple>
      <Simple>
        <Name>OFFSET</Name>
        <String>-250</String>
      </Simple>
      <Simple>
        <Name>PROVIDER</Name>
        <String>subdivx</String>
      </Simple>
      <Simple>
        <Name>SYNC_SCORE</Name>
        <String>1234.5</String>
      </Simple>
    </Simple>
  </Tag>
`;
  const xml = wrap(foreign(111), legacyGlobal, legacySub);

  it('moves ENCODE, GRAIN and trims into a flat video track group and leaves SOURCE, VERSION, ENCODED_AT', () => {
    const out = merge(xml) as string;
    const global = out.slice(out.indexOf('<Targets/>'));
    const globalOnly = global.slice(0, global.indexOf('</Tag>'));
    for (const name of ['SOURCE', 'VERSION', 'ENCODED_AT']) expect(globalOnly).toContain(`<Name>${name}</Name>`);
    for (const name of ['ENCODE', 'GRAIN', 'STREAM_END_TRIM', 'CRF', 'APPLIED']) {
      expect(globalOnly).not.toContain(`<Name>${name}</Name>`);
    }
    expect(globalOnly).toContain('<String>dev</String>');
    const video = out.slice(out.indexOf('<TrackUID>111'), out.indexOf('<TrackUID>222'));
    for (const [name, value] of [
      ['VIDEO_CODEC', 'av1'], ['CRF', '22'], ['PRESET', '4'], ['CONTENT_KIND', 'LIVE_ACTION'],
      ['OUTPUT_RESOLUTION', '1280x536'], ['GRAIN_APPLIED', 'no'], ['GRAIN_DECIDED_BY', 'gate'],
      ['STREAM_END_TRIM', '6011.500'],
    ]) {
      expect(video).toMatch(new RegExp(`<Name>${name}</Name>\\s*<String>${value}</String>`));
    }
    expect(video).toContain('<Name>BPS</Name>');
    expect(out).not.toContain('<Name>ENCODE</Name>');
    expect(out).not.toContain('<Name>GRAIN</Name>');
    expect(out).toContain('<String>Fantastic Four</String>');
  });

  it('drops the provider prefix from a track SOURCE and nothing else', () => {
    const out = merge(xml) as string;
    expect(out).toContain('<String>Fantastic.Four.2005.m720p.BluRay.x264-FQX.srt</String>');
    expect(out).not.toContain('subdivx:');
    expect(out).toContain('<String>-250</String>');
    expect(out).toContain('<String>1234.5</String>');
    expect(out).toContain('<String>subdivx</String>');
  });

  it('keeps an existing video group child over the moved value and completes the rest', () => {
    const existing = `  <Tag>
    <Targets>
      <TrackUID>111</TrackUID>
    </Targets>
    <Simple>
      <Name>PERCEPTOR</Name>
      <Simple>
        <Name>CRF</Name>
        <String>18</String>
      </Simple>
    </Simple>
  </Tag>
`;
    const out = merge(wrap(legacyGlobal, existing)) as string;
    expect(count(out, '<Name>CRF</Name>')).toBe(1);
    expect(out).toContain('<String>18</String>');
    expect(out).not.toContain('<String>22</String>');
    expect(out).toMatch(/<Name>PRESET<\/Name>\s*<String>4<\/String>/);
  });

  it('is unchanged on the second pass over its own output', () => {
    const once = merge(xml) as string;
    expect(merge(once)).toBe('unchanged');
  });

  it('leaves a track group without a provider prefix untouched', () => {
    expect(merge(wrap(legacySub.replace('subdivx:', '')))).toBe('unchanged');
  });

  it('matches legacy-prefixed flat track rows to api facts by the stripped SOURCE', () => {
    const flat = trackFlat(222, 'Fantastic.Four.srt', '0');
    const out = merge(wrap(flat), {
      tracks: [{ source: 'subdivx:Fantastic.Four.srt', provider: 'subdivx', syncScore: 9.5 }],
    }) as string;
    expect(out).toMatch(/<Name>SYNC_SCORE<\/Name>\s*<String>9\.5<\/String>/);
  });
});
