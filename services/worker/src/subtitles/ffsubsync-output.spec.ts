// Defends against a wrong sync offset reaching the embed with no error: a flipped sign shifts every
// cue twice as far from the audio as the delay it was meant to undo, and a log with a value missing
// must read as a failure rather than as an offset of zero. The fixtures are real ffsubsync 0.5.1
// stderr, captured against a subtitle delayed by +2 s.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parseFfsubsyncOutput } from './ffsubsync-output';

const fixture = (name: string) => readFileSync(join(__dirname, 'fixtures', name), 'utf8');

describe('parseFfsubsyncOutput', () => {
  it('parses a subtitle-reference log and keeps the correction sign (+2 s delay gives -2000)', () => {
    const result = parseFfsubsyncOutput(fixture('ffsubsync-subtitle-reference-delayed-2s.log'));
    expect(result).toEqual({ offsetMs: -2000, framerateRatio: 1, score: 5702 });
  });

  it('parses an audio-reference log, ignoring the progress bar', () => {
    const result = parseFfsubsyncOutput(fixture('ffsubsync-audio-reference-delayed-2s.log'));
    expect(result).toEqual({ offsetMs: -1960, framerateRatio: 0.999, score: 2944 });
    expect(Math.abs(result!.offsetMs + 2000)).toBeLessThan(100);
  });

  it('returns null on a log truncated before the framerate line', () => {
    const log = fixture('ffsubsync-subtitle-reference-delayed-2s.log');
    const truncated = log.slice(0, log.indexOf('framerate scale factor'));
    expect(parseFfsubsyncOutput(truncated)).toBeNull();
  });

  it('returns null on a log truncated before the score line', () => {
    const log = fixture('ffsubsync-audio-reference-delayed-2s.log');
    expect(parseFfsubsyncOutput(log.slice(0, log.indexOf('score:')))).toBeNull();
  });

  it('returns null on empty output', () => {
    expect(parseFfsubsyncOutput('')).toBeNull();
  });
});
