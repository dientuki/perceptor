// Defends against the disc scan reporting the wrong files: a clip or sample left
// as a loose video makes api pick it as the film (or leaves the folder alive),
// and an ambiguous disc guessed instead of failed files a wrong movie silently.
// Runs on real playlist files in a temp folder, written by a test-local writer.

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { findDiscRoots } from './find-disc';
import { scanDisc } from './scan-disc';
import { KeyedError } from '../i18n/keyed-error';
import type { InventoriedFile } from '../scan/mark-downloaded';

function writeMpls(items: { clip: string; outTicks: number }[], marks: number[]): Buffer {
  const itemBufs = items.map((it) => {
    const body = Buffer.alloc(22);
    body.write(it.clip, 0, 'ascii');
    body.write('M2TS', 5, 'ascii');
    body.writeUInt32BE(0, 12);
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
  header.write('MPLS0200', 0, 'ascii');
  header.writeUInt32BE(20, 8);
  header.writeUInt32BE(20 + playList.length + playListBody.length, 12);
  return Buffer.concat([header, playList, playListBody, markBuf]);
}

let root: string;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'scan-disc-'));
  await mkdir(join(root, 'BDMV', 'PLAYLIST'), { recursive: true });
  await mkdir(join(root, 'BDMV', 'STREAM'), { recursive: true });
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

async function put(relative: string, content: Buffer | string = 'x'): Promise<InventoriedFile> {
  const filePath = join(root, relative);
  await writeFile(filePath, content);
  return {
    filePath,
    fileName: relative.split('/').pop()!,
    size: Buffer.byteLength(content),
    isVideo: /\.(mkv|ts)$/.test(relative),
    isDownloaded: true,
  };
}

function discOf(files: InventoriedFile[]) {
  const roots = findDiscRoots(files.map((file) => file.filePath));
  expect(roots).toHaveLength(1);
  return roots[0];
}

describe('scanDisc', () => {
  it('flags only the winning playlist as video and ignores a sibling sample.mkv', async () => {
    const files = [
      await put('BDMV/PLAYLIST/00800.mpls', writeMpls([{ clip: '00001', outTicks: 9_000_000 }], [1])),
      await put('BDMV/PLAYLIST/00801.mpls', writeMpls([{ clip: '00002', outTicks: 90_000 }], [])),
      await put('BDMV/STREAM/00001.m2ts'),
      await put('BDMV/STREAM/00002.m2ts'),
      await put('sample.mkv'),
    ];

    const result = await scanDisc(discOf(files), files);

    expect(result.outcome).toBe('match');
    expect(result.matches).toEqual([
      { filePath: join(root, 'BDMV/PLAYLIST/00800.mpls'), seasonNumber: null, episodeNumber: null },
    ]);
    const videos = result.files.filter((file) => file.isVideo).map((file) => file.fileName);
    expect(videos).toEqual(['00800.mpls']);
    expect(result.files).toHaveLength(files.length);
  });

  it('reports every m2ts as video and no match when a clip is not downloaded', async () => {
    const files = [
      await put('BDMV/PLAYLIST/00800.mpls', writeMpls([{ clip: '00001', outTicks: 9_000_000 }], [1])),
      await put('BDMV/STREAM/00001.m2ts'),
      await put('BDMV/STREAM/00002.m2ts'),
      await put('sample.mkv'),
    ];
    files[1] = { ...files[1], isDownloaded: false };

    const result = await scanDisc(discOf(files), files);

    expect(result.outcome).toBe('none');
    expect(result.matches).toEqual([]);
    const videos = result.files.filter((file) => file.isVideo).map((file) => file.fileName).sort();
    expect(videos).toEqual(['00001.m2ts', '00002.m2ts']);
  });

  it('treats a playlist that fails to parse as unplayable instead of failing the scan', async () => {
    const files = [
      await put('BDMV/PLAYLIST/00800.mpls', Buffer.from('garbage')),
      await put('BDMV/PLAYLIST/00801.mpls', writeMpls([{ clip: '00001', outTicks: 9_000_000 }], [1])),
      await put('BDMV/STREAM/00001.m2ts'),
    ];

    const result = await scanDisc(discOf(files), files);

    expect(result.matches.map((match) => match.filePath)).toEqual([
      join(root, 'BDMV/PLAYLIST/00801.mpls'),
    ]);
  });

  it('throws the ambiguous key with the sorted playlists param on an unbreakable tie', async () => {
    const same = writeMpls([{ clip: '00001', outTicks: 9_000_000 }], [1]);
    const files = [
      await put('BDMV/PLAYLIST/00801.mpls', same),
      await put('BDMV/PLAYLIST/00800.mpls', same),
      await put('BDMV/STREAM/00001.m2ts'),
    ];

    const error = await scanDisc(discOf(files), files).catch((e) => e);

    expect(error).toBeInstanceOf(KeyedError);
    expect(error.key).toBe('error.source.disc_playlist_ambiguous');
    expect(error.params).toEqual({ playlists: '00800.mpls, 00801.mpls' });
  });
});
