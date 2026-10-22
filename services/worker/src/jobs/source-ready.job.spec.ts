// Defends the silent-scan failure: a scan that throws without reporting
// leaves the MediaSource READY, the row reads "downloaded" forever and
// nothing appears in api. Every failure of the scan handler must reach
// sourceScanFailed with a key, and the job must then fail unrecoverably.

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { UnrecoverableError } from 'bullmq';

const { fetchGraphQLMock, scanFolderMock } = vi.hoisted(() => ({
  fetchGraphQLMock: vi.fn(),
  scanFolderMock: vi.fn(),
}));

vi.mock('../api/graphql-client', async () => {
  const actual = await vi.importActual<typeof import('../api/graphql-client')>(
    '../api/graphql-client',
  );
  return { ...actual, fetchGraphQL: (...args: unknown[]) => fetchGraphQLMock(...args) };
});
const discReads = new Map<string, Buffer>();
vi.mock('node:fs/promises', async () => {
  const actual = await vi.importActual<typeof import('node:fs/promises')>('node:fs/promises');
  return {
    ...actual,
    readFile: async (path: string, ...rest: unknown[]) =>
      discReads.get(String(path)) ?? (actual.readFile as (...a: unknown[]) => unknown)(path, ...rest),
  };
});
function mplsOf(outTicks: number, marks: number[]): Buffer {
  const item = Buffer.alloc(24);
  item.writeUInt16BE(22, 0);
  item.write('00001', 2, 'ascii');
  item.writeUInt32BE(outTicks, 20);
  const playList = Buffer.alloc(10);
  playList.writeUInt16BE(1, 6);
  const markBuf = Buffer.alloc(6 + marks.length * 14);
  markBuf.writeUInt16BE(marks.length, 4);
  marks.forEach((type, i) => markBuf.writeUInt8(type, 6 + i * 14 + 1));
  const header = Buffer.alloc(20);
  header.write('MPLS0200', 0, 'ascii');
  header.writeUInt32BE(20, 8);
  header.writeUInt32BE(20 + playList.length + item.length, 12);
  return Buffer.concat([header, playList, item, markBuf]);
}
vi.mock('../scan/scan-folder', () => ({
  scanFolder: (...args: unknown[]) => scanFolderMock(...args),
}));

import { handleSourceReady } from './source-ready.job';
import { KeyedError } from '../i18n/keyed-error';

const job = { data: { mediaSourceId: 7 } } as never;

function source(overrides: Record<string, unknown> = {}) {
  return {
    mediaSource: {
      id: 7,
      status: 'READY',
      downloadPath: '/downloads/x',
      releaseTitle: 'x',
      movieId: 1,
      episodeId: null,
      seasonId: null,
      downloadedFiles: null,
      ...overrides,
    },
  };
}

function reports() {
  return fetchGraphQLMock.mock.calls.filter(([query]) =>
    String(query).includes('sourceScanFailed'),
  );
}

beforeEach(() => {
  fetchGraphQLMock.mockReset();
  scanFolderMock.mockReset();
  discReads.clear();
});

