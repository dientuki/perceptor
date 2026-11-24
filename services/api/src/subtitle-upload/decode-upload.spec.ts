import { ERROR_KEYS } from '@/i18n/error-keys';
import { MAX_UPLOAD_BYTES, decodeUpload } from './decode-upload';

// This suite exists because every failure of an upload's decoding is silent: a cp1252 file read as
// UTF-8 embeds "¿Señor?" as replacement characters and nothing complains, a body that is not an SRT
// embeds an empty or garbage subtitle track, and an oversized or malformed payload that is not
// refused with its own key reaches the user as a generic network error (Article IX, Spec 124, REQ-4
// REQ-8).
describe('decodeUpload', () => {
  const cue = '1\n00:01:20,000 --> 00:01:30,000\n';
  const b64 = (bytes: Buffer) => bytes.toString('base64');

  it('turns a cp1252 file into UTF-8 with its characters intact', () => {
    const body = Buffer.from(`${cue}¿Señor?\n`, 'latin1');

    const result = decodeUpload(b64(body));

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.bytes.toString('utf8')).toContain('¿Señor?');
    }
  });

  it('accepts a UTF-8 BOM and strips it', () => {
    const body = Buffer.concat([
      Buffer.from([0xef, 0xbb, 0xbf]),
      Buffer.from(`${cue}¿Señor?\n`, 'utf8'),
    ]);

    const result = decodeUpload(b64(body));

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.bytes.toString('utf8').startsWith('1\n')).toBe(true);
      expect(result.bytes.toString('utf8')).toContain('¿Señor?');
    }
  });

  it('refuses bytes containing NUL as an undetected charset', () => {
    const body = Buffer.concat([Buffer.from(cue), Buffer.from([0, 1, 2, 0])]);

    expect(decodeUpload(b64(body))).toEqual({
      ok: false,
      errorKey: ERROR_KEYS.SUBTITLE_EMBED_CHARSET_UNDETECTED,
    });
  });

  it('refuses text that holds no cue as not an SRT', () => {
    expect(decodeUpload(b64(Buffer.from('just some prose\n')))).toEqual({
      ok: false,
      errorKey: ERROR_KEYS.SUBTITLE_EMBED_UPLOAD_NOT_SRT,
    });
  });

  it.each(['not base64!', 'abc', 'YQ=a'])(
    'refuses %j as not base64',
    (payload) => {
      expect(decodeUpload(payload)).toEqual({
        ok: false,
        errorKey: ERROR_KEYS.SUBTITLE_EMBED_UPLOAD_NOT_SRT,
      });
    },
  );

  it('refuses 2 MiB plus one byte and accepts exactly 2 MiB of body', () => {
    const header = Buffer.from(cue);
    const exact = Buffer.concat([
      header,
      Buffer.alloc(MAX_UPLOAD_BYTES - header.length, 0x61),
    ]);
    const over = Buffer.concat([exact, Buffer.from('a')]);

    expect(decodeUpload(b64(exact)).ok).toBe(true);
    expect(decodeUpload(b64(over))).toEqual({
      ok: false,
      errorKey: ERROR_KEYS.SUBTITLE_EMBED_UPLOAD_TOO_LARGE,
    });
  });
});
