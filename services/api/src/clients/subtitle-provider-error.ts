// Spec 121, REQ-9
export type SubtitleProviderName = 'opensubtitles' | 'subdivx';

export type SubtitleProviderErrorKind =
  | 'unauthorized'
  | 'quota'
  | 'rate_limited'
  | 'unavailable';

// Spec 121, REQ-9
export class SubtitleProviderHttpError extends Error {
  constructor(
    public readonly provider: SubtitleProviderName,
    public readonly kind: SubtitleProviderErrorKind,
    public readonly method: string,
    public readonly path: string,
    public readonly status: number,
  ) {
    super(`${provider} ${method} ${path} failed: ${status} (${kind})`);
    this.name = 'SubtitleProviderHttpError';
  }
}
