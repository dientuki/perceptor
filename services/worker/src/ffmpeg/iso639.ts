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

// Spec 122, REQ-3
const ISO1_TO_ISO3: Record<string, string> = {
  en: 'eng', zh: 'chi', de: 'ger', es: 'spa', ru: 'rus', ko: 'kor', fr: 'fre', ja: 'jpn',
  pt: 'por', tr: 'tur', pl: 'pol', ca: 'cat', nl: 'dut', ar: 'ara', sv: 'swe', it: 'ita',
  id: 'ind', hi: 'hin', fi: 'fin', vi: 'vie', he: 'heb', uk: 'ukr', el: 'gre', ms: 'may',
  cs: 'cze', ro: 'rum', da: 'dan', hu: 'hun', ta: 'tam', no: 'nor', th: 'tha', ur: 'urd',
  hr: 'hrv', bg: 'bul', lt: 'lit', la: 'lat', mi: 'mao', ml: 'mal', cy: 'wel', sk: 'slo',
  te: 'tel', fa: 'per', lv: 'lav', bn: 'ben', sr: 'srp', az: 'aze', sl: 'slv', kn: 'kan',
  et: 'est', mk: 'mac', br: 'bre', eu: 'baq', is: 'ice', hy: 'arm', ne: 'nep', mn: 'mon',
  bs: 'bos', kk: 'kaz', sq: 'alb', sw: 'swa', gl: 'glg', mr: 'mar', pa: 'pan', si: 'sin',
  km: 'khm', sn: 'sna', yo: 'yor', so: 'som', af: 'afr', oc: 'oci', ka: 'geo', be: 'bel',
  tg: 'tgk', sd: 'snd', gu: 'guj', am: 'amh', yi: 'yid', lo: 'lao', uz: 'uzb', fo: 'fao',
  ht: 'hat', ps: 'pus', tk: 'tuk', nn: 'nno', mt: 'mlt', sa: 'san', lb: 'ltz', my: 'bur',
  bo: 'tib', tl: 'tgl', mg: 'mlg', as: 'asm', tt: 'tat', haw: 'haw', ln: 'lin', ha: 'hau',
  ba: 'bak', jw: 'jav', su: 'sun', yue: 'yue',
};

export function iso1ToIso3(code: string): string | undefined {
  const lower = (code || '').trim().toLowerCase();
  return Object.prototype.hasOwnProperty.call(ISO1_TO_ISO3, lower)
    ? ISO1_TO_ISO3[lower]
    : undefined;
}

export const WHISPER_ISO1_CODES: readonly string[] = Object.keys(ISO1_TO_ISO3);
