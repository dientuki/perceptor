// Defends against syncing against the wrong reference: a forced track holds
// only a few cues and would shift every offset, and a stream specifier counted
// by absolute index instead of within its type points ffsubsync at the wrong
// stream with no error.

import { describe, expect, it } from 'vitest';
import { pickSyncReference } from './sync-reference';

const video = { index: 0, codec_type: 'video', codec_name: 'h264' };
const audio = (index: number, isDefault = 0) => ({
  index,
  codec_type: 'audio',
  codec_name: 'eac3',
  disposition: { default: isDefault },
});
const sub = (index: number, codec_name: string, forced = 0) => ({
  index,
  codec_type: 'subtitle',
  codec_name,
  disposition: { forced },
});

describe('pickSyncReference', () => {
  it('skips a forced text track for the next text track', () => {
    const result = pickSyncReference([video, audio(1), sub(2, 'subrip', 1), sub(3, 'subrip')]);
    expect(result).toEqual({ kind: 'SUBTITLE', streamSpec: 's:1' });
  });

  it('counts the specifier within subtitle streams, not by absolute index', () => {
    const result = pickSyncReference([video, audio(1), audio(2), sub(3, 'hdmv_pgs_subtitle'), sub(4, 'ass')]);
    expect(result).toEqual({ kind: 'SUBTITLE', streamSpec: 's:1' });
  });

  it('falls back to audio when the only subtitles are PGS', () => {
    const result = pickSyncReference([video, audio(1), sub(2, 'hdmv_pgs_subtitle')]);
    expect(result).toEqual({ kind: 'AUDIO', streamSpec: 'a:0' });
  });

  it('falls back to audio when the only text track is forced', () => {
    const result = pickSyncReference([video, audio(1), sub(2, 'subrip', 1)]);
    expect(result).toEqual({ kind: 'AUDIO', streamSpec: 'a:0' });
  });

  it('prefers the default audio over the first audio, counted within audio streams', () => {
    const result = pickSyncReference([video, audio(1), audio(2, 1)]);
    expect(result).toEqual({ kind: 'AUDIO', streamSpec: 'a:1' });
  });

  it('uses the first audio when none is default', () => {
    const result = pickSyncReference([video, audio(1), audio(2)]);
    expect(result).toEqual({ kind: 'AUDIO', streamSpec: 'a:0' });
  });

  it('returns null when there is no subtitle or audio', () => {
    expect(pickSyncReference([video])).toBeNull();
    expect(pickSyncReference([])).toBeNull();
  });
});
