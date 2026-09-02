// Defends REQ-11's sharpest failure mode (docs/spec/features/018-ui-i18n/worker/plan.md
// § Tests): encode.job.ts:139-144 (pre-018) ended in
// `.catch((err) => console.error(...))`. If the encodeFailed call is malformed —
// wrong arity, a missing errorKey, an unstringified errorParams object — the
// rejection is swallowed into a console line, the ProcessJob stays ENCODING
// forever, and nothing anywhere surfaces the problem. This suite asserts the
// mutation is always called with all four arguments, that errorParams is a
// JSON string (or undefined), and that a failure never reports without a key
// — including one raised from a plain, non-KeyedError throw.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { fetchGraphQLMock, buildOutputPathMock, encodeMock, cleanupSourceMock, passthroughMock } =
  vi.hoisted(() => ({
    fetchGraphQLMock: vi.fn(),
    buildOutputPathMock: vi.fn(),
    encodeMock: vi.fn(),
    cleanupSourceMock: vi.fn(),
    passthroughMock: vi.fn(),
  }));

vi.mock('../api/graphql-client', async () => {
  const actual = await vi.importActual<typeof import('../api/graphql-client')>(
    '../api/graphql-client',
  );
  return {
    ...actual,
    fetchGraphQL: (...args: unknown[]) => fetchGraphQLMock(...args),
  };
});
vi.mock('../paths/build-output-path', () => ({
  buildOutputPath: (...args: unknown[]) => buildOutputPathMock(...args),
}));
vi.mock('../encode', () => ({
  encode: (...args: unknown[]) => encodeMock(...args),
}));
vi.mock('../encode/passthrough', () => ({
  passthrough: (...args: unknown[]) => passthroughMock(...args),
}));
vi.mock('./cleanup-source', () => ({
  cleanupSource: (...args: unknown[]) => cleanupSourceMock(...args),
}));

import { handleEncode } from './encode.job';
import { KeyedError } from '../i18n/keyed-error';
import { ApiUnreachableError } from '../api/graphql-client';
import {
  ERROR_ENCODE_FFMPEG_FAILED,
  ERROR_ENCODE_PROBE_FAILED,
  ERROR_ENCODE_UNEXPECTED,
} from '../i18n/error-keys';

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
  allowedLanguageTags: ['en'],
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
  passthroughMock.mockReset();

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

// Defends the payload seam of 031-worker-language-variants (worker/plan.md
// § Steps 1-3): `allowedLanguageTags` is a third hand-retyped field with no
// compiler across the GraphQL boundary, and the top row of `../plan.md`
// § Risks is exactly this field arriving `undefined` and the regional
// preference silently doing nothing forever. These two cases pin that the
// field reaches the driver, and that its absence degrades to `[]` (NFR-2)
// rather than throwing or dropping the encode.
describe('handleEncode — allowedLanguageTags payload seam (031-worker-language-variants)', () => {
  function mockSuccessfulGraphQL(processJob: Record<string, unknown>) {
    fetchGraphQLMock.mockImplementation((query: string) => {
      if (query.includes('processJob(id:')) {
        return Promise.resolve({ processJob });
      }
      if (query.includes('encodeCompleted')) {
        return Promise.resolve({
          encodeCompleted: {
            message: 'ok',
            removeTorrent: false,
            deleteInputFile: false,
            deleteDownloadPath: false,
          },
        });
      }
      return Promise.resolve(undefined);
    });
  }

  it('passes allowedLanguageTags through to the encode() call unchanged', async () => {
    mockSuccessfulGraphQL({ ...PROCESS_JOB_DETAILS, allowedLanguageTags: ['en', 'es-419'] });
    encodeMock.mockResolvedValue({ ffmpegCommand: 'ffmpeg -i ...' });

    await handleEncode(makeJob());

    expect(encodeMock).toHaveBeenCalledTimes(1);
    const [, , details] = encodeMock.mock.calls[0] as [string, string, Record<string, unknown>];
    expect(details.allowedLanguageTags).toEqual(['en', 'es-419']);
  });

  it('degrades a processJob with no allowedLanguageTags to [] rather than throwing (NFR-2)', async () => {
    const { allowedLanguageTags: _omit, ...withoutTags } = PROCESS_JOB_DETAILS;
    mockSuccessfulGraphQL(withoutTags);
    encodeMock.mockResolvedValue({ ffmpegCommand: 'ffmpeg -i ...' });

    await expect(handleEncode(makeJob())).resolves.toBeUndefined();

    const [, , details] = encodeMock.mock.calls[0] as [string, string, Record<string, unknown>];
    expect(details.allowedLanguageTags).toEqual([]);
  });
});

