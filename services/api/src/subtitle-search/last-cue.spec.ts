// The coverage rule trusts this parser for where a subtitle ends. A parser
// that returns a wrong end, or a number for a file with no cues, lets a
// truncated subtitle be accepted with no error anywhere.

import { lastCueEndMs } from './last-cue';

describe('lastCueEndMs', () => {
  it('returns the end of the last cue of a fixture', () => {
    const srt = [
      '1',
      '00:00:01,000 --> 00:00:02,500',
      'Hello',
      '',
      '2',
      '01:02:03,045 --> 01:02:04,5',
      'Bye',
      '',
    ].join('\r\n');
    expect(lastCueEndMs(srt)).toBe(3_724_500);
  });

  it('returns the latest end even when cues are out of order', () => {
    const srt =
      '1\n00:10:00,000 --> 00:10:05,000\nA\n\n2\n00:00:01,000 --> 00:00:02,000\nB\n';
    expect(lastCueEndMs(srt)).toBe(605_000);
  });

  it('returns null for a file with no cue', () => {
    expect(lastCueEndMs('not a subtitle')).toBeNull();
    expect(lastCueEndMs('')).toBeNull();
  });
});
