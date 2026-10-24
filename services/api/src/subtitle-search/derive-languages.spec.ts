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
// EMBEDDED while its embed failed, or PENDING forever on a search that already
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

  it('reports an accepted attempt as EMBEDDED once the search COMPLETED', () => {
    const rows = deriveLanguages(search({ presentLanguages: ['eng'] }), [
      attempt({ status: 'ACCEPTED' }),
    ]);
    expect(only(rows, 'spa')?.outcome).toBe(Outcome.EMBEDDED);
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
});