// Defends REQ-1/NFR-1 of 023-ffprobe-log at the one call site that could get
// them backwards: recordFfprobe must fire before encodeCompleted (REQ-1), a
// recordFfprobe failure must never touch encodeCompleted or encodeFailed
// (NFR-1), and a genuine ffprobe failure — which never reaches onProbe at
// all — must still fail the encode and must never call recordFfprobe. Each
// case guards a different way the try/catch around onProbe's fetchGraphQL
// call (worker/plan.md § Steps 5) could be written wrong: too late, too
// wide, or not at all.
describe('handleEncode — ffprobe log recording (023-ffprobe-log)', () => {
  const RAW_PROBE = '{"streams":[{"codec_type":"video"}],"format":{"duration":"120"}}';

  function mockSuccessfulGraphQL() {
    fetchGraphQLMock.mockImplementation((query: string) => {
      if (query.includes('processJob(id:')) {
        return Promise.resolve({ processJob: PROCESS_JOB_DETAILS });
      }
      if (query.includes('encodeCompleted')) {
        return Promise.resolve({
          encodeCompleted: {
            message: 'ok',
            removeTorrent: false,
            deleteInputFile: false,
            deleteDownloadPath: false,
          },
        });
      }
      return Promise.resolve(undefined);
    });
  }

  it('sends recordFfprobe with the driver-reported raw string before encodeCompleted (REQ-1)', async () => {
    mockSuccessfulGraphQL();
    encodeMock.mockImplementation(async (...args: unknown[]) => {
      const [input, , , , onProbe] = args as [
        string,
        string,
        unknown,
        (p: number) => Promise<void>,
        (file: string, ffprobe: string) => Promise<void>,
      ];
      await onProbe(input, RAW_PROBE);
      return { ffmpegCommand: 'ffmpeg -i ...' };
    });

    await handleEncode(makeJob());

    const probeIndex = fetchGraphQLMock.mock.calls.findIndex(([query]) =>
      (query as string).includes('recordFfprobe'),
    );
    const completedIndex = fetchGraphQLMock.mock.calls.findIndex(([query]) =>
      (query as string).includes('encodeCompleted'),
    );

    expect(probeIndex).toBeGreaterThanOrEqual(0);
    expect(completedIndex).toBeGreaterThanOrEqual(0);
    // The ordering assertion this case exists for: recording after the fact
    // would still pass a check that only looked for both calls happening.
    expect(probeIndex).toBeLessThan(completedIndex);

    const [, probeVariables] = fetchGraphQLMock.mock.calls[probeIndex] as [string, Record<string, unknown>];
    expect(probeVariables.file).toBe(PROCESS_JOB_DETAILS.inputFilePath);
    expect(probeVariables.ffprobe).toBe(RAW_PROBE);
  });

  it('reaches encodeCompleted and sends no encodeFailed when recordFfprobe rejects (NFR-1)', async () => {
    fetchGraphQLMock.mockImplementation((query: string) => {
      if (query.includes('processJob(id:')) {
        return Promise.resolve({ processJob: PROCESS_JOB_DETAILS });
      }
      if (query.includes('recordFfprobe')) {
        return Promise.reject(new Error('api unreachable'));
      }
      if (query.includes('encodeCompleted')) {
        return Promise.resolve({
          encodeCompleted: {
            message: 'ok',
            removeTorrent: false,
            deleteInputFile: false,
            deleteDownloadPath: false,
          },
        });
      }
      return Promise.resolve(undefined);
    });
    encodeMock.mockImplementation(async (...args: unknown[]) => {
      const [input, , , , onProbe] = args as [
        string,
        string,
        unknown,
        (p: number) => Promise<void>,
        (file: string, ffprobe: string) => Promise<void>,
      ];
      await onProbe(input, RAW_PROBE);
      return { ffmpegCommand: 'ffmpeg -i ...' };
    });

    await expect(handleEncode(makeJob())).resolves.toBeUndefined();

    const completedCall = fetchGraphQLMock.mock.calls.find(([query]) =>
      (query as string).includes('encodeCompleted'),
    );
    const failedCall = fetchGraphQLMock.mock.calls.find(([query]) =>
      (query as string).includes('encodeFailed'),
    );

    expect(completedCall).toBeDefined();
    expect(failedCall).toBeUndefined();
  });

  it('fails the encode with error.encode.probe_failed and sends no recordFfprobe when the probe itself throws', async () => {
    mockSuccessfulGraphQL();
    const probeError = new KeyedError(ERROR_ENCODE_PROBE_FAILED, 'ffprobe failed', {
      filePath: PROCESS_JOB_DETAILS.inputFilePath,
      detail: 'ffprobe exited with code 1',
    });
    // The real driver never calls onProbe when ffprobe itself throws — the
    // guard this case exists for is a catch that got written wide enough to
    // swallow this too.
    encodeMock.mockRejectedValue(probeError);

    await expect(handleEncode(makeJob())).rejects.toBe(probeError);

    const probeCall = fetchGraphQLMock.mock.calls.find(([query]) =>
      (query as string).includes('recordFfprobe'),
    );
    expect(probeCall).toBeUndefined();

    const failedCall = fetchGraphQLMock.mock.calls.find(([query]) =>
      (query as string).includes('encodeFailed'),
    );
    expect(failedCall).toBeDefined();
    const [, variables] = failedCall as [string, Record<string, unknown>];
    expect(variables.key).toBe(ERROR_ENCODE_PROBE_FAILED);
  });
});

