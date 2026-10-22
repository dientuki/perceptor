// Defends against a key with no English rendering, which persists `undefined`
// into ProcessJob.errorMessage with no error at any point — renderMessage's
// own guard only fires at runtime, on the one row that happens to hit it.
// This suite makes that guard fire at test time instead, for every key, and
// checks the placeholder/param contract each throw site actually relies on.

import { describe, expect, it } from 'vitest';
import * as errorKeys from './error-keys';
import { messagesEn, renderMessage } from './messages.en';

const ALL_KEYS: string[] = (Object.values(errorKeys) as unknown[]).filter(
  (value) => typeof value === 'string',
) as string[];

describe('messagesEn — every key in error-keys.ts has an English message', () => {
  it('has no exported key constant without a matching message', () => {
    for (const key of ALL_KEYS) {
      expect(messagesEn, `missing message for key "${key}"`).toHaveProperty(key);
    }
  });

  it('has no message for a key that error-keys.ts no longer exports', () => {
    for (const key of Object.keys(messagesEn)) {
      expect(ALL_KEYS, `messages.en.ts has a stray key "${key}" not in error-keys.ts`).toContain(key);
    }
  });
});

// A reasonable heuristic, not exhaustive: for every key, the params the
// throw sites are known to pass (from ../ffmpeg, ../paths, ../encode,
// ../jobs) must satisfy every {placeholder} in that key's template, so
// renderMessage never leaves a literal "{foo}" in a persisted errorMessage.
const KNOWN_PARAMS: Record<string, Record<string, string | number>> = {
  [errorKeys.ERROR_ENCODE_NO_VIDEO_STREAM]: {},
  [errorKeys.ERROR_ENCODE_NO_ORIGINAL_AUDIO]: { iso3: 'eng' },
  [errorKeys.ERROR_ENCODE_PROBE_FAILED]: { filePath: '/tmp/movie.mkv', detail: 'ffprobe crashed' },
  [errorKeys.ERROR_ENCODE_FFMPEG_FAILED]: { code: 1, stderr: 'tail of stderr' },
  [errorKeys.ERROR_ENCODE_NO_OUTPUT]: { path: '/library/movies/movie.mkv' },
  [errorKeys.ERROR_ENCODE_MKVMERGE_FAILED]: { code: 2, stderr: 'mkvmerge tail' },
  [errorKeys.ERROR_ENCODE_MOVE_FAILED]: { detail: 'EACCES: permission denied' },
  [errorKeys.ERROR_ENCODE_DISCARDED]: {},
  [errorKeys.ERROR_ENCODE_STOPPED]: {},
  [errorKeys.ERROR_ENCODE_EPISODE_NUMBERS_MISSING]: {},
  [errorKeys.ERROR_ENCODE_UNKNOWN_DRIVER]: { driver: 'bogus' },
  [errorKeys.ERROR_ENCODE_UNEXPECTED]: { detail: 'some unexpected throw' },
  [errorKeys.ERROR_PROCESS_JOB_NOT_FOUND]: { id: 42 },
  [errorKeys.ERROR_SOURCE_NO_DOWNLOAD_PATH]: {},
  [errorKeys.ERROR_SOURCE_NO_TARGET]: { id: 7 },
  [errorKeys.ERROR_SOURCE_SCAN_FAILED]: { detail: 'x' },
  [errorKeys.ERROR_SOURCE_DISC_PLAYLIST_AMBIGUOUS]: { playlists: '00800.mpls, 00801.mpls' },
  [errorKeys.ERROR_ENCODE_DISC_REMUX_FAILED]: { code: 2, stderr: 'Error: no space left' },
};

describe('messagesEn — every {placeholder} is satisfiable by the params a throw site passes', () => {
  it('covers every exported key with a known-params fixture', () => {
    for (const key of ALL_KEYS) {
      expect(KNOWN_PARAMS, `no known-params fixture for key "${key}" — add one above`).toHaveProperty(
        key,
      );
    }
  });

  it('renders with no leftover {placeholder} for every key, given its known params', () => {
    for (const key of ALL_KEYS) {
      const rendered = renderMessage(key, KNOWN_PARAMS[key]);
      expect(rendered, `key "${key}" rendered with a leftover placeholder: "${rendered}"`).not.toMatch(
        /\{\w+\}/,
      );
    }
  });

  it('throws a legible error for an unregistered key rather than persisting undefined', () => {
    expect(() => renderMessage('error.encode.not_a_real_key')).toThrow(
      /No English message registered/,
    );
  });
});

// Spec 100, REQ-9 REQ-13
describe('messagesEn — Blu-ray disc keys', () => {
  it('renders the ambiguous playlist message with the tied file names', () => {
    expect(
      renderMessage(errorKeys.ERROR_SOURCE_DISC_PLAYLIST_AMBIGUOUS, {
        playlists: '00800.mpls, 00801.mpls',
      }),
    ).toBe(
      "Could not determine the Blu-ray's main playlist (00800.mpls, 00801.mpls). Assemble the MKV manually and import it from the film's page",
    );
  });

  it('renders the remux failure with the exit code and the stderr tail', () => {
    expect(
      renderMessage(errorKeys.ERROR_ENCODE_DISC_REMUX_FAILED, { code: 2, stderr: 'disk full' }),
    ).toBe('Could not assemble the MKV from the Blu-ray (code 2): disk full');
  });
});
