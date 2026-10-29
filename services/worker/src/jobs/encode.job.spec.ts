// Spec 018, REQ-11

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const {
  fetchGraphQLMock,
  buildOutputPathMock,
  encodeMock,
  cleanupSourceMock,
  passthroughMock,
  assemblePlaylistMock,
} = vi.hoisted(() => ({
    assemblePlaylistMock: vi.fn(),
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
vi.mock('../disc/assemble-playlist', () => ({
  assemblePlaylist: (...args: unknown[]) => assemblePlaylistMock(...args),
}));
vi.mock('./cleanup-source', () => ({
  cleanupSource: (...args: unknown[]) => cleanupSourceMock(...args),
}));

import { mkdir, mkdtemp, writeFile, stat, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { UnrecoverableError } from 'bullmq';
import { handleEncode } from './encode.job';
import { KeyedError } from '../i18n/keyed-error';
import { EncodeCancelledError } from '../encode/cancellation';
import { ApiUnreachableError } from '../api/graphql-client';
import {
  ERROR_ENCODE_DISCARDED,
  ERROR_ENCODE_DISC_REMUX_FAILED,
  ERROR_ENCODE_STOPPED,
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
  allowedAudioLanguagesIso3: ['eng'],
  allowedAudioLanguageTags: ['en'],
  allowedSubtitleLanguagesIso3: ['eng'],
  allowedSubtitleLanguageTags: ['en'],
  contentKind: 'LIVE_ACTION',
  compressionResolution: '1080p',
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
  assemblePlaylistMock.mockReset();

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

describe('handleEncode — encodeFailed reporting (Spec 018, REQ-11)', () => {
  it('reports a KeyedError with its own key, JSON-stringified params and a rendered English message', async () => {
    const thrown = new KeyedError(
      ERROR_ENCODE_FFMPEG_FAILED,
      'ffmpeg exited with code 1: some stderr tail',
      { code: 1, stderr: 'some stderr tail' },
    );
    encodeMock.mockRejectedValue(thrown);

    // Spec 054, REQ-9
    await expect(handleEncode(makeJob())).rejects.toBeInstanceOf(UnrecoverableError);

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

    // Spec 018, REQ-11
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

// Defends the payload seam of Spec 031, extended by Spec 039, REQ-6: the
// single `allowedLanguagesIso3`/`allowedLanguageTags` pair became four
// hand-retyped fields — `allowedAudioLanguagesIso3`, `allowedAudioLanguageTags`,
// `allowedSubtitleLanguagesIso3`, `allowedSubtitleLanguageTags` — with no
// compiler across the GraphQL boundary. Three of the four renamed correctly
// and the fourth missed is exactly the failure mode this suite exists to
// catch: the field arrives `undefined`, reads as "no preference of that
// kind", and the feature does nothing for that list forever. These cases pin
// that all four reach the driver under their own name, and that the two
// **tag** lists specifically degrade to `[]` rather than throwing — the two
// iso3 lists stay undefended per worker/plan.md § Existing code to reuse, so
// a missing one still fails loudly instead of degrading here.
describe('handleEncode — allowed*Language* payload seam (Spec 031; Spec 039, REQ-6)', () => {
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

  it('passes all four allowed*Language* lists through to the encode() call unchanged, each under its own name', async () => {
    mockSuccessfulGraphQL({
      ...PROCESS_JOB_DETAILS,
      allowedAudioLanguagesIso3: ['eng', 'jpn'],
      allowedAudioLanguageTags: ['en', 'ja'],
      allowedSubtitleLanguagesIso3: ['spa'],
      allowedSubtitleLanguageTags: ['es-419'],
    });
    encodeMock.mockResolvedValue({ ffmpegCommand: 'ffmpeg -i ...' });

    await handleEncode(makeJob());

    expect(encodeMock).toHaveBeenCalledTimes(1);
    const [, , details] = encodeMock.mock.calls[0] as [string, string, Record<string, unknown>];
    expect(details.allowedAudioLanguagesIso3).toEqual(['eng', 'jpn']);
    expect(details.allowedAudioLanguageTags).toEqual(['en', 'ja']);
    expect(details.allowedSubtitleLanguagesIso3).toEqual(['spa']);
    expect(details.allowedSubtitleLanguageTags).toEqual(['es-419']);
  });

  it('degrades a processJob with no allowedAudioLanguageTags/allowedSubtitleLanguageTags to [] rather than throwing (Spec 039, REQ-6)', async () => {
    const {
      allowedAudioLanguageTags: _omitAudio,
      allowedSubtitleLanguageTags: _omitSubtitle,
      ...withoutTags
    } = PROCESS_JOB_DETAILS;
    mockSuccessfulGraphQL(withoutTags);
    encodeMock.mockResolvedValue({ ffmpegCommand: 'ffmpeg -i ...' });

    await expect(handleEncode(makeJob())).resolves.toBeUndefined();

    const [, , details] = encodeMock.mock.calls[0] as [string, string, Record<string, unknown>];
    expect(details.allowedAudioLanguageTags).toEqual([]);
    expect(details.allowedSubtitleLanguageTags).toEqual([]);
  });
});

// Defends the payload seam of 058-compression-resolution (worker/plan.md
// § Tests): the field dropped from the selection set or one EncodeInput
// literal compiles clean and encodes at 1080p forever, with no error
// anywhere. These cases pin that the query text actually selects the field,
// that a valid value reaches the driver verbatim, and that a missing one
// degrades to '1080p' rather than throwing or reaching the driver undefined.
describe('handleEncode — compressionResolution payload seam (058-compression-resolution)', () => {
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

  it('selects compressionResolution in the processJob query', async () => {
    mockSuccessfulGraphQL(PROCESS_JOB_DETAILS);
    encodeMock.mockResolvedValue({ ffmpegCommand: 'ffmpeg -i ...' });

    await handleEncode(makeJob());

    const processJobCall = fetchGraphQLMock.mock.calls.find(([query]) =>
      (query as string).includes('processJob(id:'),
    );
    expect(processJobCall).toBeDefined();
    const [query] = processJobCall as [string];
    expect(query).toContain('compressionResolution');
  });

  it('a compressionResolution of "480p" reaches the encode() call unchanged', async () => {
    mockSuccessfulGraphQL({ ...PROCESS_JOB_DETAILS, compressionResolution: '480p' });
    encodeMock.mockResolvedValue({ ffmpegCommand: 'ffmpeg -i ...' });

    await handleEncode(makeJob());

    const [, , details] = encodeMock.mock.calls[0] as [string, string, Record<string, unknown>];
    expect(details.compressionResolution).toBe('480p');
  });

  it('an absent compressionResolution reaches the encode() call as "1080p"', async () => {
    const { compressionResolution: _omit, ...withoutResolution } = PROCESS_JOB_DETAILS;
    mockSuccessfulGraphQL(withoutResolution);
    encodeMock.mockResolvedValue({ ffmpegCommand: 'ffmpeg -i ...' });

    await handleEncode(makeJob());

    const [, , details] = encodeMock.mock.calls[0] as [string, string, Record<string, unknown>];
    expect(details.compressionResolution).toBe('1080p');
  });
});

// Defends Spec 023, REQ-1 NFR-1 at the one call site that could get them
// backwards: recordFfprobe must fire before encodeCompleted, a recordFfprobe
// failure must never touch encodeCompleted or encodeFailed, and a genuine
// ffprobe failure — which never reaches onProbe at all — must still fail the
// encode and must never call recordFfprobe. Each
// case guards a different way the try/catch around onProbe's fetchGraphQL
// call (worker/plan.md § Steps 5) could be written wrong: too late, too
// wide, or not at all.
describe('handleEncode — ffprobe log recording (Spec 023, REQ-1)', () => {
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

  it('sends recordFfprobe with the driver-reported raw string before encodeCompleted (Spec 023, REQ-1)', async () => {
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

  it('reaches encodeCompleted and sends no encodeFailed when recordFfprobe rejects (Spec 023, NFR-1)', async () => {
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

    // Spec 054, REQ-9
    await expect(handleEncode(makeJob())).rejects.toBeInstanceOf(UnrecoverableError);

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

// Defends the branch Spec 032, NFR-2 adds to handleEncode: `compressionEnabled`
// must be tested with `=== false`, never with falsiness. Rewriting the guard
// as `if (!details.compressionEnabled)` would still pass the two
// straightforward cases below — it only breaks the third one, where the
// field is missing entirely. That third case is the whole point of this
// suite: a version-skewed api or a hand-edited query selection that drops
// the field must still compress, since nothing about a filed-but-uncompressed
// library announces itself as wrong.
describe('handleEncode — compressionEnabled branch (Spec 032, NFR-2)', () => {
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
    // Spec 032, REQ-10
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

  it('compressionEnabled absent -> compresses (Spec 032, NFR-2): the field arriving undefined must never be read as "off"', async () => {
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

// Defends Spec 038, REQ-1 directly, the incident case stated in
// worker/plan.md § Tests: an encode that succeeded must never be reported
// as encodeFailed just because delivering encodeCompleted hit a transport
// failure. The fault-injection case at the end proves this suite actually
// exercises the fix (moving the call back inside the try goes red).
describe('handleEncode — encodeCompleted delivered through deliverReport (Spec 038, REQ-1)', () => {
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

  // Spec 038, REQ-3
  it('never calls encodeFailed when encodeCompleted itself terminally rejects after a successful encode (Spec 038, REQ-1)', async () => {
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

    // Spec 054, REQ-9
    await expect(handleEncode(makeJob())).rejects.toBeInstanceOf(UnrecoverableError);

    const failedCall = fetchGraphQLMock.mock.calls.find(([query]) =>
      (query as string).includes('encodeFailed'),
    );
    expect(failedCall).toBeDefined();
    const [, variables] = failedCall as [string, Record<string, unknown>];
    expect(variables.key).toBe(ERROR_ENCODE_FFMPEG_FAILED);

    expect(cleanupSourceMock).not.toHaveBeenCalled();
  });
});

// Defends the EncodeFn seam widened by 053-downloads-panel-repair (worker/plan.md
// § Tests): onProgress's second parameter must ride the existing encodeProgress
// mutation as the new `speed` argument, sent explicitly rather than omitted, and
// `0` — a legitimate multiplier at the start of an encode — must never be
// laundered into "no speed" by a falsy check.
describe('handleEncode — encode speed forwarded to encodeProgress (053-downloads-panel-repair)', () => {
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

  it('a driver reporting a speed produces an encodeProgress call carrying that value', async () => {
    mockSuccessfulGraphQL();
    encodeMock.mockImplementation(async (...args: unknown[]) => {
      const [, , , onProgress] = args as [
        string,
        string,
        unknown,
        (p: number, speed: number | null) => Promise<void>,
      ];
      await onProgress(50, 1.23);
      return { ffmpegCommand: 'ffmpeg -i ...' };
    });

    await handleEncode(makeJob());

    const progressCall = fetchGraphQLMock.mock.calls.find(([query]) =>
      (query as string).includes('encodeProgress'),
    );
    expect(progressCall).toBeDefined();
    const [query, variables] = progressCall as [string, Record<string, unknown>];
    expect(query).toContain('$s: Float');
    expect(query).toContain('speed: $s');
    expect(variables.s).toBe(1.23);
  });

  it('a driver reporting null produces an encodeProgress call carrying null, not an omitted variable', async () => {
    mockSuccessfulGraphQL();
    encodeMock.mockImplementation(async (...args: unknown[]) => {
      const [, , , onProgress] = args as [
        string,
        string,
        unknown,
        (p: number, speed: number | null) => Promise<void>,
      ];
      await onProgress(50, null);
      return { ffmpegCommand: 'ffmpeg -i ...' };
    });

    await handleEncode(makeJob());

    const progressCall = fetchGraphQLMock.mock.calls.find(([query]) =>
      (query as string).includes('encodeProgress'),
    );
    expect(progressCall).toBeDefined();
    const [, variables] = progressCall as [string, Record<string, unknown>];
    expect('s' in variables).toBe(true);
    expect(variables.s).toBeNull();
  });

  it('a speed of 0 is forwarded as 0, never laundered into "no speed" by a falsy check', async () => {
    mockSuccessfulGraphQL();
    encodeMock.mockImplementation(async (...args: unknown[]) => {
      const [, , , onProgress] = args as [
        string,
        string,
        unknown,
        (p: number, speed: number | null) => Promise<void>,
      ];
      await onProgress(50, 0);
      return { ffmpegCommand: 'ffmpeg -i ...' };
    });

    await handleEncode(makeJob());

    const progressCall = fetchGraphQLMock.mock.calls.find(([query]) =>
      (query as string).includes('encodeProgress'),
    );
    expect(progressCall).toBeDefined();
    const [, variables] = progressCall as [string, Record<string, unknown>];
    expect(variables.s).toBe(0);
  });
});

// Defends Spec 047, REQ-6 (worker/plan.md § Tests): a job abandoned because
// its source was deleted must report nothing at all — no encodeCompleted,
// no encodeFailed — and must never run cleanupSource, since there is no row
// left for either outcome to land on. Both call sites that
// EncodeCancelledError can come from (encode() and passthrough(), picked at
// runtime by compressionEnabled) are exercised separately: wiring the signal
// into only one of them would leave the other uncancellable with no compile
// error anywhere, exactly the failure mode worker/plan.md § Steps 8 warns
// about.
describe('handleEncode — a cancelled encode reports nothing (Spec 047, REQ-6)', () => {
  function mockSuccessfulGraphQL(processJob: Record<string, unknown> = PROCESS_JOB_DETAILS) {
    fetchGraphQLMock.mockImplementation((query: string) => {
      if (query.includes('processJob(id:')) {
        return Promise.resolve({ processJob });
      }
      return Promise.resolve(undefined);
    });
  }

  it('reports neither encodeCompleted nor encodeFailed and skips cleanupSource on the compressing path', async () => {
    mockSuccessfulGraphQL();
    const cancelled = new EncodeCancelledError();
    encodeMock.mockRejectedValue(cancelled);

    // Spec 054, REQ-8
    await expect(handleEncode(makeJob())).rejects.toBeInstanceOf(UnrecoverableError);

    expect(passthroughMock).not.toHaveBeenCalled();
    const completedCall = fetchGraphQLMock.mock.calls.find(([query]) =>
      (query as string).includes('encodeCompleted'),
    );
    const failedCall = fetchGraphQLMock.mock.calls.find(([query]) =>
      (query as string).includes('encodeFailed'),
    );
    expect(completedCall).toBeUndefined();
    expect(failedCall).toBeUndefined();
    expect(cleanupSourceMock).not.toHaveBeenCalled();
  });

  it('reports neither encodeCompleted nor encodeFailed and skips cleanupSource on the passthrough (compressionEnabled: false) path', async () => {
    mockSuccessfulGraphQL({ ...PROCESS_JOB_DETAILS, compressionEnabled: false });
    const cancelled = new EncodeCancelledError();
    passthroughMock.mockRejectedValue(cancelled);

    await expect(handleEncode(makeJob())).rejects.toBeInstanceOf(UnrecoverableError);

    expect(encodeMock).not.toHaveBeenCalled();
    const completedCall = fetchGraphQLMock.mock.calls.find(([query]) =>
      (query as string).includes('encodeCompleted'),
    );
    const failedCall = fetchGraphQLMock.mock.calls.find(([query]) =>
      (query as string).includes('encodeFailed'),
    );
    expect(completedCall).toBeUndefined();
    expect(failedCall).toBeUndefined();
    expect(cleanupSourceMock).not.toHaveBeenCalled();
  });
});

// Defends Spec 054, REQ-7 REQ-8 REQ-9 (worker/plan.md § Steps 3, § Tests):
// once the encode queue gets real retries, a plain throw is no longer just
// a failed job — it's a job BullMQ will re-attempt. Only two classes must
// be exempted from that: a cancellation, which must also keep reporting
// nothing — the Spec 047 regression this feature's own plan.md § Risks
// names as its most likely bug — and a KeyedError, a diagnosed failure that
// will recur identically. Anything else must stay a plain, retryable throw
// — the case that proves steps 3/4 didn't just wrap everything, which would
// leave the retry budget inert while looking implemented.
describe('handleEncode — non-retryable classification (Spec 054, REQ-7 REQ-8 REQ-9)', () => {
  function mockSuccessfulGraphQL(processJob: Record<string, unknown> = PROCESS_JOB_DETAILS) {
    fetchGraphQLMock.mockImplementation((query: string) => {
      if (query.includes('processJob(id:')) {
        return Promise.resolve({ processJob });
      }
      return Promise.resolve(undefined);
    });
  }

  it('a cancelled encode is non-retryable (UnrecoverableError) and still reports nothing', async () => {
    mockSuccessfulGraphQL();
    const cancelled = new EncodeCancelledError('encode cancelled: source deleted');
    encodeMock.mockRejectedValue(cancelled);

    const rejection = await handleEncode(makeJob()).catch((err) => err);

    // The important assertion: BullMQ only exempts UnrecoverableError from
    // retrying, regardless of the job's configured attempts — a plain throw
    // here, even of EncodeCancelledError, would be retried and restart the
    // exact encode the cancellation was meant to stop.
    expect(rejection).toBeInstanceOf(UnrecoverableError);
    expect((rejection as Error).message).toBe('encode cancelled: source deleted');

    // Spec 054, REQ-8
    expect(fetchGraphQLMock.mock.calls.some(([query]) => (query as string).includes('encodeCompleted'))).toBe(false);
    expect(fetchGraphQLMock.mock.calls.some(([query]) => (query as string).includes('encodeFailed'))).toBe(false);
    expect(cleanupSourceMock).not.toHaveBeenCalled();
  });

  it('a KeyedError is non-retryable (UnrecoverableError) and still reports encodeFailed with its own key', async () => {
    mockSuccessfulGraphQL();
    const thrown = new KeyedError(ERROR_ENCODE_FFMPEG_FAILED, 'ffmpeg exited with code 1', {
      code: 1,
    });
    encodeMock.mockRejectedValue(thrown);

    const rejection = await handleEncode(makeJob()).catch((err) => err);

    expect(rejection).toBeInstanceOf(UnrecoverableError);
    expect((rejection as Error).message).toBe('ffmpeg exited with code 1');

    const failedCall = fetchGraphQLMock.mock.calls.find(([query]) =>
      (query as string).includes('encodeFailed'),
    );
    expect(failedCall).toBeDefined();
    const [, variables] = failedCall as [string, Record<string, unknown>];
    expect(variables.key).toBe(ERROR_ENCODE_FFMPEG_FAILED);
  });

  it('an unclassified throw stays a plain, retryable throw', async () => {
    mockSuccessfulGraphQL();
    const thrown = new Error('unexpected library crash');
    encodeMock.mockRejectedValue(thrown);

    const rejection = await handleEncode(makeJob()).catch((err) => err);

    // Spec 054, REQ-7
    expect(rejection).toBe(thrown);
    expect(rejection).not.toBeInstanceOf(UnrecoverableError);

    const failedCall = fetchGraphQLMock.mock.calls.find(([query]) =>
      (query as string).includes('encodeFailed'),
    );
    expect(failedCall).toBeDefined();
  });
});

// Defends Spec 095, REQ-13: a job the user discarded is dequeued anyway and
// api refuses encodeStarted. Reporting that as a failed encode, or letting
// BullMQ retry it against an input api already deleted, would resurrect a
// discarded file as an error with no one having asked for it.
describe('handleEncode — encodeStarted refused as discarded (Spec 095, REQ-13)', () => {
  it('reports nothing, never runs the encode driver and is non-retryable', async () => {
    fetchGraphQLMock.mockImplementation((query: string) => {
      if (query.includes('processJob(id:')) {
        return Promise.resolve({ processJob: PROCESS_JOB_DETAILS });
      }
      if (query.includes('encodeStarted')) {
        return Promise.reject(new KeyedError(ERROR_ENCODE_DISCARDED, 'Encode was discarded by the user'));
      }
      return Promise.resolve(undefined);
    });

    const rejection = await handleEncode(makeJob()).catch((err) => err);

    expect(rejection).toBeInstanceOf(UnrecoverableError);
    expect(encodeMock).not.toHaveBeenCalled();
    expect(passthroughMock).not.toHaveBeenCalled();
    expect(fetchGraphQLMock.mock.calls.some(([query]) => (query as string).includes('encodeFailed'))).toBe(false);
    expect(fetchGraphQLMock.mock.calls.some(([query]) => (query as string).includes('encodeCompleted'))).toBe(false);
    expect(cleanupSourceMock).not.toHaveBeenCalled();
  });
});

// Defends Spec 097, REQ-6: a stopped job is dequeued anyway and api refuses
// encodeStarted. Reporting that as a failure would flip it to ERROR if api's
// guard regressed, and a BullMQ retry would restart what the user stopped.
describe('handleEncode — encodeStarted refused as stopped (Spec 097, REQ-6)', () => {
  it('reports nothing, never runs the encode driver and is non-retryable', async () => {
    fetchGraphQLMock.mockImplementation((query: string) => {
      if (query.includes('processJob(id:')) {
        return Promise.resolve({ processJob: PROCESS_JOB_DETAILS });
      }
      if (query.includes('encodeStarted')) {
        return Promise.reject(new KeyedError(ERROR_ENCODE_STOPPED, 'Encode was stopped by the user'));
      }
      return Promise.resolve(undefined);
    });

    const rejection = await handleEncode(makeJob()).catch((err) => err);

    expect(rejection).toBeInstanceOf(UnrecoverableError);
    expect(encodeMock).not.toHaveBeenCalled();
    expect(passthroughMock).not.toHaveBeenCalled();
    expect(fetchGraphQLMock.mock.calls.some(([query]) => (query as string).includes('encodeFailed'))).toBe(false);
    expect(fetchGraphQLMock.mock.calls.some(([query]) => (query as string).includes('encodeCompleted'))).toBe(false);
    expect(cleanupSourceMock).not.toHaveBeenCalled();
  });
});

// Spec 100, REQ-6 REQ-9 REQ-10
describe('handleEncode — disc playlist assembly (Spec 100)', () => {
  let root: string;
  let playlist: string;
  let assembled: string;

  async function exists(path: string): Promise<boolean> {
    return stat(path).then(
      () => true,
      () => false,
    );
  }

  function mockGraphQL(processJob: Record<string, unknown>) {
    fetchGraphQLMock.mockImplementation((query: string) => {
      if (query.includes('processJob(id:')) return Promise.resolve({ processJob });
      if (query.includes('encodeCompleted')) {
        return Promise.resolve({
          encodeCompleted: { message: 'ok', removeTorrent: false, deleteInputFile: false, deleteDownloadPath: false },
        });
      }
      return Promise.resolve(undefined);
    });
  }

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'encode-job-disc-'));
    playlist = join(root, 'Film', 'BDMV', 'PLAYLIST', '00800.mpls');
    assembled = join(root, 'Film', '00800.perceptor.mkv');
    await mkdir(join(root, 'Film'), { recursive: true });
    await writeFile(assembled, 'assembled');
    assemblePlaylistMock.mockResolvedValue(assembled);
    buildOutputPathMock.mockReturnValue('/library/movies/A Movie (2020)/A Movie (2020).mkv');
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it('assembles after encodeStarted and hands the assembled path to encode(), keeping the playlist in the source tag', async () => {
    mockGraphQL({ ...PROCESS_JOB_DETAILS, inputFilePath: playlist, downloadsRoot: root, downloadPath: join(root, 'Film'), compressionEnabled: true });
    encodeMock.mockResolvedValue({ ffmpegCommand: 'ffmpeg' });

    await handleEncode(makeJob());

    expect(assemblePlaylistMock).toHaveBeenCalledTimes(1);
    expect(assemblePlaylistMock.mock.calls[0][0]).toBe(playlist);
    const startedIdx = fetchGraphQLMock.mock.calls.findIndex(([q]) => (q as string).includes('encodeStarted'));
    expect(startedIdx).toBeGreaterThanOrEqual(0);
    expect(assemblePlaylistMock.mock.invocationCallOrder[0]).toBeGreaterThan(
      fetchGraphQLMock.mock.invocationCallOrder[startedIdx],
    );

    const [input, , details] = encodeMock.mock.calls[0] as [string, string, { sourceTag: string }];
    expect(input).toBe(assembled);
    expect(details.sourceTag).toContain('00800.mpls');
    expect(details.sourceTag).not.toContain('perceptor.mkv');
    expect(cleanupSourceMock.mock.calls[0][0]).toMatchObject({ inputFilePath: playlist });
  });

  it('removes the assembled file after a successful compression-on encode', async () => {
    mockGraphQL({ ...PROCESS_JOB_DETAILS, inputFilePath: playlist, downloadsRoot: root, compressionEnabled: true });
    encodeMock.mockResolvedValue({ ffmpegCommand: 'ffmpeg' });

    await handleEncode(makeJob());

    expect(await exists(assembled)).toBe(false);
  });

  it('removes the assembled file when the encode fails', async () => {
    mockGraphQL({ ...PROCESS_JOB_DETAILS, inputFilePath: playlist, downloadsRoot: root, compressionEnabled: true });
    encodeMock.mockRejectedValue(new Error('boom'));

    await expect(handleEncode(makeJob())).rejects.toThrow('boom');

    expect(await exists(assembled)).toBe(false);
  });

  it('removes the assembled file when the encode is cancelled', async () => {
    mockGraphQL({ ...PROCESS_JOB_DETAILS, inputFilePath: playlist, downloadsRoot: root, compressionEnabled: true });
    encodeMock.mockRejectedValue(new EncodeCancelledError());

    await expect(handleEncode(makeJob())).rejects.toBeInstanceOf(UnrecoverableError);

    expect(await exists(assembled)).toBe(false);
  });

  it('passes the assembled path to passthrough, keeps the .mkv extension and does not touch the file afterwards', async () => {
    mockGraphQL({ ...PROCESS_JOB_DETAILS, inputFilePath: playlist, downloadsRoot: root, compressionEnabled: false });
    passthroughMock.mockResolvedValue({ ffmpegCommand: '' });

    await handleEncode(makeJob());

    expect(encodeMock).not.toHaveBeenCalled();
    const [input, output] = passthroughMock.mock.calls[0] as [string, string];
    expect(input).toBe(assembled);
    expect(output).toBe('/library/movies/A Movie (2020)/A Movie (2020).mkv');
    // The mocked passthrough moves nothing, so a surviving file proves no removal was attempted.
    expect(await exists(assembled)).toBe(true);
  });

  it('removes the assembled file when passthrough itself fails', async () => {
    mockGraphQL({ ...PROCESS_JOB_DETAILS, inputFilePath: playlist, downloadsRoot: root, compressionEnabled: false });
    passthroughMock.mockRejectedValue(new Error('disk full'));

    await expect(handleEncode(makeJob())).rejects.toThrow('disk full');

    expect(await exists(assembled)).toBe(false);
  });

  it('reports encodeFailed with disc_remux_failed and its params when assembly fails, and never runs a driver', async () => {
    mockGraphQL({ ...PROCESS_JOB_DETAILS, inputFilePath: playlist, downloadsRoot: root, compressionEnabled: true });
    assemblePlaylistMock.mockRejectedValue(
      new KeyedError(ERROR_ENCODE_DISC_REMUX_FAILED, 'mkvmerge failed', { code: 2, stderr: 'Error: bad clip' }),
    );

    await expect(handleEncode(makeJob())).rejects.toBeInstanceOf(UnrecoverableError);

    const failed = fetchGraphQLMock.mock.calls.find(([q]) => (q as string).includes('encodeFailed'));
    expect(failed).toBeDefined();
    const variables = (failed as [string, Record<string, unknown>])[1];
    expect(variables.key).toBe(ERROR_ENCODE_DISC_REMUX_FAILED);
    expect(JSON.parse(variables.params as string)).toEqual({ code: 2, stderr: 'Error: bad clip' });
    expect(encodeMock).not.toHaveBeenCalled();
    expect(passthroughMock).not.toHaveBeenCalled();
    expect(await exists(assembled)).toBe(true);
  });

  it('never calls the assembler for a non-playlist input', async () => {
    mockGraphQL({ ...PROCESS_JOB_DETAILS, compressionEnabled: true });
    encodeMock.mockResolvedValue({ ffmpegCommand: 'ffmpeg' });

    await handleEncode(makeJob());

    expect(assemblePlaylistMock).not.toHaveBeenCalled();
    expect(encodeMock.mock.calls[0][0]).toBe('/downloads/movie.mkv');
  });

  it('refuses to remove an assembled path outside downloadsRoot', async () => {
    mockGraphQL({ ...PROCESS_JOB_DETAILS, inputFilePath: playlist, downloadsRoot: join(root, 'elsewhere'), compressionEnabled: true });
    encodeMock.mockResolvedValue({ ffmpegCommand: 'ffmpeg' });

    await handleEncode(makeJob());

    expect(await exists(assembled)).toBe(true);
  });
});

// Defends the payload seam of 110-audio-variant-detection: the field dropped from the selection set,
// or a missing value read as true, would run a multi-minute transcription nobody opted into.
describe('handleEncode — audioVariantDetection (Spec 110, REQ-5)', () => {
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

  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, 'log').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('queries audioVariantDetection', async () => {
    mockSuccessfulGraphQL({ ...PROCESS_JOB_DETAILS, audioVariantDetection: true });
    encodeMock.mockResolvedValue({ ffmpegCommand: 'ffmpeg -i ...' });
    await handleEncode(makeJob());
    expect(fetchGraphQLMock.mock.calls[0][0]).toContain('audioVariantDetection');
  });

  it('a true value reaches the encode() call', async () => {
    mockSuccessfulGraphQL({ ...PROCESS_JOB_DETAILS, audioVariantDetection: true });
    encodeMock.mockResolvedValue({ ffmpegCommand: 'ffmpeg -i ...' });
    await handleEncode(makeJob());
    const [, , details] = encodeMock.mock.calls[0] as [string, string, Record<string, unknown>];
    expect(details.audioVariantDetection).toBe(true);
  });

  it('a missing value normalizes to false and logs', async () => {
    mockSuccessfulGraphQL(PROCESS_JOB_DETAILS);
    encodeMock.mockResolvedValue({ ffmpegCommand: 'ffmpeg -i ...' });
    await handleEncode(makeJob());
    const [, , details] = encodeMock.mock.calls[0] as [string, string, Record<string, unknown>];
    expect(details.audioVariantDetection).toBe(false);
    expect(console.log).toHaveBeenCalledWith(expect.stringContaining('audioVariantDetection missing or not a boolean'));
  });

  it('a non-boolean value normalizes to false', async () => {
    mockSuccessfulGraphQL({ ...PROCESS_JOB_DETAILS, audioVariantDetection: 'true' });
    encodeMock.mockResolvedValue({ ffmpegCommand: 'ffmpeg -i ...' });
    await handleEncode(makeJob());
    const [, , details] = encodeMock.mock.calls[0] as [string, string, Record<string, unknown>];
    expect(details.audioVariantDetection).toBe(false);
  });
});
