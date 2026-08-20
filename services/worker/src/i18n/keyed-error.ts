// An Error subclass carrying an i18n key and its interpolation params, so a
// throw site can keep using the existing `throw new KeyedError(...)` /
// `catch (err) { ... }` pattern already in the pipeline while still giving
// encode.job.ts (T033) something structured to read for `encodeFailed`.
// Same small-pure-module house style as EncodeInput/OutputPathInput: plain
// class, relative imports, no path aliases.

export class KeyedError extends Error {
  readonly key: string;
  readonly params?: Record<string, string | number>;

  constructor(key: string, message: string, params?: Record<string, string | number>) {
    super(message);
    this.name = 'KeyedError';
    this.key = key;
    this.params = params;
  }
}
