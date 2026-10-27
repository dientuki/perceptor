import {
  SubtitleSearchLanguage,
  SubtitleSearchLanguageOutcome as Outcome,
} from './entities/subtitle-search.entity';

export type AttemptRow = {
  languageIso3: string;
  rank: number;
  status: 'QUEUED' | 'RUNNING' | 'ACCEPTED' | 'REJECTED' | 'FAILED';
  reasonKey: string | null;
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

const PAST_SEARCHING = ['VALIDATING', 'EMBEDDING', 'COMPLETED'];

// Spec 103, REQ-13
export function deriveLanguages(
  search: SearchRow,
  attempts: AttemptRow[],
): SubtitleSearchLanguage[] {
  const present = new Set(asStrings(search.presentLanguages));
  const languageErrors = errorKeys(search.languageErrors);

  return asStrings(search.wantedLanguages).map((languageIso3) => {
    const result = (outcome: Outcome, reasonKey: string | null = null) => ({
      languageIso3,
      outcome,
      reasonKey,
    });

    if (present.has(languageIso3)) return result(Outcome.ALREADY_PRESENT);

    const own = attempts
      .filter((attempt) => attempt.languageIso3 === languageIso3)
      .sort((a, b) => a.rank - b.rank);

    // Spec 107, REQ-5 REQ-8 REQ-9
    const failedKey = languageErrors[languageIso3];
    if (
      failedKey !== undefined &&
      !own.some((attempt) => attempt.status === 'ACCEPTED')
    ) {
      return result(Outcome.FAILED, failedKey);
    }

    const derived = deriveOne(search, own, result);

    // A terminal search never leaves a language reading PENDING forever.
    if (derived.outcome === Outcome.PENDING && search.status === 'FAILED') {
      return result(Outcome.FAILED, search.errorKey);
    }
    return derived;
  });
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
    if (search.status === 'COMPLETED') return result(Outcome.EMBEDDED);
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
