// Audio variant detection fails silently in both directions: transcribing when the user did not opt in
// burns minutes of CPU, a wrong candidate set (a stream already resolved by its title, or three Spanish
// tracks) labels the wrong dub, a leaked temp directory fills the downloads volume, and a swallowed
// cancellation keeps a deleted source's work running. The resolver is tested with the capture spawn
// mocked: no capture unless opted in and exactly two unresolved streams of one language, every failure
// degrades to the empty resolution, a cancellation propagates, and each verdict kind maps to the
// resolution the command builder consumes.

import { existsSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { EncodeCancelledError } from './cancellation';
import { buildWindowExtractArgs, resolveAudioVariants, windowStarts } from './audio-variant';
import { fileIdentity, readVerdict, writeVerdict } from './verdict-store';
import { runFfmpegCapture } from '../ffmpeg/capture';
import { NO_AUDIO_VARIANTS } from '../ffmpeg/variants';

vi.mock('../ffmpeg/capture', () => ({ runFfmpegCapture: vi.fn() }));

vi.mock('./verdict-store', () => ({
  fileIdentity: vi.fn(),
  readVerdict: vi.fn(),
  writeVerdict: vi.fn(),
}));

const mockCapture = vi.mocked(runFfmpegCapture);
const mockIdentity = vi.mocked(fileIdentity);
const mockRead = vi.mocked(readVerdict);
const mockWrite = vi.mocked(writeVerdict);
const FILE = { path: '/a.mkv', size: 1000, mtimeMs: 5 };
const signal = new AbortController().signal;

function audio(index: number, channels: number, extra: Record<string, unknown> = {}, language = 'spa') {
  return {
    index,
    codec_type: 'audio',
    codec_name: 'ac3',
    channels,
    channel_layout: channels === 6 ? '5.1(side)' : 'stereo',
    tags: { language },
    ...extra,
  };
}

const on = { audioVariantDetection: true, allowedAudioLanguagesIso3: ['eng', 'spa'] };
const metadata = (streams: any[]) => ({ format: { duration: '3600' }, streams });
const pairMetadata = metadata([audio(1, 6, {}, 'eng'), audio(2, 6), audio(3, 6)]);

const CASTILIAN = 'vale, vosotros habéis llegado. a por ellos, tío. vale.\nos lo dije, vale.';
const LATAM = 'ustedes manejan el carro.\nel celular y la computadora.\nqué pasó, carajo.';

function mockTranscripts(first: string, second: string) {
  let whisperCalls = 0;
  mockCapture.mockImplementation(async (_args, _signal, options) => {
    if (options?.binary === 'whisper-cli') {
      return { code: 0, stdoutBytes: 1, stderr: '', stdout: whisperCalls++ === 0 ? first : second };
    }
    return { code: 0, stdoutBytes: 0, stderr: '' };
  });
}

beforeEach(() => {
  mockCapture.mockReset();
  mockIdentity.mockReset().mockResolvedValue(FILE);
  mockRead.mockReset().mockResolvedValue(undefined);
  mockWrite.mockReset().mockResolvedValue(undefined);
  vi.spyOn(console, 'log').mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('resolveAudioVariants gating', () => {
  it('captures nothing when the opt-in is off', async () => {
    const result = await resolveAudioVariants({ ...on, audioVariantDetection: false }, '/a.mkv', pairMetadata, signal);
    expect(result).toBe(NO_AUDIO_VARIANTS);
    expect(mockCapture).not.toHaveBeenCalled();
  });

  it('captures nothing for a single unresolved stream', async () => {
    await resolveAudioVariants(on, '/a.mkv', metadata([audio(1, 6, {}, 'eng'), audio(2, 6)]), signal);
    expect(mockCapture).not.toHaveBeenCalled();
  });

  it('captures nothing for three unresolved streams', async () => {
    await resolveAudioVariants(on, '/a.mkv', metadata([audio(1, 6), audio(2, 6), audio(3, 6)]), signal);
    expect(mockCapture).not.toHaveBeenCalled();
  });

  it('excludes streams already resolved by their title, leaving one candidate', async () => {
    const streams = [audio(1, 6), audio(2, 6, { tags: { language: 'spa', title: 'Latino' } })];
    await resolveAudioVariants(on, '/a.mkv', metadata(streams), signal);
    expect(mockCapture).not.toHaveBeenCalled();
  });

  it('captures nothing when the language is not in the allowed list', async () => {
    await resolveAudioVariants({ ...on, allowedAudioLanguagesIso3: ['eng'] }, '/a.mkv', pairMetadata, signal);
    expect(mockCapture).not.toHaveBeenCalled();
  });
});

describe('resolveAudioVariants verdicts', () => {
  it('maps a decided verdict to tags and runs whisper once per stream', async () => {
    mockTranscripts(CASTILIAN, LATAM);
    const result = await resolveAudioVariants(on, '/a.mkv', pairMetadata, signal);
    expect([...result.tags.entries()]).toEqual(expect.arrayContaining([[2, 'es-ES'], [3, 'es-419']]));
    expect(result.duplicates.size).toBe(0);
    const whisper = mockCapture.mock.calls.filter(([, , o]) => o?.binary === 'whisper-cli');
    expect(whisper).toHaveLength(2);
    expect(whisper[0][2]).toMatchObject({ keepStdout: true });
    expect(whisper[0][0]).toEqual(expect.arrayContaining(['-l', 'es', '-nt', '-np']));
  });

  it('drops the stream with fewer channels on a duplicate', async () => {
    const same = 'hola amigo como estas hoy\nque tal todo bien por aqui';
    mockTranscripts(same, same);
    const metadataFewer = metadata([audio(2, 6), audio(3, 2)]);
    const result = await resolveAudioVariants(on, '/a.mkv', metadataFewer, signal);
    expect(result.tags.size).toBe(0);
    expect([...result.duplicates]).toEqual([3]);
  });

  it('drops the higher index on a duplicate with equal channels', async () => {
    const same = 'hola amigo como estas hoy\nque tal todo bien por aqui';
    mockTranscripts(same, same);
    const result = await resolveAudioVariants(on, '/a.mkv', metadata([audio(2, 6), audio(3, 6)]), signal);
    expect([...result.duplicates]).toEqual([3]);
  });

  it('returns the empty resolution on an undecided verdict', async () => {
    mockTranscripts('hola amigo, qué tal', 'buenas noches a todos los presentes');
    const result = await resolveAudioVariants(on, '/a.mkv', pairMetadata, signal);
    expect(result.tags.size).toBe(0);
    expect(result.duplicates.size).toBe(0);
  });
});

describe('resolveAudioVariants failure and abort', () => {
  it('returns the empty resolution when whisper-cli exits non-zero', async () => {
    mockCapture.mockImplementation(async (_a, _s, options) => ({
      code: options?.binary === 'whisper-cli' ? 1 : 0,
      stdoutBytes: 0,
      stderr: '',
    }));
    expect(await resolveAudioVariants(on, '/a.mkv', pairMetadata, signal)).toBe(NO_AUDIO_VARIANTS);
    expect(console.log).toHaveBeenCalledWith(expect.stringContaining('[variant] detection failed'));
  });

  it('returns the empty resolution when the capture rejects', async () => {
    mockCapture.mockRejectedValue(new Error('spawn whisper-cli ENOENT'));
    expect(await resolveAudioVariants(on, '/a.mkv', pairMetadata, signal)).toBe(NO_AUDIO_VARIANTS);
  });

  it('propagates EncodeCancelledError', async () => {
    mockCapture.mockRejectedValue(new EncodeCancelledError());
    await expect(resolveAudioVariants(on, '/a.mkv', pairMetadata, signal)).rejects.toBeInstanceOf(EncodeCancelledError);
  });

  it('removes the wav directory on success and on failure', async () => {
    const dirs: string[] = [];
    mockCapture.mockImplementation(async (args, _s, options) => {
      if (options?.binary !== 'whisper-cli') dirs.push(String(args[args.length - 1]));
      return { code: 0, stdoutBytes: 0, stderr: '', stdout: 'x' };
    });
    await resolveAudioVariants(on, '/a.mkv', pairMetadata, signal);
    mockCapture.mockImplementation(async (args, _s, options) => {
      if (options?.binary !== 'whisper-cli') dirs.push(String(args[args.length - 1]));
      throw new Error('boom');
    });
    await resolveAudioVariants(on, '/a.mkv', pairMetadata, signal);
    expect(dirs.length).toBeGreaterThanOrEqual(3);
    expect(dirs.every((wav) => wav.endsWith('.wav') && !existsSync(wav))).toBe(true);
    expect(dirs.every((wav) => !existsSync(wav.replace(/\/[^/]+$/, '')))).toBe(true);
  });
});

describe('resolveAudioVariants verdict store', () => {
  const identity = { ...FILE, iso3: 'spa', streams: [2, 3] };
  const whisperCalls = () => mockCapture.mock.calls.filter(([, , o]) => o?.binary === 'whisper-cli');

  it('reuses a stored decided verdict without any capture', async () => {
    mockRead.mockResolvedValue({ kind: 'decided', scores: [3, -3], tags: { 2: 'es-ES', 3: 'es-419' } } as any);
    const result = await resolveAudioVariants(on, '/a.mkv', pairMetadata, signal);
    expect(mockCapture).not.toHaveBeenCalled();
    expect([...result.tags.entries()]).toEqual(expect.arrayContaining([[2, 'es-ES'], [3, 'es-419']]));
    expect(mockRead).toHaveBeenCalledWith('audio-variant', identity);
    expect(mockWrite).not.toHaveBeenCalled();
    expect(console.log).toHaveBeenCalledWith(expect.stringContaining('(reused)'));
  });

  it('reuses a stored undecided verdict without any capture', async () => {
    mockRead.mockResolvedValue({ kind: 'undecided', scores: [0, 0] } as any);
    const result = await resolveAudioVariants(on, '/a.mkv', pairMetadata, signal);
    expect(mockCapture).not.toHaveBeenCalled();
    expect(result.tags.size).toBe(0);
    expect(result.duplicates.size).toBe(0);
  });

  it('reuses a stored duplicate verdict without any capture', async () => {
    mockRead.mockResolvedValue({ kind: 'duplicate', similarity: 0.99 } as any);
    const result = await resolveAudioVariants(on, '/a.mkv', metadata([audio(2, 6), audio(3, 2)]), signal);
    expect(mockCapture).not.toHaveBeenCalled();
    expect([...result.duplicates]).toEqual([3]);
  });

  it('runs detection when the stored verdict belongs to another file', async () => {
    mockRead.mockImplementation(async (_kind, id: any) =>
      id?.size === 999 ? ({ kind: 'undecided', scores: [0, 0] } as any) : undefined,
    );
    mockTranscripts(CASTILIAN, LATAM);
    const result = await resolveAudioVariants(on, '/a.mkv', pairMetadata, signal);
    expect(whisperCalls()).toHaveLength(2);
    expect(result.tags.size).toBe(2);
  });

  it('writes a decided verdict under the input file, iso3 and stream indices', async () => {
    mockTranscripts(CASTILIAN, LATAM);
    await resolveAudioVariants(on, '/a.mkv', pairMetadata, signal);
    expect(mockWrite).toHaveBeenCalledTimes(1);
    expect(mockWrite).toHaveBeenCalledWith('audio-variant', identity, expect.objectContaining({ kind: 'decided' }));
  });

  it('writes an undecided verdict', async () => {
    mockTranscripts('hola amigo, qué tal', 'buenas noches a todos los presentes');
    await resolveAudioVariants(on, '/a.mkv', pairMetadata, signal);
    expect(mockWrite).toHaveBeenCalledWith('audio-variant', identity, expect.objectContaining({ kind: 'undecided' }));
  });

  it('writes a duplicate verdict', async () => {
    const same = 'hola amigo como estas hoy\nque tal todo bien por aqui';
    mockTranscripts(same, same);
    await resolveAudioVariants(on, '/a.mkv', metadata([audio(2, 6), audio(3, 6)]), signal);
    expect(mockWrite).toHaveBeenCalledWith('audio-variant', identity, expect.objectContaining({ kind: 'duplicate' }));
  });

  it('stores nothing when whisper-cli fails', async () => {
    mockCapture.mockImplementation(async (_a, _s, options) => ({
      code: options?.binary === 'whisper-cli' ? 1 : 0,
      stdoutBytes: 0,
      stderr: '',
    }));
    await resolveAudioVariants(on, '/a.mkv', pairMetadata, signal);
    expect(mockWrite).not.toHaveBeenCalled();
  });

  it('stores nothing and propagates when aborted', async () => {
    mockCapture.mockRejectedValue(new EncodeCancelledError());
    await expect(resolveAudioVariants(on, '/a.mkv', pairMetadata, signal)).rejects.toBeInstanceOf(EncodeCancelledError);
    expect(mockWrite).not.toHaveBeenCalled();
  });

  it('still detects and returns the resolution when the store cannot be read or written', async () => {
    // the real store swallows its own failures into a miss / no-op; this is that observable behaviour
    mockRead.mockResolvedValue(undefined);
    mockWrite.mockResolvedValue(undefined);
    mockIdentity.mockResolvedValue(null);
    mockTranscripts(CASTILIAN, LATAM);
    const result = await resolveAudioVariants(on, '/a.mkv', pairMetadata, signal);
    expect(whisperCalls()).toHaveLength(2);
    expect(result.tags.size).toBe(2);
    expect(mockRead).toHaveBeenCalledWith('audio-variant', null);
  });
});

describe('window extraction', () => {
  it('places three windows proportionally and never past the end', () => {
    expect(windowStarts(3600)).toEqual([840, 1740, 2640]);
    expect(windowStarts(130).every((s) => s >= 0 && s <= 10)).toBe(true);
  });

  it('takes the centre channel when the layout has FC, else falls back to -ac 1 only', () => {
    const withCentre = buildWindowExtractArgs('/a.mkv', audio(2, 6), [0, 100, 200], '/t/2.wav');
    expect(withCentre.join(' ')).toContain('pan=mono|c0=FC');
    expect(withCentre.join(' ')).toContain('[0:2]');
    const stereo = buildWindowExtractArgs('/a.mkv', audio(3, 2), [0, 100, 200], '/t/3.wav');
    expect(stereo.join(' ')).not.toContain('pan=');
    expect(stereo).toEqual(expect.arrayContaining(['-ac', '1', '-ar', '16000']));
  });
});
