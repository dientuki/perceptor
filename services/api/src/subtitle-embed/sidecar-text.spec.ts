import { lastCueEndMs } from '@/subtitle-search/last-cue';
import { decodeSidecar } from './sidecar-text';

const SRT =
  '1\r\n00:00:01,000 --> 00:00:03,500\r\nHola\r\n\r\n2\r\n01:02:03,250 --> 01:02:05,999\r\nChau\r\n';
const EXPECTED = 3_725_999;

function utf16be(text: string): Buffer {
  const le = Buffer.from(text, 'utf16le');
  return Buffer.from(le).swap16();
}

// This suite exists because a valid UTF-16 or BOM-prefixed sidecar read as
// garbage makes lastCueEndMs return null, and the embed is then rejected as
// "incomplete" with no error anywhere pointing at the encoding (Article IX,
// Spec 113, T003).
describe('decodeSidecar', () => {
  const fixtures: Array<[string, Buffer]> = [
    ['UTF-8', Buffer.from(SRT, 'utf8')],
    [
      'UTF-8 with BOM',
      Buffer.concat([
        Buffer.from([0xef, 0xbb, 0xbf]),
        Buffer.from(SRT, 'utf8'),
      ]),
    ],
    [
      'UTF-16LE with BOM',
      Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(SRT, 'utf16le')]),
    ],
    [
      'UTF-16BE with BOM',
      Buffer.concat([Buffer.from([0xfe, 0xff]), utf16be(SRT)]),
    ],
  ];

  it.each(fixtures)('yields the same last cue for %s', (_name, buf) => {
    expect(lastCueEndMs(decodeSidecar(buf))).toBe(EXPECTED);
  });

  it('strips the BOM from the decoded text', () => {
    for (const [, buf] of fixtures) {
      expect(decodeSidecar(buf).charCodeAt(0)).not.toBe(0xfeff);
    }
  });

  it('falls back to UTF-8 for a Latin-1 file, whose timings are ASCII', () => {
    expect(
      lastCueEndMs(
        decodeSidecar(Buffer.from(SRT.replace('Hola', 'Ni\xf1o'), 'latin1')),
      ),
    ).toBe(EXPECTED);
  });
});
