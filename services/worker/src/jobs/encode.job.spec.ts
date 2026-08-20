// Defends REQ-11's sharpest failure mode (docs/spec/features/018-ui-i18n/worker/plan.md
// § Tests): encode.job.ts:139-144 (pre-018) ended in
// `.catch((err) => console.error(...))`. If the encodeFailed call is malformed —
// wrong arity, a missing errorKey, an unstringified errorParams object — the
// rejection is swallowed into a console line, the ProcessJob stays ENCODING
// forever, and nothing anywhere surfaces the problem. This suite asserts the
// mutation is always called with all four arguments, that errorParams is a
// JSON string (or undefined), and that a failure never reports without a key
// — including one raised from a plain, non-KeyedError throw.

import { beforeEach, describe, expect, it, vi } from 'vitest';

const { fetchGraphQLMock, buildOutputPathMock, encodeMock, cleanupSourceMock } = vi.hoisted(() => ({
  fetchGraphQLMock: vi.fn(),
  buildOutputPathMock: vi.fn(),
  encodeMock: vi.fn(),
  cleanupSourceMock: vi.fn(),
}));

vi.mock('../api/graphql-client', () => ({
  fetchGraphQL: (...args: unknown[]) => fetchGraphQLMock(...args),
}));
vi.mock('../paths/build-output-path', () => ({
  buildOutputPath: (...args: unknown[]) => buildOutputPathMock(...args),
}));
vi.mock('../encode', () => ({
  encode: (...args: unknown[]) => encodeMock(...args),
}));
vi.mock('./cleanup-source', () => ({
  cleanupSource: (...args: unknown[]) => cleanupSourceMock(...args),
}));

import { handleEncode } from './encode.job';
import { KeyedError } from '../i18n/keyed-error';
import { ERROR_ENCODE_FFMPEG_FAILED, ERROR_ENCODE_UNEXPECTED } from '../i18n/error-keys';

const PROCESS_JOB_DETAILS = {
  id: 1,
  status: 'ENCODING',
  inputFilePath: '/downloads/movie.mkv',
  kind: 'MOVIE',
  tmdbId: 1,
  title: 'A Movie',
  year: 2020,
  originalLanguage: 'en',
  originalLanguageIso3: 'eng',
  allowedLanguagesIso3: ['eng'],
  isLiveAction: true,
  seasonNumber: null,
  episodeNumber: null,
  episodeTitle: null,
  mediaSourceId: 1,
  sourceKind: 'TORRENT_SEARCH',
  infoHash: 'abcd1234',
  downloadPath: '/downloads/movie',
  outputRoot: '/library/movies',
  downloadsRoot: '/downloads',
};

function makeJob() {
  return { data: { processJobId: 1 } } as any;
}

beforeEach(() => {
  fetchGraphQLMock.mockReset();
  buildOutputPathMock.mockReset();
  encodeMock.mockReset();
  cleanupSourceMock.mockReset();

  buildOutputPathMock.mockReturnValue('/library/movies/A Movie (2020)/A Movie (2020).mkv');

  // First call: the processJob query. Second call: encodeStarted. Both
  // resolve fine — the failure happens inside encode() itself.
  fetchGraphQLMock.mockImplementation((query: string) => {
    if (query.includes('processJob(id:')) {
      return Promise.resolve({ processJob: PROCESS_JOB_DETAILS });
    }
    return Promise.resolve(undefined);
  });
});

describe('handleEncode — encodeFailed reporting (018-ui-i18n REQ-11)', () => {
  it('reports a KeyedError with its own key, JSON-stringified params and a rendered English message', async () => {
    const thrown = new KeyedError(
      ERROR_ENCODE_FFMPEG_FAILED,
      'ffmpeg exited with code 1: some stderr tail',
      { code: 1, stderr: 'some stderr tail' },
    );
    encodeMock.mockRejectedValue(thrown);

    await expect(handleEncode(makeJob())).rejects.toBe(thrown);

    const failedCall = fetchGraphQLMock.mock.calls.find(([query]) =>
      (query as string).includes('encodeFailed'),
    );
    expect(failedCall).toBeDefined();
    const [query, variables] = failedCall as [string, Record<string, unknown>];

    // All four arguments must be present in the mutation document and in the
    // variables — a malformed call here is exactly the silent failure this
    // suite exists to catch.
    expect(query).toContain('$key: String!');
    expect(query).toContain('$params: String');
    expect(query).toContain('$msg: String!');
    expect(query).toContain('errorKey: $key');
    expect(query).toContain('errorParams: $params');
    expect(query).toContain('errorMessage: $msg');

    expect(variables.id).toBe(1);
    expect(variables.key).toBe(ERROR_ENCODE_FFMPEG_FAILED);
    expect(typeof variables.params).toBe('string');
    expect(JSON.parse(variables.params as string)).toEqual({ code: 1, stderr: 'some stderr tail' });
    expect(variables.msg).toBe('ffmpeg exited with code 1: some stderr tail');
  });

  it('reports the catch-all key with the raw message as a param when the throw is not a KeyedError', async () => {
    encodeMock.mockRejectedValue(new Error('unexpected library crash'));

    await expect(handleEncode(makeJob())).rejects.toThrow('unexpected library crash');

    const failedCall = fetchGraphQLMock.mock.calls.find(([query]) =>
      (query as string).includes('encodeFailed'),
    );
    expect(failedCall).toBeDefined();
    const [, variables] = failedCall as [string, Record<string, unknown>];

    // A failure must never report with no key — the whole point of REQ-11.
    expect(variables.key).toBe(ERROR_ENCODE_UNEXPECTED);
    expect(typeof variables.params).toBe('string');
    expect(JSON.parse(variables.params as string)).toEqual({ detail: 'unexpected library crash' });
    expect(variables.msg).toContain('unexpected library crash');
  });

  it('reports the catch-all key even for a non-Error throw (a rejected string, etc.)', async () => {
    // eslint-disable-next-line prefer-promise-reject-errors
    encodeMock.mockRejectedValue('plain string rejection');

    await expect(handleEncode(makeJob())).rejects.toBe('plain string rejection');

    const failedCall = fetchGraphQLMock.mock.calls.find(([query]) =>
      (query as string).includes('encodeFailed'),
    );
    expect(failedCall).toBeDefined();
    const [, variables] = failedCall as [string, Record<string, unknown>];

    expect(variables.key).toBe(ERROR_ENCODE_UNEXPECTED);
    expect(JSON.parse(variables.params as string)).toEqual({ detail: 'plain string rejection' });
  });
});
