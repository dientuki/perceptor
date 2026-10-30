// Thrown for any non-ok HTTP response from TMDB. Carries the status so callers
// can tell a rejected credential (401) from an outage without parsing the message.
// `statusCode` is TMDB's own response-body code (7 = invalid API key), which
// separates a bad key from a private list when both answer 401.
export class TmdbHttpError extends Error {
  constructor(
    public readonly status: number,
    message: string,
    public readonly statusCode?: number,
  ) {
    super(message);
    this.name = 'TmdbHttpError';
  }
}
