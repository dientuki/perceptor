// Audio language detection fails silently in every direction: relabelling a track the file already tags
// (or one that is a commentary) rewrites a correct language, running with compression off burns CPU
// for nothing, mutating the probe metadata leaks a guess into later steps, a detection error that is
// stored or reported as "undetermined" fails an encode that would have succeeded, and a swallowed
// cancellation keeps a deleted source's work running. The resolver is tested with the capture spawn
// and the verdict store mocked.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { EncodeCancelledError } from './cancellation';
import { resolveAudioLanguages } from './audio-language';
import { DETECTOR_REVISION } from './audio-language-score';
import { fileIdentity, readVerdict, writeVerdict } from './verdict-store';
import { runFfmpegCapture } from '../ffmpeg/capture';
import { KeyedError } from '../i18n/keyed-error';

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

const details = { compressionEnabled: true, originalLanguageIso3: 'jpn', allowedAudioLanguagesIso3: ['jpn', 'eng'] };
const stream = (index: number, tags: Record<string, string> | undefined, extra: Record<string, unknown> = {}) => ({
  index,
  codec_type: 'audio',
  channels: 2,
  channel_layout: 'stereo',
  tags,
  ...extra,
});
const meta = (streams: any[]) => ({ format: { duration: '3600' }, streams });

type Script = { votes: string[]; vad?: string };

function script({ votes, vad }: Script) {
  let whisper = 0;
  mockCapture.mockImplementation(async (_args, _signal, options) => {
    if (options?.binary === 'whisper-cli') {
      return { code: 0, stdoutBytes: 0, stderr: votes[whisper++] ?? votes[votes.length - 1], stdout: '' };
    }
    if (options?.binary === 'whisper-vad-speech-segments') {
      return { code: 0, stdoutBytes: 1, stderr: '', stdout: vad ?? '' };
    }
    return { code: 0, stdoutBytes: 0, stderr: '' };
  });
}

const line = (code: string, p: number) => `whisper_full_with_state: auto-detected language: ${code} (p = ${p})`;
const SPEECH = 'Speech segment 0: start = 0.00, end = 600000.00';
const binaries = () => mockCapture.mock.calls.map((c) => c[2]?.binary ?? 'ffmpeg');

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

describe('resolveAudioLanguages gate', () => {
  it('returns the input untouched when an original-language stream is present', async () => {
    const m = meta([stream(1, { language: 'jpn' }), stream(2, undefined)]);
    const result = await resolveAudioLanguages(details, '/a.mkv', m, signal);
    expect(result.metadata).toBe(m);
    expect(mockCapture).not.toHaveBeenCalled();
  });

  it('never considers a stream tagged with another language', async () => {
    const m = meta([stream(1, { language: 'eng' })]);
    const result = await resolveAudioLanguages(details, '/a.mkv', m, signal);
    expect(result.metadata).toBe(m);
    expect(mockCapture).not.toHaveBeenCalled();
  });

  it('does nothing with compression off', async () => {
    const m = meta([stream(1, undefined)]);
    const result = await resolveAudioLanguages({ ...details, compressionEnabled: false }, '/a.mkv', m, signal);
    expect(result.metadata).toBe(m);
    expect(mockCapture).not.toHaveBeenCalled();
  });

  it('skips a stream whose title is a commentary', async () => {
    const m = meta([stream(1, { title: 'Director Commentary' })]);
    await resolveAudioLanguages(details, '/a.mkv', m, signal);
    expect(mockCapture).not.toHaveBeenCalled();
  });

  it('skips a stream flagged disposition.comment', async () => {
    const m = meta([stream(1, { language: 'und' }, { disposition: { comment: 1 } })]);
    await resolveAudioLanguages(details, '/a.mkv', m, signal);
    expect(mockCapture).not.toHaveBeenCalled();
  });
});

