import { SubtitleProviderKind } from '@prisma/client';
import {
  SubtitleSearchLanguage,
  SubtitleSearchLanguageOutcome as Outcome,
} from './entities/subtitle-search.entity';

export type AttemptRow = {
  languageIso3: string;
  rank: number;
  status: 'QUEUED' | 'RUNNING' | 'ACCEPTED' | 'REJECTED' | 'FAILED';
  reasonKey: string | null;
  provider?: SubtitleProviderKind;
};

export type SearchRow = {
  status:
    | 'WAITING'
    | 'SEARCHING'
    | 'VALIDATING'
    | 'EMBEDDING'
    | 'COMPLETED'
    | 'FAILED';
  errorKey: string | null;
  wantedLanguages: unknown;
  presentLanguages: unknown;
  languageErrors?: unknown;
  replaceLanguages?: unknown;
  providerProgress?: unknown;
};

function asStrings(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string')
    : [];
}

// Spec 107, T005
function errorKeys(value: unknown): Record<string, string> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return {};
  }
  return Object.fromEntries(
    Object.entries(value).filter(
      (entry): entry is [string, string] => typeof entry[1] === 'string',
    ),
  );
}

// Spec 121, REQ-8
function progressOf(value: unknown): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return out;
  }
  for (const [language, markers] of Object.entries(value)) {
    if (
      typeof markers === 'object' &&
      markers !== null &&
      !Array.isArray(markers)
    ) {
      out[language] = Object.keys(markers);
    }
  }
  return out;
}

// Spec 121, REQ-8
function ownAttempts(
  attempts: AttemptRow[],
  language: string,
  markedProviders: string[] | undefined,
): AttemptRow[] {
  const all = attempts
    .filter((attempt) => attempt.languageIso3 === language)
    .sort((a, b) => a.rank - b.rank);
  if (markedProviders === undefined || markedProviders.length === 0) return all;
  const kindOf = (attempt: AttemptRow) => attempt.provider ?? 'OPENSUBTITLES';
  const active = all.filter(
    (attempt) => !markedProviders.includes(kindOf(attempt)),
  );
  if (active.length > 0) return active;
  const last = markedProviders[markedProviders.length - 1];
  return all.filter((attempt) => kindOf(attempt) === last);
}

const PAST_SEARCHING = ['VALIDATING', 'EMBEDDING', 'COMPLETED'];

// Spec 103, REQ-13
export function deriveLanguages(
  search: SearchRow,
  attempts: AttemptRow[],
  fileLanguages: string[] | null = null,
): SubtitleSearchLanguage[] {
  const inFile =
    fileLanguages === null ? null : new Set(asStrings(fileLanguages));
  const terminal = search.status === 'COMPLETED' || search.status === 'FAILED';
  const present = new Set(asStrings(search.presentLanguages));
  const languageErrors = errorKeys(search.languageErrors);
  // Spec 119, REQ-8
  const ticked = new Set(asStrings(search.replaceLanguages));
  const progress = progressOf(search.providerProgress);

  return asStrings(search.wantedLanguages).map((languageIso3) => {
    const derived = withProvider(deriveLanguage(languageIso3));
    // Spec 114, REQ-1
    if (inFile === null || !terminal || ticked.has(languageIso3)) return derived;
    if (inFile.has(languageIso3)) {
      const resolved = !present.has(languageIso3);
      return {
        languageIso3,
        outcome: resolved ? Outcome.RESOLVED : Outcome.ALREADY_PRESENT,
        reasonKey: null,
        provider: resolved ? derived.provider : undefined,
      };
    }
    if (
      derived.outcome === Outcome.RESOLVED ||
      derived.outcome === Outcome.ALREADY_PRESENT
    ) {
      return {
        languageIso3,
        outcome: Outcome.MISSING,
        reasonKey: null,
      };
    }
    return derived;
  });

  // Spec 121, REQ-15
  function withProvider(language: SubtitleSearchLanguage): SubtitleSearchLanguage {
    if (
      language.outcome !== Outcome.RESOLVED &&
      language.outcome !== Outcome.REPLACED
    ) {
      return { ...language, provider: undefined };
    }
    const accepted = attempts.find(
      (attempt) =>
        attempt.languageIso3 === language.languageIso3 &&
        attempt.status === 'ACCEPTED',
    );
    return { ...language, provider: accepted?.provider };
  }

  function deriveLanguage(languageIso3: string): SubtitleSearchLanguage {
    const result = (outcome: Outcome, reasonKey: string | null = null) => ({
      languageIso3,
      outcome,
      reasonKey,
    });

    if (present.has(languageIso3) && !ticked.has(languageIso3)) {
      return result(Outcome.ALREADY_PRESENT);
    }

    // Spec 121, REQ-8
    const accepted = attempts.some(
      (attempt) =>
        attempt.languageIso3 === languageIso3 && attempt.status === 'ACCEPTED',
    );
    const own = accepted
      ? attempts
          .filter((attempt) => attempt.languageIso3 === languageIso3)
          .sort((a, b) => a.rank - b.rank)
      : ownAttempts(attempts, languageIso3, progress[languageIso3]);

    // Spec 107, REQ-5 REQ-8 REQ-9
    const failedKey = languageErrors[languageIso3];
    if (
      failedKey !== undefined &&
      !own.some((attempt) => attempt.status === 'ACCEPTED')
    ) {
      return result(Outcome.FAILED, failedKey);
    }

    const derived = deriveOne(search, own, result);

    // Spec 119, REQ-8
    if (ticked.has(languageIso3) && derived.outcome === Outcome.RESOLVED) {
      return result(Outcome.REPLACED);
    }

    // A terminal search never leaves a language reading PENDING forever.
    if (derived.outcome === Outcome.PENDING && search.status === 'FAILED') {
      return result(Outcome.FAILED, search.errorKey);
    }
    return derived;
  }
}

function deriveOne(
  search: SearchRow,
  own: AttemptRow[],
  result: (
    outcome: Outcome,
    reasonKey?: string | null,
  ) => SubtitleSearchLanguage,
): SubtitleSearchLanguage {
  if (own.some((attempt) => attempt.status === 'ACCEPTED')) {
    if (search.status === 'COMPLETED') return result(Outcome.RESOLVED);
    if (search.status === 'FAILED') {
      return result(Outcome.FAILED, search.errorKey);
    }
    return result(Outcome.PENDING);
  }

  if (own.length === 0) {
    return PAST_SEARCHING.includes(search.status)
      ? result(Outcome.NOT_FOUND)
      : result(Outcome.PENDING);
  }

  if (own.every((attempt) => attempt.status === 'FAILED')) {
    return result(Outcome.FAILED, own[0].reasonKey);
  }

  if (
    own.every(
      (attempt) => attempt.status === 'REJECTED' || attempt.status === 'FAILED',
    )
  ) {
    return result(Outcome.REJECTED, own[0].reasonKey);
  }

  return result(Outcome.PENDING);
}
