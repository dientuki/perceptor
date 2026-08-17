// src/ffmpeg/iso639.ts
//
// The `languages` table (services/api) is seeded with ISO-639-2/B codes, but
// Matroska files commonly tag the same languages with the /T form —
// fre/fra, ger/deu, chi/zho, dut/nld, cze/ces among the 20 seeded rows. Left
// unnormalized, a French track a user asked for is present, the codes never
// compare equal, and the track is silently dropped with no error anywhere
// (docs/spec/features/011-av1-transcode/plan.md — Risks).
//
// This table is worker-local, not a contract change: `api` never sees the
// /T form, it only ever reads/writes the /B form it seeded.

// /B (seeded, canonical) -> /T (commonly found in Matroska tagging).
const B_TO_T: Record<string, string> = {
  fre: 'fra',
  ger: 'deu',
  chi: 'zho',
  dut: 'nld',
  cze: 'ces',
};

// The reverse lookup, /T -> /B, built from the same table so the two never
// drift apart.
const T_TO_B: Record<string, string> = Object.fromEntries(
  Object.entries(B_TO_T).map(([b, t]) => [t, b]),
);

// Canonicalize to the /B form, which is what the `languages` table stores
// and what `allowedLanguagesIso3` arrives in. Both members of a pair map to
// the same output, so comparing two normalized codes is safe regardless of
// which form either side used.
export function normalizeIso3(code: string): string {
  const lower = (code || '').trim().toLowerCase();
  return T_TO_B[lower] ?? lower;
}
