import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openSubtitlesApiKey } from './key';

// This suite exists because the application key has two sources and a wrong
// order or a missing fall-through fails with no error anywhere: an empty
// OPENSUBTITLES_API_KEY (the compose default) that shadowed the image's key
// file would leave subtitle search reported unavailable on every published
// image, and a key file read with its trailing newline would be sent as a
// header value OpenSubtitles silently rejects. Real files, no mocks.
describe('openSubtitlesApiKey', () => {
  let dir: string;
  const saved = process.env.OPENSUBTITLES_API_KEY;
  let counter = 0;

  const fileWith = (content: string): string => {
    const path = join(dir, `key-${counter++}`);
    writeFileSync(path, content);
    return path;
  };

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'osub-key-'));
    delete process.env.OPENSUBTITLES_API_KEY;
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
    if (saved === undefined) delete process.env.OPENSUBTITLES_API_KEY;
    else process.env.OPENSUBTITLES_API_KEY = saved;
  });

  it('prefers the environment variable over the file', () => {
    process.env.OPENSUBTITLES_API_KEY = 'fake-env-key';
    expect(openSubtitlesApiKey(fileWith('fake-file-key\n'))).toBe('fake-env-key');
  });

  it('trims the environment variable', () => {
    process.env.OPENSUBTITLES_API_KEY = '  fake-env-key \n';
    expect(openSubtitlesApiKey(fileWith('x'))).toBe('fake-env-key');
  });

  it.each(['', '   ', '\n'])(
    'falls through to the file when the variable is %j',
    (value) => {
      process.env.OPENSUBTITLES_API_KEY = value;
      expect(openSubtitlesApiKey(fileWith('fake-file-key'))).toBe(
        'fake-file-key',
      );
    },
  );

  it('trims the trailing newline of the file', () => {
    expect(openSubtitlesApiKey(fileWith('fake-file-key\n'))).toBe(
      'fake-file-key',
    );
  });

  it('returns null without throwing when there is no variable and no file', () => {
    expect(openSubtitlesApiKey(join(dir, 'missing'))).toBeNull();
  });

  it('returns null for an empty file', () => {
    expect(openSubtitlesApiKey(fileWith('\n'))).toBeNull();
  });

  it('reads the file once and memoizes the result', () => {
    const path = fileWith('first');
    expect(openSubtitlesApiKey(path)).toBe('first');
    writeFileSync(path, 'second');
    expect(openSubtitlesApiKey(path)).toBe('first');
  });

  it('reads the variable on every call', () => {
    const path = fileWith('file-key');
    process.env.OPENSUBTITLES_API_KEY = 'a';
    expect(openSubtitlesApiKey(path)).toBe('a');
    process.env.OPENSUBTITLES_API_KEY = 'b';
    expect(openSubtitlesApiKey(path)).toBe('b');
  });
});
