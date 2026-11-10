import { AttemptRow, SearchRow, deriveLanguages } from './derive-languages';
import { SubtitleSearchLanguageOutcome as Outcome } from './entities/subtitle-search.entity';

const search = (over: Partial<SearchRow> = {}): SearchRow => ({
  status: 'COMPLETED',
  errorKey: null,
  wantedLanguages: ['eng', 'spa'],
  presentLanguages: [],
  ...over,
});

const attempt = (over: Partial<AttemptRow> = {}): AttemptRow => ({
  languageIso3: 'spa',
  rank: 1,
  status: 'QUEUED',
  reasonKey: null,
  ...over,
});

const only = (rows: ReturnType<typeof deriveLanguages>, iso3: string) =>
  rows.find((row) => row.languageIso3 === iso3);

// This suite exists because the panel's per-language outcome is derived from
// rows and never stored, so a wrong branch is silent: a language reading
// RESOLVED while its embed failed, or PENDING forever on a search that already
// ended, misreports the library with no error anywhere. Each outcome is derived
// from real rows, not asserted against a mock (Article IX, Spec 103, REQ-13).
describe('deriveLanguages', () => {
  it('reports a language the item already carries as ALREADY_PRESENT, whatever the attempts say', () => {
    const rows = deriveLanguages(search({ presentLanguages: ['eng'] }), [
      attempt({ languageIso3: 'eng', status: 'ACCEPTED' }),
    ]);
    expect(only(rows, 'eng')).toEqual({
      languageIso3: 'eng',
      outcome: Outcome.ALREADY_PRESENT,
      reasonKey: null,
    });
  });

  it('reports an accepted attempt as RESOLVED once the search COMPLETED', () => {
    const rows = deriveLanguages(search({ presentLanguages: ['eng'] }), [
      attempt({ status: 'ACCEPTED' }),
    ]);
    expect(only(rows, 'spa')?.outcome).toBe(Outcome.RESOLVED);
  });

  it('reports an accepted attempt as FAILED with the search key when the search FAILED', () => {
    const rows = deriveLanguages(
      search({
        status: 'FAILED',
        errorKey: 'error.subtitleEmbed.busy',
        presentLanguages: ['eng'],
      }),
      [attempt({ status: 'ACCEPTED' })],
    );
    expect(only(rows, 'spa')).toEqual({
      languageIso3: 'spa',
      outcome: Outcome.FAILED,
      reasonKey: 'error.subtitleEmbed.busy',
    });
  });

  it('reports no attempts on a search past SEARCHING as NOT_FOUND', () => {
    const rows = deriveLanguages(search({ presentLanguages: ['eng'] }), []);
    expect(only(rows, 'spa')?.outcome).toBe(Outcome.NOT_FOUND);
  });

  it('keeps a language PENDING while the search has not reached it', () => {
    const rows = deriveLanguages(
      search({ status: 'SEARCHING', presentLanguages: ['eng'] }),
      [],
    );
    expect(only(rows, 'spa')?.outcome).toBe(Outcome.PENDING);
  });

  it('reports all-rejected and rejected-plus-failed as REJECTED with the first rank reason', () => {
    const rejected = deriveLanguages(search({ presentLanguages: ['eng'] }), [
      attempt({
        rank: 2,
        status: 'REJECTED',
        reasonKey: 'error.subtitleSearch.low_score',
      }),
      attempt({
        rank: 1,
        status: 'REJECTED',
        reasonKey: 'error.subtitleSearch.offset_too_large',
      }),
    ]);
    expect(only(rejected, 'spa')).toEqual({
      languageIso3: 'spa',
      outcome: Outcome.REJECTED,
      reasonKey: 'error.subtitleSearch.offset_too_large',
    });

    const mixed = deriveLanguages(search({ presentLanguages: ['eng'] }), [
      attempt({
        rank: 1,
        status: 'FAILED',
        reasonKey: 'error.subtitleSearch.fetch_failed',
      }),
      attempt({
        rank: 2,
        status: 'REJECTED',
        reasonKey: 'error.subtitleSearch.low_score',
      }),
    ]);
    expect(only(mixed, 'spa')?.outcome).toBe(Outcome.REJECTED);
  });

  it('reports every attempt failed as FAILED', () => {
    const rows = deriveLanguages(search({ presentLanguages: ['eng'] }), [
      attempt({
        rank: 1,
        status: 'FAILED',
        reasonKey: 'error.subtitleSearch.fetch_failed',
      }),
      attempt({
        rank: 2,
        status: 'FAILED',
        reasonKey: 'error.subtitleSearch.sync_failed',
      }),
    ]);
    expect(only(rows, 'spa')).toEqual({
      languageIso3: 'spa',
      outcome: Outcome.FAILED,
      reasonKey: 'error.subtitleSearch.fetch_failed',
    });
  });

  it('never leaves a language PENDING once the search itself FAILED', () => {
    const rows = deriveLanguages(
      search({
        status: 'FAILED',
        errorKey: 'error.subtitleSearch.superseded',
        presentLanguages: null,
      }),
      [attempt({ status: 'RUNNING' })],
    );
    expect(only(rows, 'spa')).toEqual({
      languageIso3: 'spa',
      outcome: Outcome.FAILED,
      reasonKey: 'error.subtitleSearch.superseded',
    });
    expect(only(rows, 'eng')?.outcome).toBe(Outcome.FAILED);
  });

  // Spec 107, T005
  it('reads a languageErrors entry as FAILED with its key where it would have read NOT_FOUND', () => {
    const rows = deriveLanguages(
      search({
        languageErrors: { spa: 'error.subtitleSearch.quota_exhausted' },
      }),
      [],
    );
    expect(only(rows, 'spa')).toEqual({
      languageIso3: 'spa',
      outcome: Outcome.FAILED,
      reasonKey: 'error.subtitleSearch.quota_exhausted',
    });
    expect(only(rows, 'eng')?.outcome).toBe(Outcome.NOT_FOUND);
  });

  it('lets an accepted attempt win over a stored language error', () => {
    const rows = deriveLanguages(
      search({
        languageErrors: { spa: 'error.subtitleSearch.quota_exhausted' },
      }),
      [attempt({ status: 'ACCEPTED' })],
    );
    expect(only(rows, 'spa')?.outcome).toBe(Outcome.RESOLVED);
  });

  it('ignores a malformed languageErrors value', () => {
    const rows = deriveLanguages(search({ languageErrors: ['spa'] }), []);
    expect(only(rows, 'spa')?.outcome).toBe(Outcome.NOT_FOUND);
  });

  describe('against the current file (Spec 114, REQ-1)', () => {
    const rejected = [
      attempt({
        status: 'REJECTED',
        reasonKey: 'error.subtitleSearch.rejected',
      }),
    ];

    it('turns a REJECTED language into RESOLVED when the file holds it', () => {
      const rows = deriveLanguages(search(), rejected, ['spa']);
      expect(only(rows, 'spa')).toEqual({
        languageIso3: 'spa',
        outcome: Outcome.RESOLVED,
        reasonKey: null,
      });
    });

    it('turns an accepted language into MISSING when the file lacks it', () => {
      const rows = deriveLanguages(
        search(),
        [attempt({ status: 'ACCEPTED' })],
        ['eng'],
      );
      expect(only(rows, 'spa')).toEqual({
        languageIso3: 'spa',
        outcome: Outcome.MISSING,
        reasonKey: null,
      });
    });

    it('keeps an accepted language RESOLVED when the file holds it', () => {
      const rows = deriveLanguages(
        search(),
        [attempt({ status: 'ACCEPTED' })],
        ['spa'],
      );
      expect(only(rows, 'spa')?.outcome).toBe(Outcome.RESOLVED);
    });

    it('turns a present language into MISSING when the file lacks it', () => {
      const rows = deriveLanguages(
        search({ presentLanguages: ['eng'] }),
        [],
        ['spa'],
      );
      expect(only(rows, 'eng')?.outcome).toBe(Outcome.MISSING);
    });

    it('keeps a present language ALREADY_PRESENT when the file holds it', () => {
      const rows = deriveLanguages(
        search({ presentLanguages: ['eng'] }),
        [],
        ['eng'],
      );
      expect(only(rows, 'eng')?.outcome).toBe(Outcome.ALREADY_PRESENT);
    });

    it('leaves NOT_FOUND, REJECTED and FAILED untouched when the file lacks the language', () => {
      const rows = deriveLanguages(
        search({
          wantedLanguages: ['eng', 'spa', 'fra'],
          languageErrors: { fra: 'error.subtitleSearch.quota_exhausted' },
        }),
        rejected,
        ['deu'],
      );
      expect(only(rows, 'eng')?.outcome).toBe(Outcome.NOT_FOUND);
      expect(only(rows, 'spa')).toEqual({
        languageIso3: 'spa',
        outcome: Outcome.REJECTED,
        reasonKey: 'error.subtitleSearch.rejected',
      });
      expect(only(rows, 'fra')).toEqual({
        languageIso3: 'fra',
        outcome: Outcome.FAILED,
        reasonKey: 'error.subtitleSearch.quota_exhausted',
      });
    });

    it('derives exactly as before when the file languages are unknown', () => {
      const input = search({ presentLanguages: ['eng'] });
      const attempts = [attempt({ status: 'ACCEPTED' })];
      expect(deriveLanguages(input, attempts, null)).toEqual(
        deriveLanguages(input, attempts),
      );
      expect(only(deriveLanguages(input, attempts, null), 'spa')?.outcome).toBe(
        Outcome.RESOLVED,
      );
    });

    it('keeps a SEARCHING search PENDING even when the file holds the language', () => {
      const rows = deriveLanguages(
        search({ status: 'SEARCHING' }),
        [],
        ['spa'],
      );
      expect(only(rows, 'spa')?.outcome).toBe(Outcome.PENDING);
    });

    it('turns a FAILED search language into RESOLVED when the file holds it', () => {
      const rows = deriveLanguages(
        search({ status: 'FAILED', errorKey: 'error.subtitleEmbed.busy' }),
        [attempt({ status: 'ACCEPTED' })],
        ['spa'],
      );
      expect(only(rows, 'spa')).toEqual({
        languageIso3: 'spa',
        outcome: Outcome.RESOLVED,
        reasonKey: null,
      });
    });
  });
});
