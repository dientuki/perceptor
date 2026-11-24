// Subdivx serves Windows-1252 and ISO-8859-1 subtitles. Staged as they come,
// the worker reads them as UTF-8 and every accented letter becomes U+FFFD with
// no error anywhere, so the embedded track shows garbage.

import { toUtf8 } from './to-utf8';

describe('toUtf8', () => {
  it('turns a Windows-1252 0xE1 into a', () => {
    const out = toUtf8(
      Buffer.from([0x63, 0x61, 0x6e, 0x63, 0x69, 0xf3, 0x6e, 0xe1]),
    );
    expect(out.toString('utf8')).toBe('canción' + 'á');
  });

  it('leaves valid UTF-8 byte for byte unchanged', () => {
    const input = Buffer.from('Niño canción', 'utf8');
    expect(toUtf8(input).equals(input)).toBe(true);
  });

  it('strips a UTF-8 BOM', () => {
    const out = toUtf8(
      Buffer.concat([
        Buffer.from([0xef, 0xbb, 0xbf]),
        Buffer.from('Hola', 'utf8'),
      ]),
    );
    expect(out.toString('utf8')).toBe('Hola');
    expect(out[0]).toBe(0x48);
  });

  it('decodes UTF-16LE with a BOM to UTF-8 without one', () => {
    const input = Buffer.concat([
      Buffer.from([0xff, 0xfe]),
      Buffer.from('Ñandú', 'utf16le'),
    ]);
    expect(toUtf8(input).toString('utf8')).toBe('Ñandú');
  });
});
