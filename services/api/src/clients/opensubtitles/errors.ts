// Spec 107, REQ-5 REQ-9
export type OpenSubtitlesErrorKind =
  | 'unauthorized'
  | 'quota'
  | 'rate_limited'
  | 'unavailable';

// Spec 107, AC-8
export class OpenSubtitlesHttpError extends Error {
  constructor(
    public readonly kind: OpenSubtitlesErrorKind,
    public readonly method: string,
    public readonly path: string,
    public readonly status: number,
  ) {
    super(`OpenSubtitles ${method} ${path} failed: ${status} (${kind})`);
    this.name = 'OpenSubtitlesHttpError';
  }
}