describe('resolveAudioLanguages detection', () => {
  it('decides on attempt 1 and never runs the VAD', async () => {
    script({ votes: [line('ja', 0.95)] });
    const m = meta([stream(1, undefined), stream(2, { language: 'eng' })]);
    const result = await resolveAudioLanguages(details, '/a.mkv', m, signal);
    expect(binaries()).not.toContain('whisper-vad-speech-segments');
    expect(result.metadata.streams[0].tags.language).toBe('jpn');
    expect(result.undetermined).toEqual([]);
    expect(mockWrite).toHaveBeenCalledWith('audio-language', expect.anything(), { iso3: 'jpn' });
  });

  it('runs attempt 2 only when attempt 1 is not valid', async () => {
    script({ votes: [line('ja', 0.3), line('ja', 0.3), line('ja', 0.3), line('ja', 0.9), line('ja', 0.9), line('ja', 0.9)], vad: SPEECH });
    const m = meta([stream(1, { language: 'und' })]);
    const result = await resolveAudioLanguages(details, '/a.mkv', m, signal);
    expect(binaries()).toContain('whisper-vad-speech-segments');
    expect(result.metadata.streams[0].tags.language).toBe('jpn');
  });

  it('does not mutate the input metadata', async () => {
    script({ votes: [line('ja', 0.95)] });
    const m = meta([stream(1, undefined)]);
    const snapshot = JSON.parse(JSON.stringify(m));
    const result = await resolveAudioLanguages(details, '/a.mkv', m, signal);
    expect(m).toEqual(snapshot);
    expect(result.metadata).not.toBe(m);
  });
});

describe('resolveAudioLanguages outcomes (REQ-6)', () => {
  it('throws the undetermined key when no original is found and a candidate is undecided', async () => {
    script({ votes: [line('ja', 0.3)], vad: '' });
    const m = meta([stream(1, undefined)]);
    const error = await resolveAudioLanguages(details, '/a.mkv', m, signal).catch((e) => e);
    expect(error).toBeInstanceOf(KeyedError);
    expect(error.key).toBe('error.encode.original_audio_undetermined');
    expect(error.params).toEqual({ iso3: 'jpn' });
    expect(mockWrite).toHaveBeenCalledWith('audio-language', expect.anything(), { undecided: true });
  });

  it('returns without throwing when every candidate was decided as another language', async () => {
    script({ votes: [line('en', 0.95)] });
    const m = meta([stream(1, undefined)]);
    const result = await resolveAudioLanguages(details, '/a.mkv', m, signal);
    expect(result.metadata.streams[0].tags.language).toBe('eng');
    expect(result.undetermined).toEqual([]);
  });

  it('returns the undecided index when another candidate rescued the original', async () => {
    script({ votes: [line('ja', 0.95), line('ja', 0.95), line('ja', 0.95), line('ja', 0.3)], vad: '' });
    const m = meta([stream(1, undefined), stream(2, undefined)]);
    const result = await resolveAudioLanguages(details, '/a.mkv', m, signal);
    expect(result.metadata.streams[0].tags.language).toBe('jpn');
    expect(result.undetermined).toEqual([2]);
  });
});

describe('resolveAudioLanguages failures', () => {
  it('stores nothing and does not throw the new key when detection errors', async () => {
    mockCapture.mockResolvedValue({ code: 1, stdoutBytes: 0, stderr: 'boom' });
    const m = meta([stream(1, undefined)]);
    const result = await resolveAudioLanguages(details, '/a.mkv', m, signal);
    expect(result.undetermined).toEqual([]);
    expect(mockWrite).not.toHaveBeenCalled();
  });

  it('treats an unparseable whisper output as a failure, not a no-vote', async () => {
    script({ votes: ['garbage'] });
    const m = meta([stream(1, undefined)]);
    const result = await resolveAudioLanguages(details, '/a.mkv', m, signal);
    expect(result.undetermined).toEqual([]);
    expect(mockWrite).not.toHaveBeenCalled();
    expect(binaries()).not.toContain('whisper-vad-speech-segments');
  });

  it('propagates a cancellation and stores nothing', async () => {
    mockCapture.mockRejectedValue(new EncodeCancelledError());
    const m = meta([stream(1, undefined)]);
    await expect(resolveAudioLanguages(details, '/a.mkv', m, signal)).rejects.toBeInstanceOf(EncodeCancelledError);
    expect(mockWrite).not.toHaveBeenCalled();
  });
});

describe('resolveAudioLanguages stored verdicts', () => {
  it('reuses a stored verdict with no spawn and keys it by detector revision', async () => {
    mockRead.mockResolvedValue({ iso3: 'jpn' });
    const m = meta([stream(1, undefined)]);
    const result = await resolveAudioLanguages(details, '/a.mkv', m, signal);
    expect(mockCapture).not.toHaveBeenCalled();
    expect(mockRead).toHaveBeenCalledWith('audio-language', { ...FILE, stream: 1, rev: DETECTOR_REVISION });
    expect(result.metadata.streams[0].tags.language).toBe('jpn');
  });
});
