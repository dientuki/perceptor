// Defends the whole ffmpeg argument-building chain — buildFfmpegCommand and
// the three rule functions in params.ts — against the failure this service
// makes silently: a track selected wrong, a language dropped, an argument
// lost. FFmpeg still exits 0, the ProcessJob still reports COMPLETED, and the
// file lands in the library with the wrong audio or the wrong subtitles, with
// no error in any log (Constitution, Article IX).
//
// Each case in ../../ffmpeg is the verbatim ffprobe output of a real file
// plus the exact command it must produce. Adding a case is adding a JSON
// file: nothing here is edited, and no factory helper transcribes a stream by
// hand — which is what used to lose the one field that mattered.

import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { buildFfmpegCommand } from './buildCommand';
import { KeyedError } from '../i18n/keyed-error';

const CASES_DIR = join(__dirname, '..', '..', 'ffmpeg');

type CaseInput = {
  file: string;
  output: string;
  allowedLanguagesIso3: string[];
  originalLanguageIso3: string;
  isLiveAction: boolean;
  vulkanAvailable: boolean;
};

type Case = {
  title: string;
  input: CaseInput;
  ffprobe: unknown;
  ffmpeg?: string[];
  throws?: string;
};

type LoadedCase = { fileName: string; parsed: Case };

function fail(fileName: string, problem: string): never {
  throw new Error(`ffmpeg case "${fileName}": ${problem}`);
}

function validate(fileName: string, raw: unknown): Case {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    fail(fileName, 'must be a JSON object');
  }

  const value = raw as Record<string, unknown>;

  if (typeof value.title !== 'string' || value.title.trim() === '') {
    fail(fileName, 'is missing a non-empty "title"');
  }

  const input = value.input;
  if (typeof input !== 'object' || input === null || Array.isArray(input)) {
    fail(fileName, 'is missing an "input" object');
  }

  const {
    file,
    output,
    allowedLanguagesIso3,
    originalLanguageIso3,
    isLiveAction,
    vulkanAvailable,
  } = input as Record<string, unknown>;

  if (typeof file !== 'string') fail(fileName, 'input.file must be a string');
  if (typeof output !== 'string') fail(fileName, 'input.output must be a string');
  if (
    !Array.isArray(allowedLanguagesIso3) ||
    allowedLanguagesIso3.some((lang) => typeof lang !== 'string')
  ) {
    fail(fileName, 'input.allowedLanguagesIso3 must be an array of strings');
  }
  if (typeof originalLanguageIso3 !== 'string') {
    fail(fileName, 'input.originalLanguageIso3 must be a string');
  }
  if (typeof isLiveAction !== 'boolean') fail(fileName, 'input.isLiveAction must be a boolean');
  if (typeof vulkanAvailable !== 'boolean') {
    fail(fileName, 'input.vulkanAvailable must be a boolean');
  }

  const probe = value.ffprobe;
  if (typeof probe !== 'object' || probe === null || !Array.isArray((probe as any).streams)) {
    fail(fileName, 'is missing an "ffprobe" object with a "streams" array');
  }

  const hasCommand = value.ffmpeg !== undefined;
  const hasThrows = value.throws !== undefined;

  if (hasCommand === hasThrows) {
    fail(fileName, 'must declare exactly one of "ffmpeg" or "throws"');
  }
  if (hasCommand && (!Array.isArray(value.ffmpeg) || value.ffmpeg.some((a) => typeof a !== 'string'))) {
    fail(fileName, '"ffmpeg" must be an array of strings');
  }
  if (hasThrows && (typeof value.throws !== 'string' || value.throws.trim() === '')) {
    fail(fileName, '"throws" must be a non-empty error key');
  }

  return value as unknown as Case;
}

function loadCases(): LoadedCase[] {
  let fileNames: string[];

  try {
    fileNames = readdirSync(CASES_DIR)
      .filter((name) => name.endsWith('.json'))
      .sort();
  } catch (error) {
    throw new Error(
      `ffmpeg cases directory ${CASES_DIR} could not be read: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }

  // A glob that resolved to the wrong place makes vitest report a green run
  // with zero tests, which is the same as having no suite at all.
  if (fileNames.length === 0) {
    throw new Error(`ffmpeg cases directory ${CASES_DIR} holds no .json case`);
  }

  return fileNames.map((fileName) => {
    let raw: unknown;
    try {
      raw = JSON.parse(readFileSync(join(CASES_DIR, fileName), 'utf8'));
    } catch (error) {
      fail(fileName, `is not valid JSON — ${error instanceof Error ? error.message : String(error)}`);
    }
    return { fileName, parsed: validate(fileName, raw) };
  });
}

// Loading at module scope on purpose: a malformed case fails collection, so
// the suite cannot report green while quietly running fewer cases than the
// directory holds.
const cases = loadCases();

describe('ffmpeg cases', () => {
  let sampleSeconds: string | undefined;

  beforeEach(() => {
    // buildFfmpegCommand appends "-t <n>" when this is set (see
    // buildCommand.ts). Left in place it would fail every case for a reason
    // that has nothing to do with the rules under test.
    sampleSeconds = process.env.ENCODE_SAMPLE_SECONDS;
    delete process.env.ENCODE_SAMPLE_SECONDS;
  });

  afterEach(() => {
    if (sampleSeconds === undefined) {
      delete process.env.ENCODE_SAMPLE_SECONDS;
    } else {
      process.env.ENCODE_SAMPLE_SECONDS = sampleSeconds;
    }
  });

  it.each(cases)('$fileName — $parsed.title', ({ parsed }) => {
    const { input } = parsed;
    const details = {
      allowedLanguagesIso3: input.allowedLanguagesIso3,
      originalLanguageIso3: input.originalLanguageIso3,
      isLiveAction: input.isLiveAction,
    };

    const build = () =>
      buildFfmpegCommand(
        input.file,
        input.output,
        parsed.ffprobe as any,
        details,
        input.vulkanAvailable,
      );

    if (parsed.throws !== undefined) {
      let thrown: unknown;
      try {
        build();
      } catch (error) {
        thrown = error;
      }

      expect(thrown, 'expected the case to throw, but a command was built').toBeInstanceOf(
        KeyedError,
      );
      expect((thrown as KeyedError).key).toBe(parsed.throws);
      return;
    }

    expect(build()).toEqual(parsed.ffmpeg);
  });
});
