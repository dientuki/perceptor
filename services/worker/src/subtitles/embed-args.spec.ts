// Defends against an mkvmerge command that silently changes the wrong track:
// a default flag cleared on audio, a flag left on an old subtitle so two are
// default, new tracks ahead of the original, or a --sync that shifts timing
// twice. mkvmerge accepts all of these and exits 0.

import { describe, expect, it } from 'vitest';
import { buildEmbedArgs, type EmbedTrack } from './embed-args';

const streams = [
  { index: 0, codec_type: 'video' },
  { index: 1, codec_type: 'audio' },
  { index: 2, codec_type: 'subtitle' },
  { index: 3, codec_type: 'subtitle' },
];

const track = (over: Partial<EmbedTrack> = {}): EmbedTrack => ({
  normalizedPath: '/tmp/x/0.srt',
  languageIso3: 'spa',
  trackTitle: 'Español',
  isDefault: false,
  isForced: false,
  ...over,
});

const build = (tracks: EmbedTrack[]) =>
  buildEmbedArgs({
    originalPath: '/lib/Film.mkv',
    partPath: '/lib/Film.mkv.part.mkv',
    originalStreams: streams,
    tracks,
  });

describe('buildEmbedArgs', () => {
  it('puts the output first, then the original, then the new tracks in request order', () => {
    const args = build([
      track({ normalizedPath: '/tmp/x/0.srt', languageIso3: 'spa' }),
      track({ normalizedPath: '/tmp/x/1.srt', languageIso3: 'eng', trackTitle: 'English' }),
    ]);
    expect(args.slice(0, 3)).toEqual(['-o', '/lib/Film.mkv.part.mkv', '/lib/Film.mkv']);
    expect(args.indexOf('/tmp/x/0.srt')).toBeLessThan(args.indexOf('/tmp/x/1.srt'));
    expect(args.indexOf('/lib/Film.mkv')).toBeLessThan(args.indexOf('/tmp/x/0.srt'));
    expect(args).toContain('0:spa');
    expect(args).toContain('0:eng');
  });

  it('clears the default flag of every pre-existing subtitle when a new track is default', () => {
    const args = build([track({ isDefault: true })]);
    const pairs = args.flatMap((a, i) => (a === '--default-track-flag' ? [args[i + 1]] : []));
    expect(pairs).toContain('2:0');
    expect(pairs).toContain('3:0');
    expect(pairs).toContain('0:1');
    expect(args.indexOf('2:0')).toBeLessThan(args.indexOf('/lib/Film.mkv'));
  });

  it('never names an audio or video track', () => {
    const args = build([track({ isDefault: true })]);
    const flags = args.flatMap((a, i) => (a === '--default-track-flag' ? [args[i + 1]] : []));
    expect(flags).toEqual(['2:0', '3:0', '0:1']);
    const beforeOriginal = args.slice(0, args.indexOf('/lib/Film.mkv'));
    expect(beforeOriginal.filter((a) => a.startsWith('0:') || a.startsWith('1:'))).toEqual([]);
  });

  it('does not mention existing tracks when no new track is default', () => {
    const args = build([track(), track({ normalizedPath: '/tmp/x/1.srt' })]);
    const values = args.flatMap((a, i) => (a === '--default-track-flag' ? [args[i + 1]] : []));
    expect(values).toEqual(['0:0', '0:0']);
    expect(args).not.toContain('2:0');
    expect(args).not.toContain('3:0');
  });

  it('maps the forced flag per track and writes UTF-8 charset and track title', () => {
    const args = build([track({ isForced: true })]);
    expect(args[args.indexOf('--forced-display-flag') + 1]).toBe('0:1');
    expect(args[args.indexOf('--track-name') + 1]).toBe('0:Español');
    expect(args[args.indexOf('--sub-charset') + 1]).toBe('0:UTF-8');
    expect(build([track()])[build([track()]).indexOf('--forced-display-flag') + 1]).toBe('0:0');
  });

  it('never passes --sync', () => {
    expect(build([track({ isDefault: true, isForced: true })])).not.toContain('--sync');
  });

  it('puts --tags right before the track file when tagsPath is set, and nowhere else', () => {
    const args = build([
      track({ normalizedPath: '/tmp/x/0.srt', tagsPath: '/tmp/x/0.tags.xml' }),
      track({ normalizedPath: '/tmp/x/1.srt' }),
    ]);
    const i = args.indexOf('--tags');
    expect(args.slice(i, i + 3)).toEqual(['--tags', '0:/tmp/x/0.tags.xml', '/tmp/x/0.srt']);
    expect(args.filter((a) => a === '--tags')).toHaveLength(1);
  });
});
