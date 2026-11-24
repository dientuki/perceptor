// A Subdivx download is untrusted bytes. A wrong pick embeds the wrong
// episode's subtitle, and a missing cap lets one download exhaust the api's
// memory, both with no error anywhere. Zip is built in memory and the rar is a
// committed fixture (no rar tool exists to build one).

import { readFileSync } from 'fs';
import { join } from 'path';
import { zipSync, strToU8 } from 'fflate';
import { extractSrt } from './archive';

const SRT = '1\n00:00:01,000 --> 00:00:02,000\nHola\n\n';

function zip(files: Record<string, string | Uint8Array>): Buffer {
  const input: Record<string, Uint8Array> = {};
  for (const [name, content] of Object.entries(files)) {
    input[name] = typeof content === 'string' ? strToU8(content) : content;
  }
  return Buffer.from(zipSync(input));
}

describe('extractSrt', () => {
  it('returns the only srt of a zip', async () => {
    const r = await extractSrt(zip({ 'a.srt': SRT, 'readme.txt': 'x' }));
    expect(r).toEqual({ srt: Buffer.from(SRT), entryName: 'a.srt' });
  });

  it('picks the entry carrying the target SxxEyy out of several', async () => {
    const r = await extractSrt(
      zip({
        'Show.S01E01.srt': 'one',
        'Show.S01E02.srt': 'two',
        'Show.S01E12.srt': 'twelve',
      }),
      { season: 1, episode: 2 },
    );
    expect(r).toEqual({
      srt: Buffer.from('two'),
      entryName: 'Show.S01E02.srt',
    });
  });

  it('rejects several srts when no episode is given', async () => {
    const r = await extractSrt(zip({ 'a.srt': 'a', 'b.srt': 'b' }));
    expect(r).toEqual({ rejected: true });
  });

  it('rejects an ambiguous set where two entries carry the episode', async () => {
    const r = await extractSrt(
      zip({ 'Show.S01E02.es.srt': 'a', 'Show.S01E02.latino.srt': 'b' }),
      { season: 1, episode: 2 },
    );
    expect(r).toEqual({ rejected: true });
  });

  it('rejects an archive holding only a .sub', async () => {
    expect(await extractSrt(zip({ 'a.sub': 'x', 'a.idx': 'y' }))).toEqual({
      rejected: true,
    });
  });

  it('rejects a path escaping the staging folder', async () => {
    expect(await extractSrt(zip({ '../evil.srt': SRT }))).toEqual({
      rejected: true,
    });
  });

  it('ignores __MACOSX and dot-files', async () => {
    const r = await extractSrt(
      zip({ 'a.srt': SRT, '__MACOSX/._a.srt': 'x', '.hidden.srt': 'y' }),
    );
    expect(r).toEqual({ srt: Buffer.from(SRT), entryName: 'a.srt' });
  });

  it('rejects more than 500 entries', async () => {
    const files: Record<string, string> = { 'a.srt': SRT };
    for (let i = 0; i < 500; i++) files[`f${i}.txt`] = 'x';
    expect(await extractSrt(zip(files))).toEqual({ rejected: true });
  });

  it('rejects a declared total over 20 MB', async () => {
    const big = new Uint8Array(21 * 1024 * 1024);
    expect(await extractSrt(zip({ 'a.srt': SRT, 'big.bin': big }))).toEqual({
      rejected: true,
    });
  });

  it('rejects corrupt archive bytes instead of throwing', async () => {
    const bad = Buffer.concat([
      Buffer.from([0x50, 0x4b, 0x03, 0x04]),
      Buffer.from('garbage'),
    ]);
    expect(await extractSrt(bad)).toEqual({ rejected: true });
    const badRar = Buffer.concat([
      Buffer.from([0x52, 0x61, 0x72, 0x21, 0x1a, 0x07, 0x01, 0x00]),
      Buffer.from('garbage'),
    ]);
    expect(await extractSrt(badRar)).toEqual({ rejected: true });
  });

  it('passes a plain srt through unchanged', async () => {
    const r = await extractSrt(Buffer.from(SRT));
    expect(r).toEqual({ srt: Buffer.from(SRT), entryName: '' });
  });

  it('extracts the srt of a committed rar fixture', async () => {
    const rar = readFileSync(join(__dirname, '__fixtures__', 'single.rar'));
    const r = await extractSrt(rar, { season: 1, episode: 2 });
    expect(r).toMatchObject({ entryName: 'Show.S01E02.es.srt' });
    expect('srt' in r && r.srt.toString()).toContain('Hola desde rar');
  });
});