// Defends the branch 032-optional-compression adds to handleEncode
// (worker/plan.md § Tests): `compressionEnabled` must be tested with `=== false`,
// never with falsiness. Rewriting the guard as `if (!details.compressionEnabled)`
// would still pass the two straightforward cases below — it only breaks the
// third one, where the field is missing entirely (NFR-2). That third case is
// the whole point of this suite: a version-skewed api or a hand-edited query
// selection that drops the field must still compress, since nothing about a
// filed-but-uncompressed library announces itself as wrong.
describe('handleEncode — compressionEnabled branch (032-optional-compression)', () => {
  function mockSuccessfulGraphQL(processJob: Record<string, unknown>) {
    fetchGraphQLMock.mockImplementation((query: string) => {
      if (query.includes('processJob(id:')) {
        return Promise.resolve({ processJob });
      }
      if (query.includes('encodeCompleted')) {
        return Promise.resolve({
          encodeCompleted: {
            message: 'ok',
            removeTorrent: true,
            deleteInputFile: true,
            deleteDownloadPath: false,
          },
        });
      }
      return Promise.resolve(undefined);
    });
  }

  it('compressionEnabled: false -> never calls encode(), calls passthrough(), completes with the swapped extension and an empty ffmpegCommand, and still runs cleanupSource', async () => {
    mockSuccessfulGraphQL({
      ...PROCESS_JOB_DETAILS,
      inputFilePath: '/downloads/A Movie.mp4',
      compressionEnabled: false,
    });
    buildOutputPathMock.mockReturnValue('/library/movies/A Movie (2020)/A Movie (2020).mkv');
    passthroughMock.mockImplementation(async (_input, output, _details, onProgress) => {
      await onProgress(100);
      return { ffmpegCommand: '' };
    });

    await handleEncode(makeJob());

    expect(encodeMock).not.toHaveBeenCalled();
    expect(passthroughMock).toHaveBeenCalledTimes(1);
    const [passInput, passOutput] = passthroughMock.mock.calls[0] as [string, string];
    expect(passInput).toBe('/downloads/A Movie.mp4');
    // withSourceExtension swaps the .mkv buildOutputPath produced for the
    // source's own .mp4 (REQ-10) — asserted here via the real output path,
    // not a mocked withSourceExtension, since it's a pure function this test
    // exercises for real.
    expect(passOutput).toBe('/library/movies/A Movie (2020)/A Movie (2020).mp4');

    const completedCall = fetchGraphQLMock.mock.calls.find(([query]) =>
      (query as string).includes('encodeCompleted'),
    );
    expect(completedCall).toBeDefined();
    const [, completedVariables] = completedCall as [string, Record<string, unknown>];
    expect(completedVariables.out).toBe('/library/movies/A Movie (2020)/A Movie (2020).mp4');
    expect(completedVariables.cmd).toBe('');

    expect(cleanupSourceMock).toHaveBeenCalledTimes(1);
    const cleanupArgs = cleanupSourceMock.mock.calls[0][0] as Record<string, unknown>;
    expect(cleanupArgs.removeTorrent).toBe(true);
    expect(cleanupArgs.deleteInputFile).toBe(true);
    expect(cleanupArgs.deleteDownloadPath).toBe(false);
  });

  it('compressionEnabled: true -> calls encode() and never passthrough(), unchanged from today', async () => {
    mockSuccessfulGraphQL({ ...PROCESS_JOB_DETAILS, compressionEnabled: true });
    buildOutputPathMock.mockReturnValue('/library/movies/A Movie (2020)/A Movie (2020).mkv');
    encodeMock.mockResolvedValue({ ffmpegCommand: 'ffmpeg -i ...' });

    await handleEncode(makeJob());

    expect(passthroughMock).not.toHaveBeenCalled();
    expect(encodeMock).toHaveBeenCalledTimes(1);

    const completedCall = fetchGraphQLMock.mock.calls.find(([query]) =>
      (query as string).includes('encodeCompleted'),
    );
    const [, completedVariables] = completedCall as [string, Record<string, unknown>];
    expect(completedVariables.out).toBe('/library/movies/A Movie (2020)/A Movie (2020).mkv');
    expect(completedVariables.cmd).toBe('ffmpeg -i ...');
  });

  it('compressionEnabled absent -> compresses (NFR-2): the field arriving undefined must never be read as "off"', async () => {
    const { compressionEnabled: _omit, ...withoutFlag } = {
      ...PROCESS_JOB_DETAILS,
      compressionEnabled: true,
    };
    mockSuccessfulGraphQL(withoutFlag);
    buildOutputPathMock.mockReturnValue('/library/movies/A Movie (2020)/A Movie (2020).mkv');
    encodeMock.mockResolvedValue({ ffmpegCommand: 'ffmpeg -i ...' });

    await handleEncode(makeJob());

    // This is the assertion that fails if the branch is rewritten as
    // `if (!details.compressionEnabled)`: `undefined` is falsy, so that form
    // would route to the passthrough here instead.
    expect(encodeMock).toHaveBeenCalledTimes(1);
    expect(passthroughMock).not.toHaveBeenCalled();
  });
});

