// Defends against a subtitle that embeds with mojibake (a cp1252 file read as
// UTF-8 turns "¿Señor?" into replacement characters), a BOM left in the first
// cue, an offset that writes a negative timestamp, and an empty track — each
// of which produces a job marked completed and a track nobody can read.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { ERROR_SUBTITLE_EMBED_CHARSET_UNDETECTED, ERROR_SUBTITLE_EMBED_REMUX_FAILED } from '../i18n/error-keys';
import { normalizeSrt } from './normalize-srt';

const fixture = (name: string) => readFileSync(join(__dirname, 'fixtures', name));
const srt = (text: string) => Buffer.from(text, 'utf-8');

function keyOf(fn: () => unknown): string | undefined {
  try {
    fn();
  } catch (error) {
    return (error as { key?: string }).key;
  }
  return undefined;
}

describe('normalizeSrt — charset', () => {
  it('decodes a real cp1252 file with its accented characters intact', () => {
    const out = normalizeSrt(fixture('cp1252.srt'), 0, 'cp1252.srt');
    expect(out).toContain('¿Señor? Qué día');
    expect(out).toContain('Adiós, canción');
    expect(out).not.toContain('�');
  });

  it('drops a UTF-8 BOM and keeps the text', () => {
    const out = normalizeSrt(fixture('utf8-bom.srt'), 0, 'utf8-bom.srt');
    expect(out.charCodeAt(0)).not.toBe(0xfeff);
    expect(out.startsWith('1\n00:00:01,000 --> 00:00:02,000\nHola ñandú')).toBe(true);
  });

  it('refuses a file holding 0x81 as charset_undetected', () => {
    expect(keyOf(() => normalizeSrt(fixture('undetectable-0x81.srt'), 0, 'x.srt'))).toBe(
      ERROR_SUBTITLE_EMBED_CHARSET_UNDETECTED,
    );
  });

  it('decodes UTF-16 LE with a BOM', () => {
    const body = Buffer.from('﻿1\n00:00:01,000 --> 00:00:02,000\nñ\n', 'utf16le');
    expect(normalizeSrt(body, 0, 'x.srt')).toContain('ñ');
  });
});

describe('normalizeSrt — offset', () => {
  const two = '1\n00:00:01,000 --> 00:00:03,000\nfirst\n\n2\n00:00:10,000 --> 00:00:12,000\nsecond\n';

  it('shifts start and end forward by a positive offset', () => {
    const out = normalizeSrt(srt(two), 1200, 'x.srt');
    expect(out).toContain('00:00:02,200 --> 00:00:04,200');
    expect(out).toContain('00:00:11,200 --> 00:00:13,200');
  });

  it('drops a cue that ends at or before zero and renumbers from 1', () => {
    const out = normalizeSrt(srt(two), -5000, 'x.srt');
    expect(out).not.toContain('first');
    expect(out.startsWith('1\n00:00:05,000 --> 00:00:07,000\nsecond')).toBe(true);
  });

  it('clamps a cue that straddles zero to start at zero', () => {
    const out = normalizeSrt(srt(two), -2000, 'x.srt');
    expect(out).toContain('1\n00:00:00,000 --> 00:00:01,000\nfirst');
  });

  it('fails with remux_failed when no cue survives the shift', () => {
    expect(keyOf(() => normalizeSrt(srt(two), -600000, 'x.srt'))).toBe(
      ERROR_SUBTITLE_EMBED_REMUX_FAILED,
    );
  });
});

describe('normalizeSrt — parsing', () => {
  it('parses CRLF, dot separators and a missing trailing blank line, emitting LF', () => {
    const out = normalizeSrt(
      srt('1\r\n00:00:01.500 --> 00:00:02.000\r\nline a\r\nline b\r\n\r\n2\r\n00:00:03,000 --> 00:00:04,000\r\nlast'),
      0,
      'x.srt',
    );
    expect(out).toBe(
      '1\n00:00:01,500 --> 00:00:02,000\nline a\nline b\n\n2\n00:00:03,000 --> 00:00:04,000\nlast\n',
    );
    expect(out).not.toContain('\r');
  });
});
