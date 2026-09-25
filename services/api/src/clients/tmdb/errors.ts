// Thrown for any non-ok HTTP response from TMDB. Carries the status so callers
// can tell a rejected credential (401) from an outage without parsing the message.
export class TmdbHttpError extends Error {
  constructor(
    public readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = 'TmdbHttpError';
  }
}