describe('handleSourceReady failure reporting', () => {
  it('reports error.source.scan_failed with the message as detail when scanFolder throws', async () => {
    fetchGraphQLMock.mockResolvedValueOnce(source()).mockResolvedValue({ sourceScanFailed: true });
    scanFolderMock.mockRejectedValue(new Error('EACCES: permission denied'));

    await expect(handleSourceReady(job)).rejects.toBeInstanceOf(UnrecoverableError);

    expect(reports()).toHaveLength(1);
    const vars = reports()[0][1];
    expect(vars.id).toBe(7);
    expect(vars.key).toBe('error.source.scan_failed');
    expect(JSON.parse(vars.params)).toEqual({ detail: 'EACCES: permission denied' });
    expect(vars.msg).toBe('The download could not be read: EACCES: permission denied');
  });

  it('reports error.source.no_download_path when downloadPath is missing', async () => {
    fetchGraphQLMock
      .mockResolvedValueOnce(source({ downloadPath: null }))
      .mockResolvedValue({ sourceScanFailed: true });

    await expect(handleSourceReady(job)).rejects.toBeInstanceOf(UnrecoverableError);

    expect(reports()).toHaveLength(1);
    expect(reports()[0][1].key).toBe('error.source.no_download_path');
  });

  it('reports the key of an api keyed error raised by sourceScanned', async () => {
    fetchGraphQLMock
      .mockResolvedValueOnce(source())
      .mockRejectedValueOnce(
        new KeyedError('error.source.match_not_reported', 'match not reported', { id: 7 }),
      )
      .mockResolvedValue({ sourceScanFailed: true });
    scanFolderMock.mockResolvedValue({ files: [] });

    await expect(handleSourceReady(job)).rejects.toBeInstanceOf(UnrecoverableError);

    expect(reports()).toHaveLength(1);
    expect(reports()[0][1].key).toBe('error.source.match_not_reported');
    expect(reports()[0][1].msg).toBe('match not reported');
  });

  it('never calls sourceScanFailed on a successful scan', async () => {
    fetchGraphQLMock.mockResolvedValueOnce(source()).mockResolvedValue({ sourceScanned: {} });
    scanFolderMock.mockResolvedValue({ files: [] });

    await expect(handleSourceReady(job)).resolves.toBeUndefined();

    expect(reports()).toHaveLength(0);
  });

  it('propagates a rejection of the report itself instead of swallowing it', async () => {
    fetchGraphQLMock
      .mockResolvedValueOnce(source())
      .mockRejectedValueOnce(new Error('api rejected'));
    scanFolderMock.mockRejectedValue(new Error('boom'));

    const error = await handleSourceReady(job).catch((e) => e);

    expect(error).toBeInstanceOf(Error);
    expect(error).not.toBeInstanceOf(UnrecoverableError);
    expect(error.message).toBe('api rejected');
  });

  describe('disc routing', () => {
    const discFiles = [
      'BDMV/PLAYLIST/00800.mpls',
      'BDMV/PLAYLIST/00801.mpls',
      'BDMV/STREAM/00001.m2ts',
    ].map((rel) => ({
      filePath: `/downloads/x/${rel}`,
      fileName: rel.split('/').pop()!,
      size: 10,
      isVideo: rel.endsWith('.m2ts'),
    }));

    function scanned() {
      return fetchGraphQLMock.mock.calls.find(([query]) => String(query).includes('sourceScanned('));
    }

    it('keeps the ordinary path for an episode source that holds a BDMV tree', async () => {
      fetchGraphQLMock
        .mockResolvedValueOnce(source({ movieId: null, episodeId: 3 }))
        .mockResolvedValue({ sourceScanned: {} });
      scanFolderMock.mockResolvedValue({ files: discFiles });

      await handleSourceReady(job);

      const vars = scanned()![1];
      expect(vars.matches).toEqual([
        { filePath: '/downloads/x/BDMV/STREAM/00001.m2ts', seasonNumber: null, episodeNumber: null },
      ]);
      expect(vars.files.find((f: { fileName: string }) => f.fileName === '00001.m2ts').isVideo).toBe(true);
    });

    it('reports one mpls match through sourceScanned for a film disc', async () => {
      fetchGraphQLMock.mockResolvedValueOnce(source()).mockResolvedValue({ sourceScanned: {} });
      scanFolderMock.mockResolvedValue({ files: discFiles });
      discReads.set('/downloads/x/BDMV/PLAYLIST/00800.mpls', mplsOf(9_000_000, [1]));
      discReads.set('/downloads/x/BDMV/PLAYLIST/00801.mpls', mplsOf(90_000, []));

      await handleSourceReady(job);

      const vars = scanned()![1];
      expect(vars.matches).toEqual([
        { filePath: '/downloads/x/BDMV/PLAYLIST/00800.mpls', seasonNumber: null, episodeNumber: null },
      ]);
      expect(vars.files.filter((f: { isVideo: boolean }) => f.isVideo)).toHaveLength(1);
      expect(reports()).toHaveLength(0);
    });

    it('reaches sourceScanFailed with the ambiguous key for a tied disc', async () => {
      fetchGraphQLMock.mockResolvedValueOnce(source()).mockResolvedValue({ sourceScanFailed: true });
      scanFolderMock.mockResolvedValue({ files: discFiles });
      discReads.set('/downloads/x/BDMV/PLAYLIST/00800.mpls', mplsOf(9_000_000, [1]));
      discReads.set('/downloads/x/BDMV/PLAYLIST/00801.mpls', mplsOf(9_000_000, [1]));

      await expect(handleSourceReady(job)).rejects.toBeInstanceOf(UnrecoverableError);

      expect(reports()).toHaveLength(1);
      expect(reports()[0][1].key).toBe('error.source.disc_playlist_ambiguous');
      expect(JSON.parse(reports()[0][1].params)).toEqual({ playlists: '00800.mpls, 00801.mpls' });
    });
  });
});