// Defends REQ-1 of 038-encode-report-durability directly, the incident case
// stated in worker/plan.md § Tests: an encode that succeeded must never be
// reported as encodeFailed just because delivering encodeCompleted hit a
// transport failure. The fault-injection case at the end proves this suite
// actually exercises the fix (moving the call back inside the try goes red).
describe('handleEncode — encodeCompleted delivered through deliverReport (038-encode-report-durability)', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  function mockGraphQL({
    encodeCompletedImpl,
  }: {
    encodeCompletedImpl: () => Promise<{ encodeCompleted: Record<string, unknown> }>;
  }) {
    fetchGraphQLMock.mockImplementation((query: string) => {
      if (query.includes('processJob(id:')) {
        return Promise.resolve({ processJob: PROCESS_JOB_DETAILS });
      }
      if (query.includes('encodeCompleted')) {
        return encodeCompletedImpl();
      }
      if (query.includes('encodeFailed')) {
        return Promise.resolve(true);
      }
      return Promise.resolve(undefined);
    });
  }

  it('never calls encodeFailed and still runs cleanup on the verdict that eventually arrived, when encodeCompleted is unreachable once then succeeds', async () => {
    let attempts = 0;
    mockGraphQL({
      encodeCompletedImpl: () => {
        attempts += 1;
        if (attempts === 1) {
          return Promise.reject(new ApiUnreachableError(new Error('ECONNREFUSED')));
        }
        return Promise.resolve({
          encodeCompleted: {
            message: 'ok',
            removeTorrent: true,
            deleteInputFile: true,
            deleteDownloadPath: false,
          },
        });
      },
    });
    encodeMock.mockResolvedValue({ ffmpegCommand: 'ffmpeg -i ...' });

    const promise = handleEncode(makeJob());
    // Let the first (failing) attempt run, then advance past the retry delay.
    await vi.advanceTimersByTimeAsync(60_000);

    await expect(promise).resolves.toBeUndefined();

    expect(attempts).toBe(2);

    const failedCall = fetchGraphQLMock.mock.calls.find(([query]) =>
      (query as string).includes('encodeFailed'),
    );
    expect(failedCall).toBeUndefined();

    expect(cleanupSourceMock).toHaveBeenCalledTimes(1);
    const cleanupArgs = cleanupSourceMock.mock.calls[0][0] as Record<string, unknown>;
    expect(cleanupArgs.removeTorrent).toBe(true);
    expect(cleanupArgs.deleteInputFile).toBe(true);
    expect(cleanupArgs.deleteDownloadPath).toBe(false);
  });

  // Structurally the sharpest of this describe block: a rejection here is
  // *terminal* (REQ-3), not a transport failure, so deliverReport doesn't
  // retry it either — it propagates straight out of handleEncode. What this
  // pins is that it must propagate WITHOUT being caught by the encode's own
  // catch and reported as encodeFailed, since the encode already succeeded.
  // This is the case that actually discriminates on the encodeCompleted
  // call's position: with it outside the try (the fix), the rejection never
  // reaches the catch at all. Moving it back inside the try makes the catch
  // see it and call encodeFailed — red, as verified below.
  it('never calls encodeFailed when encodeCompleted itself terminally rejects after a successful encode (REQ-1)', async () => {
    const terminalRejection = new Error('encodeCompleted rejected: processJob already reported');
    mockGraphQL({
      encodeCompletedImpl: () => Promise.reject(terminalRejection),
    });
    encodeMock.mockResolvedValue({ ffmpegCommand: 'ffmpeg -i ...' });

    await expect(handleEncode(makeJob())).rejects.toBe(terminalRejection);

    const failedCall = fetchGraphQLMock.mock.calls.find(([query]) =>
      (query as string).includes('encodeFailed'),
    );
    expect(failedCall).toBeUndefined();
  });

  it('still reports encodeFailed with its key intact for a genuinely failed encode', async () => {
    mockGraphQL({
      encodeCompletedImpl: () =>
        Promise.resolve({
          encodeCompleted: {
            message: 'ok',
            removeTorrent: false,
            deleteInputFile: false,
            deleteDownloadPath: false,
          },
        }),
    });
    const thrown = new KeyedError(ERROR_ENCODE_FFMPEG_FAILED, 'ffmpeg exited with code 1', {
      code: 1,
    });
    encodeMock.mockRejectedValue(thrown);

    await expect(handleEncode(makeJob())).rejects.toBe(thrown);

    const failedCall = fetchGraphQLMock.mock.calls.find(([query]) =>
      (query as string).includes('encodeFailed'),
    );
    expect(failedCall).toBeDefined();
    const [, variables] = failedCall as [string, Record<string, unknown>];
    expect(variables.key).toBe(ERROR_ENCODE_FFMPEG_FAILED);

    expect(cleanupSourceMock).not.toHaveBeenCalled();
  });
});
