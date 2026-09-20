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
});
