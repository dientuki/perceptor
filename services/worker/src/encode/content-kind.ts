// The worker-local ContentKind union, mirroring api's ContentKind GraphQL enum
// (`LIVE_ACTION` | `ANIME` | `CGI`) without importing it — same reasoning as
// `EncodeInput` in `types.ts`: this service retypes the shape it needs rather
// than coupling to the full query result.

export type ContentKind = 'LIVE_ACTION' | 'ANIME' | 'CGI';

export const CONTENT_KIND_VALUES: readonly ContentKind[] = ['LIVE_ACTION', 'ANIME', 'CGI'];

function isContentKind(value: string): value is ContentKind {
  return (CONTENT_KIND_VALUES as readonly string[]).includes(value);
}

// The one place in this service where a missing payload field is deliberately
// defended rather than left to fail loudly (see worker/plan.md's Contract
// obligations). An absent, null or unrecognised value degrades to
// `LIVE_ACTION` and logs once — it must never throw, the same way
// `EncodeCancelledError` (`cancellation.ts`) must never acquire an i18n key.
export function normalizeContentKind(raw: string | null | undefined): ContentKind {
  if (raw != null && isContentKind(raw)) {
    return raw;
  }

  console.warn(`[content-kind] unrecognised contentKind ${JSON.stringify(raw)}, defaulting to LIVE_ACTION`);
  return 'LIVE_ACTION';
}
