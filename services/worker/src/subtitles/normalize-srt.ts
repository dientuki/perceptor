import { KeyedError } from '../i18n/keyed-error';
import { renderMessage } from '../i18n/messages.en';
import {
  ERROR_SUBTITLE_EMBED_CHARSET_UNDETECTED,
  ERROR_SUBTITLE_EMBED_REMUX_FAILED,
} from '../i18n/error-keys';

// Bytes the windows-1252 table leaves undefined; a file holding one is not
// reliably cp1252, so it is refused instead of guessed.
const UNDEFINED_CP1252 = new Set([0x81, 0x8d, 0x8f, 0x90, 0x9d]);

const TIMING = /(\d+):(\d{2}):(\d{2})[,.](\d{1,3})\s*-->\s*(\d+):(\d{2}):(\d{2})[,.](\d{1,3})/;

interface Cue {
  start: number;
  end: number;
  text: string[];
}

function decode(bytes: Uint8Array, fileName: string): string {
  const buf = Buffer.from(bytes);

  if (buf.length >= 3 && buf[0] === 0xef && buf[1] === 0xbb && buf[2] === 0xbf) {
    return new TextDecoder('utf-8').decode(buf);
  }
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(buf);
  } catch {
    // not UTF-8, fall through to the next candidate
  }

  if (buf.length >= 2 && buf[0] === 0xff && buf[1] === 0xfe) {
    return new TextDecoder('utf-16le').decode(buf);
  }
  if (buf.length >= 2 && buf[0] === 0xfe && buf[1] === 0xff) {
    return new TextDecoder('utf-16be').decode(buf);
  }

  for (const byte of buf) {
    if (UNDEFINED_CP1252.has(byte)) {
      throw new KeyedError(
        ERROR_SUBTITLE_EMBED_CHARSET_UNDETECTED,
        renderMessage(ERROR_SUBTITLE_EMBED_CHARSET_UNDETECTED, { file: fileName }),
        { file: fileName },
      );
    }
  }
  return new TextDecoder('windows-1252').decode(buf);
}

function toMs(h: string, m: string, s: string, ms: string): number {
  return (
    Number(h) * 3_600_000 + Number(m) * 60_000 + Number(s) * 1000 + Number(ms.padEnd(3, '0'))
  );
}

function parseCues(text: string): Cue[] {
  const cues: Cue[] = [];
  const blocks = text.replace(/\r\n?/g, '\n').split(/\n{2,}/);
  for (const block of blocks) {
    const lines = block.split('\n');
    const at = lines.findIndex((line) => TIMING.test(line));
    if (at === -1) continue;
    const match = TIMING.exec(lines[at]) as RegExpExecArray;
    cues.push({
      start: toMs(match[1], match[2], match[3], match[4]),
      end: toMs(match[5], match[6], match[7], match[8]),
      text: lines.slice(at + 1).filter((line, i, all) => line !== '' || i < all.length - 1),
    });
  }
  return cues;
}

function format(ms: number): string {
  const h = Math.floor(ms / 3_600_000);
  const m = Math.floor((ms % 3_600_000) / 60_000);
  const s = Math.floor((ms % 60_000) / 1000);
  const milli = ms % 1000;
  const pad = (n: number, w: number) => String(n).padStart(w, '0');
  return `${pad(h, 2)}:${pad(m, 2)}:${pad(s, 2)},${pad(milli, 3)}`;
}

// Spec 101, REQ-7 REQ-8
export function normalizeSrt(bytes: Uint8Array, offsetMs: number, fileName: string): string {
  const text = decode(bytes, fileName).replace(/^﻿/, '');

  const shifted: Cue[] = [];
  for (const cue of parseCues(text)) {
    const end = cue.end + offsetMs;
    if (end <= 0) continue;
    shifted.push({ start: Math.max(0, cue.start + offsetMs), end, text: cue.text });
  }

  if (shifted.length === 0) {
    const detail = `subtitle file ${fileName} has no cues left after applying the offset`;
    throw new KeyedError(
      ERROR_SUBTITLE_EMBED_REMUX_FAILED,
      renderMessage(ERROR_SUBTITLE_EMBED_REMUX_FAILED, { detail }),
      { detail },
    );
  }

  return (
    shifted
      .map((cue, i) => `${i + 1}\n${format(cue.start)} --> ${format(cue.end)}\n${cue.text.join('\n')}`)
      .join('\n\n') + '\n'
  );
}
