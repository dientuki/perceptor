// A film-rate subtitle is accepted only if its file is rewritten to the video's
// clock. A ratio that matches when it should not, or a rescale that drifts or
// damages the text, embeds a subtitle that is silently wrong (Article IX).

// Spec 121, REQ-18

import { filmRateRatio, rescaleSrt, FILM_RATE_RATIOS } from './film-rate';

describe('filmRateRatio', () => {
  it('returns the exact ratio for a report within 0.0005 of either', () => {
    expect(filmRateRatio(1.001)).toBe(FILM_RATE_RATIOS[0]);
    expect(filmRateRatio(0.999)).toBe(FILM_RATE_RATIOS[1]);
    expect(FILM_RATE_RATIOS[0]).toBe(24 / 23.976);
    expect(FILM_RATE_RATIOS[1]).toBe(23.976 / 24);
  });

  it('returns null for 1.0 and for a PAL ratio', () => {
    expect(filmRateRatio(1)).toBeNull();
    expect(filmRateRatio(1.043)).toBeNull();
  });
});

describe('rescaleSrt', () => {
  it('multiplies both times of a cue by the ratio with millisecond rounding', () => {
    const out = rescaleSrt(
      '1\n01:00:00,000 --> 01:00:01,000\nhi\n',
      24 / 23.976,
    );
    expect(out).toBe('1\n01:00:03,604 --> 01:00:04,605\nhi\n');
  });

  it('touches nothing but the cue times', () => {
    const src =
      '1\r\n00:00:01,000 --> 00:00:02,000\r\nline 12:34:56,789\r\n\r\n2\r\n00:00:03,000 --> 00:00:04,000\r\n-->x\r\n';
    const out = rescaleSrt(src, 1);
    expect(out).toBeNull();
    const ok = rescaleSrt(
      '1\r\n00:00:01,000 --> 00:00:02,000\r\nline 12:34:56,789\r\n\r\n2\r\n00:00:03,000 --> 00:00:04,000\r\nend\r\n',
      1,
    );
    expect(ok).toBe(
      '1\r\n00:00:01,000 --> 00:00:02,000\r\nline 12:34:56,789\r\n\r\n2\r\n00:00:03,000 --> 00:00:04,000\r\nend\r\n',
    );
  });

  it('returns null when a timing line does not parse', () => {
    expect(rescaleSrt('1\n00:00:01,000 --> garbage\nx\n', 1.001)).toBeNull();
  });
});
