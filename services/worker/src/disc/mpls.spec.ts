// Defends against a mis-read playlist: a wrong offset yields wrong clip names or
// durations, so the wrong (or no) playlist is chosen as the film's and the job
// files a scrambled movie with no error. Buffers follow the published MPLS
// layout through a test-local writer, never through the parser under test.

import { describe, expect, it } from 'vitest';
import { parseMpls } from './mpls';

interface Item { clip: string; inTicks: number; outTicks: number; extraBytes?: number }

function writeMpls(items: Item[], marks: number[], magic = 'MPLS'): Buffer {
  const itemBufs = items.map((it) => {
    const body = Buffer.alloc(22 + (it.extraBytes ?? 0));
    body.write(it.clip, 0, 'ascii');
    body.write('M2TS', 5, 'ascii');
    body.writeUInt32BE(it.inTicks, 12);
    body.writeUInt32BE(it.outTicks, 16);
    const len = Buffer.alloc(2);
    len.writeUInt16BE(body.length);
    return Buffer.concat([len, body]);
  });
  const playListBody = Buffer.concat(itemBufs);
  const playList = Buffer.alloc(10);
  playList.writeUInt32BE(playListBody.length + 6, 0);
  playList.writeUInt16BE(items.length, 6);
  const markBuf = Buffer.alloc(6 + marks.length * 14);
  markBuf.writeUInt32BE(2 + marks.length * 14, 0);
  markBuf.writeUInt16BE(marks.length, 4);
  marks.forEach((type, i) => markBuf.writeUInt8(type, 6 + i * 14 + 1));
  const header = Buffer.alloc(20);
  header.write(magic, 0, 'ascii');
  header.write('0200', 4, 'ascii');
  header.writeUInt32BE(20, 8);
  header.writeUInt32BE(20 + playList.length + playListBody.length, 12);
  return Buffer.concat([header, playList, playListBody, markBuf]);
}

describe('parseMpls', () => {
  it('returns play items in playlist order with 45 kHz tick values', () => {
    const parsed = parseMpls(
      writeMpls(
        [
          { clip: '00001', inTicks: 45_000, outTicks: 90_000 * 60 },
          { clip: '00002', inTicks: 0, outTicks: 4_000_000_000 },
        ],
        [],
      ),
    );
    expect(parsed.items).toEqual([
      { clipName: '00001', inTicks: 45_000, outTicks: 5_400_000 },
      { clipName: '00002', inTicks: 0, outTicks: 4_000_000_000 },
    ]);
  });

  it('keeps a repeated clip as separate items', () => {
    const parsed = parseMpls(
      writeMpls(
        [
          { clip: '00005', inTicks: 0, outTicks: 100 },
          { clip: '00005', inTicks: 0, outTicks: 100 },
        ],
        [],
      ),
    );
    expect(parsed.items.map((i) => i.clipName)).toEqual(['00005', '00005']);
  });

  it('steps over a play item longer than the minimum (multi-angle extras)', () => {
    const parsed = parseMpls(
      writeMpls(
        [
          { clip: '00001', inTicks: 0, outTicks: 10, extraBytes: 12 },
          { clip: '00002', inTicks: 5, outTicks: 20 },
        ],
        [1],
      ),
    );
    expect(parsed.items.map((i) => i.clipName)).toEqual(['00001', '00002']);
    expect(parsed.items[1]).toMatchObject({ inTicks: 5, outTicks: 20 });
  });

  it('counts only entry marks (type 1), not link points', () => {
    const parsed = parseMpls(
      writeMpls([{ clip: '00001', inTicks: 0, outTicks: 10 }], [1, 2, 1, 1, 3]),
    );
    expect(parsed.entryMarkCount).toBe(3);
  });

  it('reports zero entry marks for a playlist with no marks', () => {
    expect(parseMpls(writeMpls([{ clip: '00001', inTicks: 0, outTicks: 10 }], [])).entryMarkCount).toBe(0);
  });

  it('throws on a bad magic', () => {
    expect(() =>
      parseMpls(writeMpls([{ clip: '00001', inTicks: 0, outTicks: 10 }], [], 'MOBJ')),
    ).toThrow(/bad magic/);
  });

  it('throws on a truncated buffer', () => {
    const full = writeMpls([{ clip: '00001', inTicks: 0, outTicks: 10 }], [1, 1]);
    expect(() => parseMpls(full.subarray(0, full.length - 5))).toThrow(/Truncated/);
    expect(() => parseMpls(full.subarray(0, 12))).toThrow(/Truncated/);
    expect(() => parseMpls(Buffer.alloc(0))).toThrow(/Truncated/);
  });
});
