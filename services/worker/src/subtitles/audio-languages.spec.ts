// Defends against reporting audio languages the file does not really declare
// (und, empty or untagged tracks), a /T code that never matches the /B code
// api stores, or a subtitle/video track leaking into the audio list.

import { describe, expect, it } from 'vitest';
import { audioLanguages } from './audio-languages';

const stream = (codec_type: string, language?: string) => ({
  codec_type,
  tags: language === undefined ? {} : { language },
});

describe('audioLanguages', () => {
  it('drops und', () => {
    expect(audioLanguages([stream('audio', 'und'), stream('audio', 'eng')])).toEqual(['eng']);
  });

  it('drops an empty language tag', () => {
    expect(audioLanguages([stream('audio', ''), stream('audio', 'spa')])).toEqual(['spa']);
  });

  it('drops an untagged audio track', () => {
    expect(audioLanguages([stream('audio'), { codec_type: 'audio' }, stream('audio', 'jpn')])).toEqual(['jpn']);
  });

  it('reports fra as fre', () => {
    expect(audioLanguages([stream('audio', 'fra')])).toEqual(['fre']);
  });

  it('ignores subtitle and video streams', () => {
    expect(
      audioLanguages([stream('subtitle', 'spa'), stream('video', 'jpn'), stream('audio', 'eng')]),
    ).toEqual(['eng']);
  });

  it('merges duplicates in stream order', () => {
    expect(
      audioLanguages([stream('audio', 'spa'), stream('audio', 'eng'), stream('audio', 'spa'), stream('audio', 'fra'), stream('audio', 'fre')]),
    ).toEqual(['spa', 'eng', 'fre']);
  });
});
